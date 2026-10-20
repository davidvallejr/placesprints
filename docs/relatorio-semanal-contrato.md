# Relatório Semanal — contrato de dados (v2, 05/10/2026)

Pedido do David (relatório de entregas = Relatório Semanal Place2u, `src/lib/semanal.js` + `render-semanal.js`):

1. Remover do relatório do CLIENTE o "Checklist de coleta" (pág. 2) e a caixa "Checagem de prontidão"; fica só a barra de progresso do plano. A checagem continua existindo para uso INTERNO (`interno=true`).
2. Remover o gráfico "Entregas por dia" (pág. 14).
3. Remover a seção "Próximos passos e dependências".
4. No TOPO: Resultados — Mercado Livre, ADS e Outros canais; canal sem API mostra dado informado (manual/print) ou o motivo.
5. SEMPRE mostrar as métricas (blocos completos, "—" + motivo quando indisponível) e o Volume de atividades.
6. Listar as TAREFAS QUE GERARAM RESULTADO, com o dado que o cliente quer segundo o OBJETIVO dele.
7. Estruturar o relatório por PERFIL do cliente: analítico, direto, relacionamento, proativo, zero conhecimento, técnico, ansioso.

Regras de honestidade (inegociáveis): nunca inventar número; nunca dizer causalidade "comprovada" (usar "causa provável"); resultado MEDIDO (motor de atribuição `impacto-tarefas.js`) é separado de resultado INFORMADO pela equipe (campos do card); canal sem API nunca recebe número que ninguém informou; nada é enviado a terceiros por este código.

## Perfil e objetivo — `src/lib/perfil-cliente.js` (dono: frente DADOS)

```
perfilDoCliente(cliente) -> {
  cliente,
  perfis: [{ id, rotulo, descricao }],        // lista ordenada; o 1º é o PRIMÁRIO e vence conflitos
  primario: 'analitico',
  objetivo: { id: 'faturamento', rotulo: 'Crescer o faturamento', metrica: 'receita'|'visitas'|'conversao'|'ads'|'margem'|'lancamentos' },
  regras: { densidade:'completa'|'media'|'enxuta', provas:'completa'|'media'|'minima', linguagem:'padrao'|'simples'|'tecnica',
            tom:'neutro'|'parceria'|'tranquilizador', glossario:bool, metodologia:bool, graficos:bool, tabela_otimizacoes:bool,
            mostrar_equipe:bool, links_abertos:bool, situacao_da_conta:bool, metricas_extras:bool,
            max_acoes:int(0=todas), max_resultados:int(0=todos), max_otimizacoes:int },
  origem: 'banco'|'padrao'                    // 'padrao' = cliente sem perfil salvo (analitico + faturamento)
}
salvarPerfil({ cliente, perfis:[ids], objetivo:id, por }) -> perfilDoCliente(cliente)   // valida ids contra config/perfis-cliente.json; `por` obrigatório
listarPerfis() -> [{ id, rotulo, descricao, regras }] ;  listarObjetivos() -> [{ id, rotulo, metrica, descricao }]
mesclarRegras(listaDeIds) -> regras   // booleanos: OR; strings e inteiros: do primário; extras só adicionam
```
Config editável: `config/perfis-cliente.json` (`perfis`, `objetivos`, `padrao`). Tabela `perfil_cliente(cliente PK, perfis_json, objetivo, atualizado_em, por)` criada em `db.js` (CREATE TABLE IF NOT EXISTS, depois dos demais CREATE).

## Campos NOVOS de `montarSemanal()` (dono: frente DADOS; consumidor: frente RENDER)

`montarSemanal({ cliente, de, ate, interno=false, perfil? })` — `perfil` opcional = override de ids (ex. `['direto']`) só para essa geração.
`interno=true` mantém `prontidao`, `pronto`, `avisos` (como hoje); `interno=false` devolve esses campos mesmo assim (o RENDER decide não exibir) — não remover os campos.
NADA é removido do retorno nesta rodada: `proximos` e `graficos.por_dia` permanecem calculados (o `notion-publicar.js` ainda lê `proximos.length`; a frente INTEGRAÇÃO migra isso para `r.atividades`), mas o render não os desenha mais.

```
r.perfil = perfilDoCliente(cliente) (com override aplicado)

r.resultados = {
  periodo: { de, ate }, anterior: { de, ate } | null,
  ml:  { canal:'Mercado Livre', fonte:'api'|'manual'|null, disponivel:bool, motivo:string|null,
         metricas:[ Metrica ] },               // SEMPRE a lista completa (faturamento, vendas, unidades, ticket, visitas, conversão, cancelamentos...), valor=null quando indisponível
  ads: { canal:'Mercado Livre Ads', fonte:'api'|'manual'|null, disponivel:bool, motivo:string|null,
         metricas:[ Metrica ], acoes:[string] },  // SEMPRE a lista completa (vendas atribuídas, ROAS, receita, investimento, ACOS, TACOS, impressões, cliques)
  outros:[ { canal:'Shopee'|'Amazon'|'Magalu'|'TikTok Shop'|..., tem_api:false, fonte:'manual'|'print'|null, motivo:string|null,
             metricas:[ Metrica ], evidencias:[ evidência ], acoes_semana:int } ],   // um item por canal presente nas tarefas do cliente (exceto ML); sem canal => lista vazia
  destaques:[{ rotulo, delta }], acoes_relacionadas:[string]     // como hoje
}
Metrica = { chave, rotulo, valor:number|null, unidade:'moeda'|'numero'|'pct', delta:{valor,bom,pontos}|null, explicacao:string, extra:bool }
          // `explicacao` = 1 linha em português simples (usada no perfil zero conhecimento); `extra:true` = métrica técnica (ACOS/TACOS/CTR/CPC...) usada no perfil técnico

r.atividades = {
  periodo:{de,ate},
  concluidas:{ atual:int, anterior:int, pct:number|null },
  por_canal:[{ canal, n }],                    // ações concluídas por canal
  otimizacoes:int, acoes_ads:int, em_andamento:int, atrasadas:int, bloqueadas:int,
  depende_cliente:int,                         // tarefas na classe `dependencia_cliente` (fora de abertas/atrasadas/bloqueadas); o render só desenha o tile "Aguardando você" quando > 0
  com_evidencia:{ n:int, de:int, pct:number|null },   // concluídas com print anexado / concluídas
  equipe:[{ nome, n }]                         // responsáveis das ações concluídas (para perfil relacionamento)
}

r.tarefas_resultado = {
  objetivo:{ id, rotulo, metrica },
  itens:[ { id, titulo, canal, responsavel, concluida_em, url, tipo:'medido'|'informado',
            metrica:{ rotulo, texto },          // ex. { rotulo:'Faturamento adicional (causa provável)', texto:'+ R$ 1.240' } — SEMPRE conforme o objetivo do cliente
            resumo:string, confianca:{ nivel:'alta'|'media'|'baixa', pct:int }|null, metodo:string, evidencias:[evidência], links:[{url,rotulo}] } ],
  sem_efeito:int, em_maturacao:int,            // contagens honestas (tarefas medidas sem efeito distinguível; ainda sem janela para medir)
  nota:string                                  // frase honesta quando a lista está vazia ou parcial
}
// tipo 'medido' = vem do motor de atribuição (só estado 'melhorou', ou 'lancamento' que vendeu); sempre "causa provável", nunca "comprovada".
// tipo 'informado' = vem dos campos do card (resultado alcançado / impacto), rotulado "informado pela equipe".

r.situacao = { nivel:'ok'|'atencao', titulo:string, itens:[{ texto, tom:'ok'|'atencao' }] }
// derivado só de fatos: atrasadas, bloqueadas, % do plano; 'ok' somente se atrasadas==0 e bloqueadas==0. Usado pelo perfil ansioso.
// Dependência do cliente NÃO muda o nível (verde continua): entra como item △ "N tarefa(s) aguardam um retorno seu — veja Pontos de atenção".
```

### Complementos da frente DADOS (aditivos; nada acima foi removido)

- `perfilDoCliente(cliente, ov?)` — `ov = { perfis, objetivo }` é o override de uma geração (não grava; id desconhecido = erro 400). O retorno ganha `avisos:[string]` (perfil/objetivo salvo que sumiu da config) e `override:true` quando houve override. `listarPerfis()` traz também `definicao` (as definições dos perfis são PROPOSTAS, editáveis em `config/perfis-cliente.json`). Exportado também `janelaResultadosDias()` (padrão 45) e `criarPerfis(handle)` (fábrica p/ teste).
- Regras: `max_*` = **0 significa sem limite** (inclusive `max_otimizacoes`, que só vale com `tabela_otimizacoes`). Combinação: para texto/número vale o PRIMEIRO perfil da lista que **define** a regra (sem conflito = vale a do 2º); booleanos fazem OU.
- `Metrica` ganha `motivo:string|null` (por que `valor` é null quando o bloco existe mas aquela métrica não veio). `bom` do delta é sempre boolean; `investimento` (Ads) não tem delta (gastar mais não é bom nem ruim). Bloco ML ganha `aviso:string|null` (ex.: período com mais de 1.000 pedidos = amostra). Motivos dos blocos são textos prontos para o cliente (sem nomes de arquivo internos).
- ML: lista fixa `faturamento, vendas, unidades, ticket_medio, visitas, conversao, cancelamentos, devolucoes` + extras `valor_cancelado, preco_medio_unidade`. ADS: `vendas_atribuidas, roas, receita_atribuida, investimento` + extras `acos, tacos, impressoes, cliques, ctr, cpc` (CTR/CPC derivados: cliques ÷ impressões, investimento ÷ cliques).
- `resultados.outros`: além dos canais das tarefas, entra o canal que a equipe transcreveu em `config/metricas-semanais.json` → `{ "<cliente>": { "canais": { "Shopee": { "semana_de": "AAAA-MM-DD", "faturamento": 0, "vendas": 0, "unidades": 0, "ticket_medio": 0, "visitas": 0, "conversao": 0, "ads": { "investimento": 0, "receita": 0, "roas": 0, "acos": 0 } } } } }` (mesma regra do ML: `semana_de` diferente da semana do relatório = ignorado, com motivo; sem `semana_de` vale sempre). `fonte:'print'` quando só há print de painel anexado a tarefa do canal (`evidencias` = só prints de painel/métricas, não prints de ações).
- `tarefas_resultado` ganha `piorou:int` (contagem para uso interno; tarefa que piorou NUNCA vira item de resultado e não entra no texto de `nota`) e `objetivo_pedido` (só quando o objetivo pedido foi trocado: `margem` sem custo informado cai em `faturamento`, com `nota`). A mesma tarefa pode aparecer em 2 itens (um `medido` e um `informado`), sempre rotulados — nunca somados. Janela: tarefas concluídas nos últimos `janela_resultados_dias` (config) até o fim do período; só tarefas visíveis ao cliente. Medido com confiança baixa (< 40%) vem rotulado "hipótese — confiança baixa", nunca "causa provável". `lancamento` que vendeu tem `confianca:null` (observação direta, sem controle). Objetivos `ads` e `lancamentos` só listam tarefas desse tema.
- `atencao[]` ganha `url`, `responsavel`, `prazo`. `tipo:'Depende de você'` (07/10/2026) = tarefa na classe `dependencia_cliente` + registro de `tarefa_dependencia` via `dependencia-cliente.listar` (mesma visibilidade das abertas): texto "Título — Fotos do produto: detalhe · aguardando desde dd/mm/aaaa (N dia(s))", `responsavel:''` (sem nome interno — a cobrança é do consultor; sem registro, o texto diz "sem motivo registrado…"). O campo `bloqueio` do card não decide mais; bloqueada é sempre `tipo:'Bloqueio'`. `proximos[].dependencia_cliente` vem do mesmo registro. Prontidão item 2 acrescenta "N aguardando o cliente". (A seção "Próximos passos e dependências" saiu do relatório.)
- `semanal.js` não chama o Mercado Livre para o novo bloco de tarefas: `analisarCliente` só lê o banco (falha => só informados + `nota`).
- Correções da revisão (05/10): `resultados.periodo_parcial: { ate_hora:'HH:MM' } | null` — o período inclui o dia de hoje (incompleto, horário de São Paulo); o render NÃO diz "de mesma duração" e rotula "inclui hoje até HH:MM (dia em andamento)". Transcrição manual (ML e `canais`): vale se o período declarado `semana_de` [+ `semana_ate`, padrão +6 dias] cobrir ao menos 4 dos 7 dias do relatório (`periodoManual`); o bloco traz `aviso` com o período DECLARADO (também em `outros[]`). Cancelamentos/devoluções/valor cancelado: delta só com ≥ 10 vendas nos dois períodos e número e taxa (÷ vendas; valor ÷ faturamento) no mesmo sentido — senão `delta:null`. Ticket/preço por unidade sem venda = `null` + motivo "sem vendas no período". Motivo técnico da API de Ads vira frase de cliente; o detalhe vai para `avisos` (interno). `acoes_relacionadas` só com ações do canal Mercado Livre. Print de painel (`evidMetricas`, `outros[].evidencias`, `fonte:'print'`) só quando título da tarefa ou legenda do print diz painel/métricas (`ehPainel`). Visitas/conversão do item medido sem controle = "variação observada, não ajustada" (nunca "causa provável"); se caíram, o item mostra o efeito medido. Tarefa com medição não positiva (piorou, sem efeito, lançamento que não vendeu) não entra nem como `informado`. `graficos.faturamento_hist` = só janelas de 7 dias sem sobreposição (a mais recente vence); `metricas_semana` só grava janelas de 7 dias. Datas/horas exibidas (`gerado_em`, `ultima_atualizacao`, `evidencias[].criada_em`) no fuso America/Sao_Paulo.

## Renderização — `render-semanal.js` (dono: frente RENDER)

`renderSemanal(r, { inline, interno })` — ordem das seções (cliente):
capa → **Situação da conta** (só se `regras.situacao_da_conta`) → **Resultados** (ML · ADS · Outros canais) → **Volume de atividades** → barra do plano (`barraPlano`) → **Tarefas que geraram resultado** → **Ações concluídas** → **Otimizações** (só se `regras.tabela_otimizacoes`) → **Pontos de atenção** → rodapé. Gráficos só se `regras.graficos` (faturamento semanal e ações por canal; NUNCA "entregas por dia").
`interno=true`: acrescenta, ao final, o "Checklist de coleta" e a caixa de prontidão (uso da equipe; nunca no PDF do cliente).
Perfis alteram: densidade/limites (`max_*`), provas (miniaturas de prints), linguagem (glossário/explicações para `simples`; fórmulas e métricas extras para `tecnica`), tom (frases de abertura), equipe (`mostrar_equipe`), links abertos, método (`metodologia`: como medimos, confiança).
Estados vazios: nunca zero como fato — "—" + motivo.

### Complementos da frente RENDER (como `render-semanal.js` lê o contrato; teste: `scripts/teste-semanal-render.mjs`)

- **Ordem**: densidade `enxuta` (perfil direto) sobe os **Pontos de atenção** para logo depois de *Tarefas que geraram resultado* (resultados e atenção primeiro): Resultados → Tarefas → Atenção → Volume → plano → Ações. As demais densidades seguem a ordem acima. Seções numeradas em sequência só entre as que aparecem. Gráficos (`regras.graficos`) ficam no fim do *Volume de atividades*; Chart.js só é carregado quando há gráfico.
- **`interno=true`**: o apêndice (checklist de coleta + caixa de prontidão + avisos + perfil/objetivo aplicados) vem DEPOIS do rodapé, em página própria, com o rótulo "Uso interno — não enviar ao cliente". O HTML do cliente nunca contém esses textos. `server.js` (`/semanal?interno=1`) e os scripts precisam repassar `{ interno }` ao `renderSemanal` (hoje só passam ao `montarSemanal`).
- **Métricas**: `extra:true` só é desenhada com `regras.metricas_extras`; as fórmulas (ROAS, ACOS, TACOS, CTR, CPC, conversão, ticket) também só aparecem com `metricas_extras`. `valor` não finito vira "—"; `Metrica.motivo` iguais são agrupados numa linha por bloco ("Visitas, Conversão: motivo"). `ml.aviso` / `ads.aviso` saem como nota do bloco. Selos de fonte: `api` → "dados da API do <canal>", `manual` → "informado pela equipe", `print` → "print do painel", canal sem API acrescenta "canal sem integração via API", sem fonte → "sem dado neste período".
- **Glossário** (`regras.glossario`): linhas "O que significa" (`Metrica.explicacao`) + "Por que importa" (texto fixo do render por tipo de métrica, casado por regex em `chave`/`rotulo`); siglas ROAS/ACOS/TACOS/CTR/CPC explicadas na 1ª vez em que aparecem (linguagem `simples`).
- **Provas** (miniaturas): `completa` = todas; `media` = 2 por tarefa-resultado, 1 por ação e 2 por canal; `minima` = 1 só por tarefa-resultado, nenhuma em ações/canais (excedente vira "+ N prints no card").
- **Limites**: `max_acoes`, `max_resultados`, `max_otimizacoes` com 0 = sem limite; o excedente é anunciado ("+ N ... não listadas neste resumo").
- **Links**: `links_abertos` liga o card no Notion e os chips de anúncio nas *Tarefas que geraram resultado*, o card clicável em *Pontos de atenção*, e os itens "Depende de você" vindos de `proximos[].dependencia_cliente` (registro de dependência; sem repetir os que `atencao[]` já traz). Em *Pontos de atenção*, o item "Depende de você" nunca mostra responsável nem prazo (o texto já traz "desde"). Produtos mais vendidos e ofertas ativas aparecem com `links_abertos` OU densidade `completa`. Só `http(s)` vira link.
- **Dependência do cliente** (07/10/2026): tile "Aguardando você" no *Volume de atividades* só quando `atividades.depende_cliente > 0` (neutro, sem cor de risco); abertura do tom tranquilizador com a conta verde: "Nenhuma tarefa atrasada ou bloqueada. N aguardam um retorno seu."; semáforo continua verde (item △ vindo de `r.situacao`).
- **Selo do item de resultado**: `informado` → "Informado pela equipe"; `medido` com `confianca` null → "Medido · observação direta"; `confianca.nivel=='baixa'` (ou pct < 40) → "Medido · hipótese, confiança baixa"; demais `medido` → "Medido · causa provável". O texto "comprovad*" nunca é emitido.
- **Impressão**: `@page` A4 com 10 mm; `break-inside: avoid` em blocos curtos (cartões, tiles, barra do plano, situação, glossário, Pontos de atenção) e `break-after: avoid` nos títulos; Resultados/Tarefas/Ações podem atravessar páginas entre blocos. Densidade `enxuta` usa layout compacto (perfil direto: ~3 páginas A4 com dados típicos).

---

## v3 (06/10/2026) — relatório focado em RESULTADO, acompanhamento por tarefa e retroalimentação

### Regra de perfil nova: `lista_tarefas` (config/perfis-cliente.json + coluna `perfil_cliente.tarefas_no_relatorio`)
- `true` → relatório como sempre (Volume de atividades, barra do plano, Ações concluídas, Otimizações, Tarefas que geraram resultado) **mais** as seções de resultado abaixo.
- `false` (padrão: `regras_base`) → só resultado: `[situação] → Resultados → Crescimento ou queda → Full → Tarefas que geraram venda, no detalhe → Combinações → Tarefa de cuidado → 80/20 → Pontos de atenção` (atenção só com o que **depende do cliente**; sem Volume/Ações/Otimizações/barra do plano).
- Padrão por perfil: `ansioso`, `relacionamento`, `proativo` = `true`; `analitico`, `direto`, `tecnico`, `zero_conhecimento` = `false`. A tela do cliente força "sempre mostrar / nunca mostrar / seguir o perfil" (`tarefas_override`: `true | false | null`; API `POST /api/cliente/perfil` aceita `tarefas_no_relatorio`). Sem `r.perfil` (geração antiga) o render assume `true`.

### Campos NOVOS de `montarSemanal()`
| campo | conteúdo |
|---|---|
| `desempenho` | `{ estado, leitura, queda, jogadas, ciclo_anterior }` — `estado.estado` = `queda \| estagnacao \| crescimento \| sem_base` (receita 14d × 14d, significância sobre unidades; `confirmacao_28d`, `sinal_misto`). `queda` = `{ motivos[], acoes[], tarefas[], atitudes[] }` só em queda; `jogadas` = o que fazer no estágio (estagnação/crescimento) |
| `tarefas_anuncio` | `{ resumo, cartoes[] }` (só `gerou_resultado`): por tarefa, o anúncio (`itens[]` com `thumb`, `permalink`, `preco`, `mudancas`), `quadro` (`base` + `marcos` d1/d2/d3/d7 + `hoje`, cada um com `valores`, `deltas`, `ajustado`, `motivos` ou `estado: 'aguardando'` + `disponivel_em`), `grafico.svg` (micro gráfico), `medido` (estado do motor de atribuição, confiança, ganho), `plano`, `leitura` |
| `full` | métricas do Full (`disponivel`, `tem_full`, participação, cobertura, risco de ruptura) — `disponivel:false` enquanto a logística não foi coletada (≠ "sem Full") |
| `retro` | `{ combos, pior_tarefa, pareto, limites }` |
| `proximas_acoes` | até 5 ações da fila da semana, com `retro.motivo` (por que subiram/desceram na fila) |
| `retro_erro`, `acompanhamento_erro` | motivo quando o bloco não pôde ser montado (só o relatório interno mostra) |

Honestidade (testada em `scripts/teste-semanal-render.mjs`, grupo 27+): dado que não foi coletado é "—" com o motivo; marco que ainda não fechou mostra "fecha em dd/mm"; só `Melhorou` (ajustado por grupo de controle e ruído) ou `Lançamento` (valor **bruto**, sem controle, rotulado) entram em "geraram venda"; o SVG do gráfico só entra se vier de `microGrafico()` (sem script/handler).

### Render
Novas seções em `render-semanal-resultados.js` (puro; recebe os helpers de formatação). Blocos sem dado somem do relatório do cliente; o relatório interno mostra "Seção indisponível — motivo".

## Atualização (08/10/2026): pendências do cliente por canal

`montarSemanal` devolve o campo aditivo `pendencias` (o avaliador único `src/lib/pendencias-cliente.js`, sem `detalhe_interno`; falha vira lista vazia + aviso interno; pulado no modo `leve`). O PDF ganha a seção `data-sec="pendencias"` "Pontos que dependem de você" (só quando há pendência), com a mesma explicação dos outros relatórios: por que importa, se atrasar, o que precisamos e o impacto possível (só o que o sistema mede ou prevê; senão "impacto não estimado"). A string "Depende de você" continua exclusiva do perfil proativo. Ver `docs/dependencias-cliente-por-canal.md`.
