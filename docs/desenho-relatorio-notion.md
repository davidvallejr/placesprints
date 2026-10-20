# Desenho — Relatório de Sprints Place2u enviado ao Notion do cliente (08/10/2026)

> Saída dos três desenhos que originaram o plano aprovado (~/.claude/plans/na-matriz-eisenhower-a-crystalline-beacon.md). Onde divergem, vale o plano aprovado: janela de 7 dias fechados; banco/agenda/rotas/telas/auditor do desenho 3 (robustez); conteúdo do desenho 1; agendador sexta 17h-23h e liberação por cliente (ativado_por).



---

# Parte A — Conteúdo e conversor Notion

## 0. Decisões-chave

**Motor.** `montarSemanal({cliente, de: hoje-7, ate: hoje-1, interno:false, leve:true})` (src/lib/semanal.js:86). Função pura soltas (semanal-resultados.js) não bastam: tarefas, dependências, perfil, medição e retroalimentação são lidas DENTRO de montarSemanal (:93-103, :299-337). Custo: hoje ele faz 2x relatorioNegocio, 2x relatorioAds, produtosMaisVendidos, relatorioOfertas (:131-137). O brief não usa produtos_top; por isso `leve` pula só :136 (3 linhas, PDF intacto). Efeito colateral: gravarMetricasSemana (:72-82,:159) grava a linha de 7 dias FECHADOS (de=hoje-7), idempotente e até mais correta que a linha parcial de hoje. Com ate<hoje, `parcial` (:311) fica null e o comparativo (comComparativo, meli-api.js:45) já compara dias completos com dias completos.

**Mudanças aditivas em semanal.js (PDF e testes intactos):** (1) param `leve`; (2) `proximo()` (:173-178) ganha `data_planejada: t.data_conclusao||t.data_inicio||null`, `desde: t.desde??null`, `dias_aguardando: t.dias??null`, `motivo_registrado: !!t.tipo` (a linha `...dependencias.map(d => proximo(d, d.texto))` fixada por regex em teste-semanal-dados.mjs:510 não muda); (3) retorno ganha `risco_estoque: retro?.risco_estoque||[]` (hoje só entra em atencao como texto cru, :339). Em render-semanal.js exportar RX_JARGAO (:23), TIPO_OFERTA e STATUS_OFERTA (:91-94): só `export`.

**Módulos novos** (o teste teste-semanal-rotas.mjs:241-249 proíbe /proximos/ e /semanal\.pronto\b/ em notion-publicar.js e fixa publicar-notion.mjs; por isso nada disso entra lá):
- `src/lib/relatorio-brief.js` — `criarBrief({ montarSemanal, hoje, agora, lerAcoes, eventos, inicioHistorico, negocioHoje, listarOfertas?, nomesInternos })` devolve `{ gerar(cliente, opts) }`; `gerar` chama o motor e `projetarBrief(semanal, ctx)` (PURA). Exporta também `projetarBrief`, `auditarBrief`, `PROIBIDOS`, `limparTitulo`. Molde: criarDependencias (dependencia-cliente.js:66) e scripts/teste-dependencia-cliente.mjs.
- `src/lib/relatorio-notion.js` — `briefParaBlocosNotion(brief)`, `propriedadesDaPagina(infoSchema, brief)`, `briefParaPagina(brief,{infoSchema})`, `emLotes(children,100)`, `auditarBlocos`. PURO (sem rede). A escrita (POST/PATCH) é da frente de orquestração; aqui só se entrega o payload.
- `config/relatorio-brief.json` — ajuste sem código: janela {dias:7, termina_em:'ontem'|'hoje'}, titulo_prefixo, categoria, status_notion, icone '🧭', capa_url (Notion solid_beige; suposição a validar no primeiro envio real, falha = sem capa), horizonte_dias 14, radar_dias 45, limites por bloco, regras_acao_cliente (lista BRANCA de acoes_plano), campos_mudanca, preco_min_pct 3.

## 1. Contrato do brief (neutro de formato)
```
Brief = { versao:1, cliente, hoje:'AAAA-MM-DD', hora:'HH:MM',
 janela:{de,ate,anterior:{de,ate}|null, rotulo:'01/10 a 07/10/2026'},
 titulo:'Relatório de Sprints Place2u · 01/10 a 07/10/2026',
 modo:'completo'|'sem_resultados'|'vazio',
 qualidade:{ ok, motivos:[] },          // ok=false: ML conectado mas não respondeu => envio AGENDADO adia/retenta; manual pede confirmação
 abertura:{ tom:'verde'|'amarelo'|'laranja'|'cinza', cabecalho, frase, nudge },
 resultados:{ disponivel, motivo, linhas:[{chave,rotulo,atual,anterior,variacao:{texto,sinal:'bom'|'ruim'|'igual'}|null}], hoje:{ate_hora,faturamento,pedidos}|null, nao_coletado:[], outros:[{canal,texto}] },
 atividades:{ lista:bool, concluido:{total,por_canal:[{canal,n}],grupos:[{rotulo,canal,quando,n}]}, andamento:{total,itens:[{rotulo,canal,previsto}],promocoes:[{rotulo,ate}]} },
 desenvolvimento:{ resultados:[{rotulo,canal,quando,metrica:{rotulo,texto},selo:'medido'|'hipotese'|'informado',confianca:{nivel,pct}|null}], vazio_resultados:string|null, mudancas:[{quando,texto}], vazio_mudancas:string|null },
 proximos:{ itens:[{quando:ISO,fim?:ISO,rotulo,origem:'acao'|'tarefa'|'calendario'|'promocao'}], radar:[...], agenda:{p7,p8_14}|null },
 depende:{ itens:[{rotulo,desde,dias}] },
 rodape:[string], _interno:{ avisos:[], omitidos:{} } }   // _interno NUNCA vai ao Notion
```
`hash = sha1(JSON do brief sem hora/gerado_em/_interno)` serve à frente de idempotência (reenvio idêntico pula; diferente atualiza a mesma página).

## 2. Projeção por bloco (fonte -> regra -> limite -> vazio)
**Abertura (callout).** estado = semanal.desempenho.estado (render-semanal-resultados.js:28-53: rotulo, forca, variacao_pct, janela_dias, receita{atual,anterior}, dentro_do_ruido, sinal_misto). Tom: crescimento=verde (green_background), estagnação=amarelo, queda=laranja (orange_background), sem_base/desempenho null=cinza. Frase montada dos campos estruturados, não do texto livre: `Faturamento ±X% nos últimos 14 dias (R$ a contra R$ b)`; se dentro_do_ruido: `oscilação dentro do normal`; só em queda acrescenta `Causa mais provável: …` de queda.motivos.find(!interno) (rotulada hipótese quando tipo!=='fato'). A janela do estado é fixa em 14 dias x 14 (retroalimentacao.js:553-565) e a frase DIZ isso. NÃO usa situacao.nivel (furo 7: sem prazo o semáforo 'em dia' é falso-verde); o semáforo aqui é do RESULTADO, não de prazo. Nudge (2ª linha): se depende.itens>0, `N ponto(s) aguardam o seu retorno — veja Depende de você`; senão `Próximo marco: dd/mm — …` (1º item de proximos). Sem desempenho: callout cinza `Ainda não há base de comparação suficiente para a leitura da conta; nada foi estimado.`

**Resultados.** Linhas (rotulos de negócio): Faturamento · Pedidos pagos · Ticket médio · Visitas aos anúncios · Conversão · Pedidos cancelados · [se ads.disponivel] Investimento em anúncios (Ads) · Retorno dos anúncios (ROAS) · [se regras.metricas_extras] ACOS · TACOS. Atual = resultados.ml.metricas[].valor (mesma fonte do PDF); anterior = negocio_comparativo.anterior / ads_comparativo.anterior com o mesmo tratamento (ticket null se vendas=0); variação = metrica.delta já com polaridade (cancelamento: queda é bom); delta null -> ‘—’. Formato: ▲ 2,1% / ▼ 13,5% / ▲ 0,7 p.p.; só a célula de variação leva cor (verde=bom, vermelho=ruim). valor null -> ‘—’ + motivo agrupado em `nao_coletado` (via paraCliente/MOTIVO_GENERICO; nunca zero). Canais sem API (resultados.outros): 1 linha por canal só se há dado informado; senão 1 linha cinza `TikTok Shop: sem integração automática; nenhum número informado nesta semana`. linguagem 'simples': glossa de 1 linha em Conversão/ROAS/Ticket. `Hoje (08/10), até 14:20: R$ x em n pedidos — dia em andamento, fora da comparação` vem de relatorioNegocio({de:hoje,ate:hoje}) com try/catch; falha = linha omitida. modo 'sem_resultados' (sem ML ou falhou): a seção vira 1 linha cinza com o motivo limpo e ficam Atividades + Próximos passos.

**Atividades.** lista = semanal.perfil.regras.lista_tarefas (já inclui override e o fallback de semanal.js:342-345). Concluído = semanal.acoes (janela fechada). lista=false: UMA linha `N ações concluídas — TikTok Shop 4 · Mercado Livre 1` (PDF desses clientes nem mostra volume; ver pergunta 3). lista=true: títulos limpos (limparTitulo), agrupados por título normalizado sem sufixo ‘(n)’ -> `Duplicar oferta relâmpago x4 · TikTok Shop · 02/10 a 06/10`; limite min(6, max_acoes||6). Sem nomes, sem responsavel, sem prints (furo 2). Em andamento = proximos com status andamento/validacao (sem dependência): lista=true até 5 títulos; lista=false só `N ações em andamento`. Acrescenta `Promoções no ar` de semanal.ofertas (started, rótulo TIPO_OFERTA, `até dd/mm` ou `termina hoje`); candidatas NUNCA. Bloqueadas, atrasadas e ‘sem evidência’ não vão ao cliente (viram _interno.avisos). Vazio: `Nenhuma ação concluída neste período.`

**Desenvolvimento.** (a) O que gerou resultado = tarefas_resultado.itens (medido ou informado), até max_resultados do perfil (direto=3) e no máx. 3; por item: título limpo · canal · data · métrica.rotulo: métrica.texto · selo. Selo: tipo==='informado' -> `Informado pela equipe`; confianca.nivel==='baixa' ou rotulo contém ‘hipótese’ -> `Hipótese · confiança baixa (n/100)`; senão `Medido · causa provável · confiança alta|média (n/100)`. Fora do brief: resumo, metodo, evidências, responsável, links. Vazio: `Nenhuma tarefa concluída nos últimos 45 dias tem efeito medido ou informado até agora. Só medimos o efeito de ajustes em anúncios do Mercado Livre identificados na tarefa.` (reescrito; a nota do motor cita MLB/card). (b) O que mudou nos anúncios = historico.eventosAnuncio(cliente,{de,ate}) (preco-historico.js:99; já exclui de vazio), só campos client-safe: preco (|pct|>=preco_min_pct), titulo, fotos, thumb, frete_gratis; promocao/ads/logistica só se cruzaFronteira (estado-anuncio.js:51-61); fora: estoque_zero e status (vão ao ‘Depende de você’ quando há risco). Agrupado por campo+dia: `03/10 · Preço ajustado em 3 anúncios (−4% a −8%)`, `04/10 · 5 anúncios entraram em promoção`, `05/10 · Ads ligado em 2 anúncios`, `06/10 · 1 anúncio passou a ser enviado pelo Full` (vocabulário de textoEvento, estado-anuncio.js:82). Incerteza do acomp vira `entre 02/10 e 05/10`. Sem item, ids ou nomes de produto. Limite 5. Vazio honesto: se inicioHistorico(cliente) é null ou > de: `O histórico de mudanças dos anúncios desta conta ainda não cobre toda a semana; não afirmamos que não houve mudanças.`; senão `Nenhuma mudança relevante de preço, promoção, Ads ou Full registrada nesta semana.`

**Próximos passos** (só data FUTURA >= hoje, até hoje+14; máx. 8 + radar 2). Fontes e dedupe, nesta prioridade: (1) lerAcoes({clientes:[c], status:['aprovada','distribuida']}) (plano-cliente.js:495) com regra na LISTA BRANCA (anuncio_catalogo_buybox, anuncio_ima_conversao, anuncio_conteudo_fotos, anuncio_frete_gratis, anuncio_ads_*, anuncio_oferta_*, anuncio_promocao_giro, anuncio_sazonal, anuncio_duplicacao_estrategica, anuncio_full_envio, calendario); ficam FORA proposta/obsoleta/descartada e as internas (sem_responsavel, sem_plano_mes, backlog_parado, alavanca_precificacao, anuncio_preco_mudou_vendas_cairam, anuncio_cadastrar_custos); quando=prazo; título sem (MLB…), cortado em palavra. anuncio_estoque_ruptura NÃO entra aqui: vai só em Depende de você (dedupe). (2) tarefas nao_iniciada com data_planejada (novo campo) entre hoje e hoje+14, descartando as com sufixo ‘· PS-xxxx’ cujo id já está nas ações (são a mesma coisa distribuída) e as de reposição; lista=true: agrupadas por título limpo; lista=false: UMA linha final `Até 22/10 · 32 ações já agendadas pela equipe (20 nos próximos 7 dias, 12 na semana seguinte)`. (3) calendário comercial: acoes calendario (já filtradas por universal) com prazo entre hoje+15 e hoje+45 vão ao radar: `No radar: preparar a Black Friday (27/11)`. (4) ofertas de semanal.ofertas: pending com início futuro e started com fim em <=14 dias (`Fim da oferta do dia/campanha em vigor`, `Campanha programada para 15/10`). Nunca: renovação/vencimento (vencimentos_json), proposta, candidata, data vencida (54 abertas do União Dog com data planejada vencida ficam em _interno.avisos: furo 7). Ordem: data crescente; linha-resumo por último. Vazio: `Sem datas futuras confirmadas para os próximos 14 dias.`

**Depende de você.** Sem responsável, sem prazo (regra do render, render-semanal.js:523-525). Itens: (a) proximos com dependencia_cliente: motivo_registrado -> texto do registro (`Tipo: detalhe`, já escrito para o cliente ler: dependencia-cliente.js:34,213); SEM registro (dependencia_cliente === SEM_MOTIVO, :38) -> texto neutro `Aguardamos um retorno seu sobre esta tarefa`, agrupando títulos iguais (`(2 tarefas)`) + `desde dd/mm (N dias)` do campo desde/dias_aguardando (furo 1 resolvido SEM tocar semanal.js:207 nem o texto do PDF, que é pinado por regex em teste-semanal-dados.mjs:508); (b) risco_estoque: `Repor estoque de N anúncios que mais vendem (cobertura abaixo de 10 dias): A, B (+N)` (nome cortado em palavra, sem MLB). Limite 5. Vazio: seção omitida (e o nudge da abertura some).

**Rodapé** (gray, 4 linhas curtas): ver honestidade.

## 3. Filtro client-safe (módulo relatorio-brief.js, testável)
`PROIBIDOS = [{id, rx}]` aplicado a TODA string visível (exceto o prefixo fixo do título): sem_motivo (/sem motivo registrado|registre pela tela|painel executivo/i); id_interno (/\bPS-[0-9a-f]{6,}|\bMLB-?\d{6,}|ID do Produto|\d{13,}/i); notion (/notion|fonte oficial|place sprints/i); jargao = RX_JARGAO (render-semanal.js:23); comprovado (/comprovad/i); efeito_observado (/efeito observado/i — informado nunca vira ‘observado’); vocabulario_interno (/\bcard(s)?\b|respons[aá]vel|analista|consultor|renova[çc][ãa]o|vencimento|churn|mensalidade|fict[ií]cio|uso interno/i); promessas = termosPromocionais(texto, config/ofertas.json termos_proibidos.promessas) (ofertas-diagnostico.js:19-23; módulo puro); nomes = nomes lidos de semanal.acoes[].responsavel, proximos[].responsavel, atividades.equipe[].nome e analistas oficiais (palavra inteira, >=3 letras, sem acento); lixo (/undefined|NaN|\[object|R\$ ?0,00\b/). Duas camadas: (1) `limparTitulo(s, canal)`: 1ª linha; remove ‘· PS-…’, ‘(MLB…)’, ids de 10+ dígitos e ‘ID do Produto: …’, sufixo ‘(n)’ (vira chave de grupo), pontuação sobrando; corta em 70 na palavra; se ainda bater em PROIBIDOS -> genérico `Ajuste de rotina — {canal}` e contador em _interno.omitidos (conta continua verdadeira). (2) `auditarBrief(brief,{nomes})` e `auditarBlocos(children)` percorrem o que vai ao Notion; qualquer violação restante lança BriefInseguro com {regra, caminho} (mensagem SEM ecoar o texto) e o envio não acontece.

## 4. Furos 1–9 no brief (sem quebrar o PDF)
1 SEM_MOTIVO: texto neutro por motivo_registrado + auditoria (acima). 2 Nomes: o brief nunca lê responsavel/equipe; auditoria por nomes. 3 Títulos: limparTitulo. 4 proximas_acoes técnicas: não usadas; ação do plano passa por lista branca + título limpo + agrupamento. 5 ‘Bloqueio:’ cru: bloqueadas nunca listadas; atencao[] não é lida (só proximos/risco_estoque estruturados). 6 delta parcial: janela fechada + hoje à parte. 7 prazo NULL: sem semáforo de prazo; vencidas só em _interno.avisos (`54 tarefas abertas com data planejada vencida`). 8 aviso_coleta: não renderizado hoje; o brief traduz `nao_coletado` e `qualidade.motivos` em linha visível (`Não coletado nesta semana: …`). 9 de/ate: montarBrief valida hoje (^\d{4}-\d{2}-\d{2}$ e data real) antes de chamar o motor e deriva de/ate; ate inválido nunca chega a new Date().toISOString() (RangeError). No PDF só se mexe em exports e nos 3 campos aditivos.

## 5. Conversor Notion (relatorio-notion.js)
`rt(texto,{bold,color,gray})` quebra em segmentos <=1900 (não trunca silenciosamente; trunca com ‘…’ só acima de 3 segmentos). Sequência de blocos (em ordem):
1 callout{icon:🧭,color por tom,rich_text:[negrito cabecalho + frase + nudge]} · 2 paragraph gray `Gerado em dd/mm/aaaa às HH:MM · Últimos 7 dias fechados: de a ate · Comparado com: anterior` · 3 divider · 4 heading_2 `Resultados` · 5 paragraph gray (subtítulo canal+janelas) · 6 table{table_width:4,has_column_header:true,header: Indicador | de a ate | anterior | Variação} · 7 paragraph `Hoje …` (se houver) · 8 paragraph gray `Não coletado …` / outros canais · 9 heading_2 `Atividades` + heading_3 `Concluído (de a ate)` + bullets · heading_3 `Em andamento` + bullets · heading_2 `Desenvolvimento` + heading_3 `O que gerou resultado` + bullets (negrito no título; selo em itálico cinza) + heading_3 `O que mudou nos anúncios` + bullets/linha vazia · heading_2 `Próximos passos` + table{width:2: Quando | O que vem} (+ linhas ‘No radar’) · heading_2 `Depende de você` + bullets · divider · rodapé (paragraphs gray). Tabelas contam como 1 bloco de topo com filhos; hoje <=100 filhos, mas `emLotes(children,100)` mantém tabela inteira no lote (1º lote no POST pages, resto em PATCH blocks/{id}/children, padrão distribuir-notion.js:262). Sem column_list/quote (não usados no projeto). Heading apenas h2/h3 (h1 reservado ao título).
**Propriedades** `propriedadesDaPagina(infoSchema, brief)` — infoSchema = data_sources/{id}.properties (como placeplan.js:129-136). SEMPRE a chave exata lida do esquema (ex.: ‘Lista ’, ‘Secção ’, ‘Status’): casar com normNome (equipe.js:15) e gravar com a chave original. título: a chave do tipo title. Status: propriedade cuja chave normalizada é ‘status’, tipo select|status; opção cujo normNome = ‘concluido’ (grafia da base: ‘Concluído’); select sem a opção -> cria com nome ‘Concluído’; status sem a opção -> omite + aviso. Secção: chave normalizada começando por ‘sec’, tipo select OU status (placeplan.js:135 só aceita status: bug a corrigir lá depois); opção normNome = ‘relatorio de sprints place2u’; select sem a opção -> cria (API cria opção de select) com o nome canônico; status sem a opção -> NÃO grava e devolve avisos[{codigo:'categoria_pendente', msg:'A base deste cliente tem Secção do tipo Status sem a opção Relatório de Sprints Place2u — crie a opção uma vez no Notion e reenvie para categorizar'}] (mesmo padrão de MSG_NOTION[400] em dependencia-cliente.js:56-61). A página é publicada mesmo assim (o título já carrega o prefixo para filtro). ‘Status 1’ e ‘Link ’ ficam vazios. Se existir date /^data$/i, start=hoje (notion-publicar.js:169). icon 🧭; cover external da config (sem capa se vazia). Dedupe/ idempotência: título é função determinística de (hoje); busca por title equals na base (padrão placeplan.js:141-145). O título nunca casa com parseTituloPlano (plano-informacoes.js:17-22) nem contém ‘PlacePlan’.

## 6. Exemplo A — União Dog (Uniaodog Artigos Pet), 08/10/2026 14:20 (perfil direto+técnico, tarefas_no_relatorio=0)
Números atuais REAIS de metricas_semana (01–07/10); marcados ‹…› os que dependem do comparativo ao vivo, pois o banco só guarda a semana corrente.
🧭 [callout amarelo] **Conta em estagnação.** Faturamento ‹−x%› nos últimos 14 dias (R$ ‹a› contra R$ ‹b›); oscilação dentro do normal. 2 pontos aguardam o seu retorno — veja Depende de você.
Gerado em 08/10/2026 às 14:20 · Últimos 7 dias fechados: 01/10 a 07/10 · Comparado com 24/09 a 30/09
## Resultados — Mercado Livre
| Indicador | 01/10 a 07/10 | 24/09 a 30/09 | Variação |
| Faturamento | R$ 5.988,09 | ‹…› | ‹…› |
| Pedidos pagos | 115 | ‹…› | ‹…› |
| Ticket médio | R$ 52,07 | ‹…› | ‹…› |
| Visitas aos anúncios | 1.263 | ‹…› | ‹…› |
| Conversão | 9,1% | ‹…› | ‹… p.p.› |
| Pedidos cancelados | — | — | — |
| Investimento em anúncios (Ads) | R$ 211,32 | ‹…› | — |
| Retorno dos anúncios (ROAS) | 8,14 | ‹…› | ‹…› |
| ACOS | 12,28% | ‹…› | ‹…› |
| TACOS | 3,53% | ‹…› | ‹…› |
Hoje (08/10), até 14:20: R$ ‹…› em ‹n› pedidos — dia em andamento, fora da comparação acima.
Não coletado nesta semana: pedidos cancelados (não retornado pelo Mercado Livre). TikTok Shop e Shopee: sem integração automática; nenhum número informado nesta semana.
## Atividades
Concluído (01/10 a 07/10) · 5 ações concluídas — TikTok Shop 4 · Mercado Livre 1.
Em andamento · 2 ações em andamento. Promoções no ar: Oferta do dia/Campanha, até 13/10 · Campanha do vendedor, termina hoje (08/10).
## Desenvolvimento
O que gerou resultado · ‹se vazio› Nenhuma tarefa concluída nos últimos 45 dias tem efeito medido ou informado até agora. Só medimos o efeito de ajustes em anúncios do Mercado Livre identificados na tarefa.
O que mudou nos anúncios · O histórico de mudanças dos anúncios desta conta ainda não cobre toda a semana; não afirmamos que não houve mudanças. (o banco tem 6 eventos de promoção e 15 de preço, todos de 28/09, fora da janela, e fonte ‘promo’, não ‘coleta’).
## Próximos passos
| Terça, 13/10 | Fim da oferta do dia/campanha em vigor |
| Quinta, 15/10 | Recuperar a caixa de compra de um anúncio de mordedor natural para cachorro |
| Quarta, 28/10 | No radar: preparar a Black Friday (27/11) |
| Até 22/10 | 32 ações já agendadas pela equipe (20 nos próximos 7 dias, 12 na semana seguinte) |
## Depende de você
• Repor estoque de 5 anúncios que mais vendem (cobertura abaixo de 10 dias): Guia Unificada Adestramento…, Trança de Pele Bovina… (+3).
• Otimização e inserção de clips (2 tarefas) — aguardamos um retorno seu · desde 02/10 (6 dias).
Rodapé (ver honestidade). Reposição NÃO se repete em Próximos passos (dedupe); as 7 ações de ruptura, as ‘Atribuir responsável…’, ‘Montar o plano…’ e ‘Revisar 24 tarefas paradas’ do plano NÃO aparecem (internas).

## 7. Exemplo B — cliente que lista tarefas (SINTÉTICO, perfil relacionamento+ansioso)
🧭 [callout verde] **Conta em crescimento.** Faturamento +12,4% nos últimos 14 dias (R$ 31.200,00 contra R$ 27.760,00). Próximo marco: 09/10 — novas fotos do kit de jardinagem.
Resultados: tabela de 8 linhas completa com anterior e variação (faturamento R$ 14.920,00 contra R$ 13.410,00, ▲ 11,3%; pedidos cancelados 6 contra 9, ▼ 33,3% em verde porque cair é bom).
Concluído (6 ações): 03/10 · Novas fotos do kit de jardinagem · Mercado Livre — 02/10 a 06/10 · Revisão de títulos x4 · Mercado Livre — 05/10 · Ajuste de preço e frete grátis · Mercado Livre — 06/10 · Criação de vídeos (teste) · TikTok Shop.
Em andamento (3): Ficha técnica da linha de mangueiras — previsto 10/10 · …
Desenvolvimento / O que gerou resultado: **Novas fotos do kit de jardinagem** · Mercado Livre · 30/09 — Faturamento adicional (causa provável): + R$ 1.240 · Medido · confiança média (72/100). **Ajuste de título da mangueira 30 m** · 28/09 — Efeito em unidades vendidas (hipótese — confiança baixa): +9,1% · Hipótese · confiança baixa (48/100). **Recuperação de carrinho abandonado** · Resultado informado pela equipe: 14 pedidos recuperados · Informado pela equipe.
O que mudou nos anúncios: 03/10 · Preço ajustado em 3 anúncios (−4% a −8%) · 04/10 · 5 anúncios entraram em promoção · 05/10 · Ads ligado em 2 anúncios · 06/10 · 1 anúncio passou a ser enviado pelo Full.
Próximos passos: 09/10 Novas fotos do kit de jardinagem · 10/10 Ficha técnica da linha de mangueiras · 14/10 Duplicação de anúncio para teste de palavras-chave · 22/10 No radar: preparar a Black Friday (27/11).
Depende de você: Fotos do produto: enviar as fotos do kit novo — aguardando desde 01/10 (7 dias).

## 8. Modo mínimo e casos
sem ML conectado: abertura cinza + Resultados vira 1 linha (`Conta do Mercado Livre ainda não conectada ao relatório; nenhum número foi estimado.`), semanal.js:342-345 já força lista_tarefas=true, ficam Atividades e Próximos passos. ML conectado mas falhou: qualidade.ok=false (`O Mercado Livre não respondeu na geração deste relatório`): agendado retenta, manual pede confirmação. Nada a dizer (sem resultados, sem atividades, sem próximos, sem depende): modo ‘vazio’ -> não cria página, devolve motivo. Cliente sem Informações/página: erro da camada de escrita, não do brief.

---

# Parte B — Banco, calendário, rotas, agendador e telas (versão alternativa)

## 0. Fatos conferidos que moldam o desenho

- Não existe sync periódico no servidor. `sincronizar()` só roda por webhook (src/server.js:205-210) e pelo botão (:113-120). `ultimo_sync` no banco local está em 2026-10-07T02:58Z, ou seja, mais de 34 h atrás. O agendador precisa garantir base fresca antes de enviar. O script antigo fazia isso com `sincronizar()` na linha 31 de scripts/publicar-notion.mjs.
- `sync_log` não tem coluna `id` (PRAGMA table_info: em, nivel, msg), mas a poda em db.js:268 usa `id`. Ela falha em silêncio dentro do try e o log nunca é podado. Não é bloqueante para este trabalho (ver riscos).
- `descobrirFontes()` (descobrir.js:116) faz varredura do Notion inteiro. placeplan.js `infoDbDe` (:113-123) a chama a cada publicação. Em lote isso é inviável: `resolverBase` tem de memoizar a lista por 10 min (mesmo TTL_MS de dependencia-cliente.js:51).
- `acharInformacoesDb` não cacheia null (plano-informacoes.js:56-65). O agendador cacheia o `sem_base` em relatorio_envio e reconsulta no máximo 1× por dia.
- Hoje: 177 clientes na central, 173 "Ativo", 2 "Congelado", 1 "Desligado", 1 "Processo de Desligamento". config/equipe.json só exclui Desligado e Congelado, então "Processo de Desligamento" passaria. O envio automático usa lista própria de status elegíveis.
- Fuso: `hojeLocal` (db.js:259) usa o fuso da máquina. O agendador usa `Intl` com America/Sao_Paulo. Sem horário de verão desde 2019, então é UTC-3 fixo, e o resultado coincide com o da máquina. `montarSemanal` aceita `ate` explícito (semanal.js:87-91). Sempre passamos `ate` para a chave `de/ate` da idempotência ser a mesma da página.

## 1. Banco

Arquivo novo src/lib/envio-relatorio.js exporta `SCHEMA_ENVIO_RELATORIO` (mesmo molde de SCHEMA_DEPENDENCIA, dependencia-cliente.js:6). Ele não importa db.js, para evitar import circular. db.js ganha `import { SCHEMA_ENVIO_RELATORIO } from './envio-relatorio.js'` junto das linhas 2-7 e `db.exec(SCHEMA_ENVIO_RELATORIO)` logo após db.js:255. É aditivo (CREATE IF NOT EXISTS) e não altera tabela existente.

```sql
CREATE TABLE IF NOT EXISTS relatorio_envio_cfg (
  cliente TEXT PRIMARY KEY,                       -- nome canônico da central (nunca do corpo cru)
  frequencia TEXT NOT NULL DEFAULT 'desligado' CHECK (frequencia IN ('desligado','semanal','quinzenal','mensal')),
  proximo_envio TEXT NOT NULL DEFAULT '',         -- AAAA-MM-DD no calendário de São Paulo; '' quando desligado
  ancora_dia INTEGER,                             -- só mensal: dia do mês (1-31) que a cadência tenta manter
  ultimo_envio_em TEXT NOT NULL DEFAULT '',       -- ISO do último estado 'enviado' (denormalizado para a lista)
  ultimo_ate TEXT NOT NULL DEFAULT '',            -- fim do período do último envio
  por TEXT NOT NULL DEFAULT '',                   -- líder/consultor que programou = quem autoriza os envios automáticos
  atualizado_em TEXT NOT NULL                     -- quando programou
);
CREATE TABLE IF NOT EXISTS relatorio_envio (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente TEXT NOT NULL, de TEXT NOT NULL, ate TEXT NOT NULL,       -- de = ate - 6 dias
  modo TEXT NOT NULL,                             -- agendado | antecipado | imediato (origem do clique)
  estado TEXT NOT NULL,                           -- pendente | enviado | falhou | sem_base | pulado
  notion_page_id TEXT NOT NULL DEFAULT '', notion_url TEXT NOT NULL DEFAULT '',
  categoria_gravada INTEGER NOT NULL DEFAULT 0,   -- 1 = a propriedade da categoria foi gravada na página
  conteudo_hash TEXT NOT NULL DEFAULT '',         -- sha1 do brief (sem horário de geração): igual = não reescreve
  tentativas INTEGER NOT NULL DEFAULT 0,
  erro TEXT NOT NULL DEFAULT '',                  -- mensagem FIXA por causa; nunca o texto da exceção
  por TEXT NOT NULL DEFAULT '',                   -- no agendado, cfg.por
  criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL, enviado_em TEXT NOT NULL DEFAULT '',
  UNIQUE (cliente, de, ate)
);
CREATE INDEX IF NOT EXISTS ix_relatorio_envio_cli ON relatorio_envio (cliente, ate DESC);
```

Decisões do schema:
- CHECK só em `frequencia`, que é estável. `estado` e `modo` são validados em código. O repositório já precisou de `migrarMudanca` para ampliar um CHECK, e aqui evitamos o custo (migração = recriar tabela).
- Estado da base e da categoria no Notion fica em `sync_estado` com a chave `relatorio_base:{cliente}`, valor JSON `{estado:'ok'|'sem_opcao'|'sem_base'|'desconhecida', propriedade, opcao, em}`. Segue o padrão das chaves `info:`/`barra:`/`placeplan:` e evita mais uma tabela.
- Nenhum cliente nasce programado. Sem linha em cfg equivale a `desligado`. A ativação é consciente, por squad/consultor, e é o que registra "quem autorizou".

## 2. Config: config/relatorio-envio.json (validada na carga, como perfis-cliente.js:20-35)

```json
{
  "hora_inicio": "17:00", "hora_fim": "22:00",
  "dia_semana_padrao": 5,
  "status_cliente_elegiveis": ["Ativo"],
  "tolerancia_dias": { "semanal": 3, "quinzenal": 5, "mensal": 7 },
  "janela_antecipacao_dias": { "semanal": 3, "quinzenal": 7, "mensal": 15 },
  "lote_por_tick": 6, "lote_max_manual": 25,
  "tentativas_max_por_dia": 3, "reintentar_apos_min": 60,
  "sync_max_horas": 12,
  "categoria": "Relatório de Sprints Place2u"
}
```
`hora_inicio`/`dia_semana_padrao` herdam a regra do plist atual (sexta 17h), em que o dia já está quase completo. `categoria` é fonte única do nome. O publicador (outra perspectiva) lê o valor daqui.

## 3. Regras de calendário (funções puras exportadas, testáveis sem banco)

Aritmética em UTC sobre strings AAAA-MM-DD (não reaproveita `addDias` de meli-serie.js:16, que depende do fuso da máquina).
- `hojeSP(date)` e `horaSP(date)` via `Intl.DateTimeFormat('en-CA', {timeZone:'America/Sao_Paulo', hourCycle:'h23'})`.
- `janelaDe(ate)` = `{de: ate-6, ate}`. O conteúdo é sempre a janela deslizante de 7 dias.
- `proximaData({frequencia, base, ancora, hoje})`: semanal = base+7; quinzenal = base+14; avança de intervalo em intervalo até ser > hoje (nunca devolve data no passado).
- **Mensal = mesmo dia do mês seguinte, com âncora.** Escolhi isso em vez de "+30 dias": +30 deriva (a data anda 1-2 dias por mês) e o cliente não entende "todo dia 10". A âncora `ancora_dia` é o dia do mês da data programada ao ativar ou editar. Em mês curto usa o último dia (31/01 → 28/02 → 31/03; 2028 → 29/02), sem deriva porque o cálculo sempre parte da âncora. O padrão de ativação cai numa sexta; a âncora é limitada a 28 no padrão. Só uma data digitada à mão pode ter âncora 29-31.
- **Programação padrão** (ativar sem data): próxima sexta; se hoje é sexta e ainda não são 17h, é hoje; se já passou, +7. Quinta 08/10/2026 → 09/10/2026. Vale para as três frequências.
- **Envio perdido** (servidor desligado na hora): no tick elegível, se `hoje - proximo_envio <= tolerancia_dias[freq]` envia UM relatório, com a janela de 7 dias terminando hoje, e o próximo passa a ser `proximaData(base = a data programada, não a do envio)`. Assim a sexta continua sendo sexta mesmo com envio no sábado. Se passou da tolerância, grava uma linha `pulado` (de/ate = janela da data programada, erro "pulado: o envio não ocorreu no prazo"), avança para a próxima data > hoje e entra no resumo diário. Nunca envia dois períodos acumulados, porque a janela é sempre a de hoje.
- **Envio antecipado/imediato**: o botão "Enviar relatório antecipadamente" (lista) e o "Enviar agora" (cliente) têm a MESMA regra. O `modo` só registra a origem. Decisão: o envio **consome** a programação vigente se ela vence em até metade do intervalo (`janela_antecipacao_dias`: 3/7/15 dias). Aí `proximo_envio = proximaData(base = a data programada)`. O ritmo (a sexta) é preservado, e o cliente não recebe dois relatórios sobrepostos em dois dias. Se a programação está mais longe que a janela, o envio é **avulso**: a data não muda. Um envio sem programação (desligado) nunca cria programação. Justificativa: "antecipar" é fazer o envio programado antes da hora. Reiniciar a contagem a partir de hoje (hoje+7) tiraria o cliente da sexta para sempre. O diálogo mostra o efeito ("Próximo envio: 10/10 → 17/10" ou "continua em 10/10: este envio é avulso") e o líder pode editar a data depois.
- **Mesmo dia, mesma janela** (antecipado + agendado, ou reenvio): a chave UNIQUE (cliente, de, ate) vale. Linha `enviado` + mesmo `conteudo_hash` → `ja_enviado` (não escreve no Notion). Hash diferente → `atualizada` (publicar recebe o `page_id` existente). Nunca duas páginas.

## 4. Fábrica `criarEnvioRelatorio(handle, deps)`

```js
criarEnvioRelatorio(handle, {
  cfg,                 // config/relatorio-envio.json já validada
  agora,               // () => ISO. De 'agora' sai hoje/hora SP; o teste injeta o relógio
  montarBrief,         // async ({cliente, de, ate}) => brief. Perspectiva do conteúdo. Chama montarSemanal({cliente, de, ate, interno:false}) + projeção curta. NÃO escreve
  resolverBase,        // async (cliente) => {ok, motivo?, infoDb, dsId, categoria:{estado, propriedade, tipo, opcao}}. Só lê o Notion; memoiza descobrirFontes por 10 min
  publicar,            // async ({cliente, base, brief, existente:{page_id}|null, dryRun}) => {acao:'criada'|'atualizada'|'previa', page_id, url, titulo, categoria_gravada, propriedades, secoes}
  validarPor,          // equipe.validarLiderOuConsultor
  clienteAtivo,        // (cliente) => bool: status em cfg.status_cliente_elegiveis e não é '[Comercial] …'
  notificar, log, getEstado, setEstado, baseSync   // injetados: o núcleo não importa db.js
}) → { config, definirFrequencia, enviar, enviarLote, tick, agenda, historico }
```
Contrato exigido do `publicar` (outra perspectiva): (a) consultar a base por título exato antes de criar. É a segunda camada de idempotência, contra a queda entre o POST e o UPDATE local. (b) criar com `notionReq(..., {retry5xx:false})`. (c) o título NÃO pode casar `/^([a-zç]+)\s*\/\s*(\d{2,4})\s*-\s*(.+)$/` nem conter "PlacePlan" (plano-informacoes.js:85-115 ingeriria a página como plano). (d) em erro lançar `Error` com `.status` e `.codigo` ('sem_base'|'sem_permissao'|'arquivada'|'indisponivel'). O núcleo converte em mensagem fixa e nunca repassa `e.message`.

**Runner com lock por cliente** (dentro do módulo, ~15 linhas): `const emVoo = new Set()`; `comTrava(cliente, fn)` lança erro 409 "já existe um envio em andamento para este cliente" se o cliente está no Set, e libera em `finally`. Não consulta `ativo`/`jobs` de rotas-planos.js:50-61, então o envio manual nunca é bloqueado por um job de planos, e o agendador e o manual não colidem no mesmo cliente. Clientes diferentes rodam em paralelo (o throttle de 350 ms do notionReq, notion.js:14, serializa as chamadas ao Notion).

**Fluxo `enviar({cliente, modo, confirmar, por, ate?})`**
1. `confirmar !== true` (tipo estrito) → prévia. Sem `por`. Chama `montarBrief`, `resolverBase` e `publicar({dryRun:true})`. NENHUMA escrita no Notion nem no banco, exceto o cache `relatorio_base:{cliente}` em sync_estado. Devolve janela, título, categoria, `ja_enviado`, `acao_prevista` (criar/atualizar/nada_a_fazer/bloqueado), `programacao:{proximo_atual, proximo_novo, consome}`, seções do brief com contagens, `avisos`. Aviso de base velha: `base_sync` > 24 h → "a base de tarefas foi atualizada há N horas".
2. `confirmar === true` exige `por` válido via `validarPor`; senão 403 "só líderes e consultores da central podem enviar o relatório". Se `ate` vier do front e for ≠ hoje SP, 409 "o dia mudou desde a prévia; faça a prévia de novo".
3. `comTrava`. `INSERT ... ON CONFLICT(cliente,de,ate) DO UPDATE SET estado='pendente', tentativas=tentativas+1`. Linha `enviado` com mesmo hash curto-circuita para `ja_enviado`.
4. `resolverBase` → se `!ok`, estado `sem_base` (nada é escrito no Notion).
5. `publicar(...)`. Sucesso → numa única `handle.transaction`: linha `enviado` (page_id, url, categoria_gravada, hash, enviado_em), `cfg.ultimo_envio_em/ultimo_ate`, `proximo_envio` conforme a regra de consumo. Falha → linha `falhou`, `erro` = mensagem fixa, a programação NÃO avança.
6. Mensagens fixas (nunca eco): `sem_base` "este cliente ainda não tem a base «Informações» no Notion"; `sem_permissao` "a integração não tem permissão para criar páginas nesta base"; `arquivada` "a página anterior foi apagada no Notion; envie de novo"; `indisponivel`/outros "Notion indisponível agora, tente de novo"; falha do brief "não foi possível montar o relatório agora".

**`tick({agoraDate})` (usado pelo agendador)**
1. Sai se a hora SP < `hora_inicio` ou ≥ `hora_fim`. Os envios só ocorrem entre 17h e 22h, nunca de madrugada. Um vencido de sexta, com o servidor desligado, sai sábado às 17h.
2. Seleciona `frequencia<>'desligado' AND proximo_envio<>'' AND proximo_envio<=hoje ORDER BY proximo_envio, cliente`, filtra por `clienteAtivo`.
3. Marca como `falhou` ("interrompido") toda linha `pendente` com mais de 15 min (queda no meio).
4. Aplica tolerância (pula os vencidos demais), cooldown (`falhou` há < `reintentar_apos_min` ou ≥ `tentativas_max_por_dia` → ignora; `sem_base` → no máximo 1×/dia).
5. Pega os primeiros `lote_por_tick`. Antes do primeiro envio do dia chama `garantirBase()`; se `ultimo_sync` > `sync_max_horas` roda `sincronizar()`. Se falhar e a base ficar > 48 h, adia o tick e emite UM alerta por dia (dedupeMin 1440) "Envio de relatórios adiado: a base do Notion não é atualizada há N horas". Sequencial, com try/catch por cliente (uma falha nunca derruba os outros), `log('info'|'erro', ...)` por cliente sem eco, parando de iniciar clientes após `hora_fim`.
6. Notificação: `notificar` com UM resumo (sucesso) por dia, quando a fila do dia esvazia e `sync_estado.relatorio_resumo_dia != hoje`. Texto: "Relatórios de sprint enviados ao Notion: 12 de 14. 2 com problema, 1 pulado." link `/planos#secEnvios`. Cada falha gera `notificar({tipo:'relatorio_falhou', nivel:'erro', cliente, titulo, corpo: mensagem fixa, link:'/cliente?cliente=…&aba=configurar', dedupeMin:720})`. `sem_base` usa nível `alerta` e `dedupeMin 1440`. Em lote, o alerta.js (toast + som por item novo) não vira enxurrada.

## 5. Rotas: src/rotas-relatorio-envio.js (fábrica, estilo rotas-dependencia.js:1-21)

`criarRotasRelatorioEnvio({ envio, clienteCanonico, quem, resolverEscopo, cfg })`. Mesmo `trata` de rotas-dependencia.js:13 (erro com `.status` vira JSON com mensagem fixa; sem status vai para o handler global de server.js, 500 genérico). Mesmo helper `json()` (415 sem `application/json`, corpo não-objeto vira `{}`). Todas as validações usam mensagens fixas, sem eco do valor recebido. Cliente: `clienteCanonico` (carregarClientes) devolve null para prospect `[Comercial] …` e para inexistente → 404 "cliente não encontrado na central".

| Rota | Corpo / query | Resposta | Erros |
|---|---|---|---|
| GET /api/cliente/relatorio-envio?cliente= | | `{cliente, config:{frequencia, rotulo, proximo_envio, por, atualizado_em}, sugestao_proximo, padrao:{hora_inicio, dia_semana, tolerancia_dias}, janela_atual:{de,ate}, ultimo:{estado,ate,enviado_em,url,categoria_gravada,modo}\|null, categoria_notion:{estado, propriedade, opcao, verificado_em}, historico:[≤20], opcoes:[{id,rotulo}], quem:[...], base_sync:{ultimo_sync, horas}}` | 400 sem cliente, 404. NUNCA chama Notion nem ML (só banco); `categoria_notion.estado` = 'desconhecida' até a 1ª prévia/envio |
| POST /api/cliente/relatorio-envio/config | `{cliente, frequencia, proximo_envio?, por}` | `{ok, config, avisos[]}` | 415; 400 "frequencia deve ser desligado, semanal, quinzenal ou mensal"; 400 "proximo_envio deve ser uma data AAAA-MM-DD válida"; 400 "o próximo envio não pode estar no passado" (e máximo hoje+400); 403 "só líderes e consultores da central podem programar o envio"; 404 |
| POST /api/cliente/relatorio-envio/enviar | `{cliente, modo:'imediato'\|'antecipado', confirmar?, por?, ate?}` | prévia (200, `previa:true`) ou `{ok, acao:'criada'\|'atualizada'\|'ja_enviado', url, categoria_gravada, programacao:{proximo_envio, consumiu}, id}` | 400 modo inválido; 403 por; 409 (envio em andamento / dia mudou / base sem Informações: `{erro, codigo:'sem_base'}`); 502 "Notion indisponível agora, tente de novo" (a linha `falhou` é gravada) |
| POST /api/relatorios/antecipar | `{clientes[]` ou `escopo:{tipo,squad,consultor,clientes}, confirmar?, por?}` | prévia: LEVE, só banco (sem montar brief nem tocar o Notion por cliente): `{total, a_enviar, ja_enviados_hoje, sem_base_conhecida, sem_programacao, avancam, clientes:[{cliente, frequencia, proximo_atual, proximo_novo, ja_enviado_hoje, base:'ok'\|'sem_base'\|'desconhecida'}], janela}`. `confirmar:true` → `{job, total}` | 400 "informe clientes ou escopo"; 400 "escolha no máximo 25 clientes por vez (hoje: N)"; 403; 409 "já existe um lote de relatórios em andamento" |
| GET /api/relatorios/job/:id | | `{id, tipo:'relatorios', estado:'rodando'\|'concluido'\|'erro', progresso:{feitos,total,cliente}, resultado:{criados[], atualizados[], ja_enviados[], falhas:[{cliente,motivo}]}}` | 404 |
| POST /api/relatorios/frequencia | `{clientes[]` ou `escopo, frequencia, proximo_envio?, por, confirmar?}` | prévia por padrão: `{total, mudam, iguais, primeiro_envio, clientes:[{cliente, de, para, proximo_novo}], aviso_carga}`; `confirmar:true` grava e devolve `{ok, alterados}` | os mesmos de config; limite 200 clientes |
| GET /api/relatorios/agenda | | `{hoje, itens:[{cliente, frequencia, proximo_envio, ultimo_envio_em, ultimo_url, ultimo_estado, situacao:'agendado'\|'vence_hoje'\|'atrasado'\|'falhou'\|'sem_base'}] ordenado por proximo_envio, totais:{programados, vencem_hoje, atrasados, com_problema}, quem:[...]}` | |

`antecipar` em lote roda um job próprio (Map de ≤20 jobs, 1 lote por vez, lock separado de rotas-planos.js:50) e processa sequencialmente. Cada cliente passa por `enviar({modo:'antecipado', confirmar:true, por})` com o lock por cliente. Cliente em voo vira falha "envio em andamento". Escopo `total` com mais de 25 clientes é recusado já na prévia.

`GET /api/relatorios/agenda` evita mexer em `/api/planos/clientes` (rotas-planos.js:201-214): o front junta por nome.

Montagem: `app.use(criarRotasRelatorioEnvio(...))` em server.js junto de :61, antes do `express.static` (:62).

## 6. Agendador em src/server.js

Após :402 (antes do handler de erros), no mesmo estilo dos laços:
```js
const envioRelatorio = criarEnvioRelatorio(db, { cfg: cfgEnvio, agora, montarBrief, resolverBase, publicar, validarPor: validarLiderOuConsultor, clienteAtivo, notificar, log, getEstado, setEstado, baseSync })
let enviandoRelatorios = false
async function tickRelatorios() {
  if (enviandoRelatorios) return
  enviandoRelatorios = true
  try { await envioRelatorio.tick({ garantirBase }) } catch (e) { log('erro', `envio de relatórios: ${String(e.message).slice(0, 160)}`) }
  finally { enviandoRelatorios = false }
}
setTimeout(tickRelatorios, 90_000); setInterval(tickRelatorios, 10 * 60 * 1000)
```
`garantirBase` usa a MESMA flag `sincronizando` de :113 (um sync por vez, junto do webhook e do botão). Não passa por rotas-planos.js, rotas-promocoes.js nem pelo laço das 4-6h. Não usa Chrome/PDF: o envio é só blocos do Notion (sem `file_upload`), o que também elimina os estouros de 60 s do PDF. As linhas 59-61 de server.js (que scripts/teste-dependencia-cliente.mjs:330-334 fixa por regex) ficam intocadas; só se acrescentam linhas.

## 7. Telas

### 7a. /cliente (src/web/cliente.js)
- **Cabeçalho (:350-353)**: o menu "⋯" ganha `<button type="button" id="btnEnviarNotion" title="Cria no Notion do cliente a página «Relatório de Sprints Place2u» com hoje e os 6 dias anteriores">Enviar relatório agora para o Notion</button>` ao lado de #btnPlacePlan. Continua com um só `.btn-primario` (#btnRevisar, :362). O handler é ligado ao lado do de #btnPlacePlan (:475) e chama `PSEnvio.enviar(dados.cliente, {modo:'imediato', botao})`. Segue o molde do #btnPlacePlan: texto "Preparando prévia…", `disabled`, `aria-busy`, restaura o rótulo no `finally`.
- **Configurar**: nova `<section class="bloco" id="secEnvio">` logo após #secPerfil (:415), com `<h2>Envio do relatório ao Notion</h2>` e `<div id="envio">${SK('sk-tabela')}</div>`. `VIVOS` (:69) ganha `'envio'`. A lista de carregadores (:513) ganha `carregarEnvio(d.cliente)`. A função segue `carregarPerfil` (:1095), inclusive o descarte de resposta velha (`dados?.cliente === cliente`) e `erroBloco(...)` com "Tentar de novo".
- **Conteúdo de `#envio`** (desenharEnvio):
  - `<label for="envFreq">Frequência de envio</label>` com `<select id="envFreq">`: "Sem envio programado", "Envio semanal", "Envio quinzenal", "Envio mensal".
  - `<label for="envProximo">Próximo envio</label>` com `<input type="date" id="envProximo" min="{hoje}">`. Ajuda: "Enviado a partir das 17h desse dia. Se o sistema estiver desligado, o envio sai em até 3 dias (semanal), 5 (quinzenal) ou 7 (mensal); depois disso a data é pulada." Desabilitado e vazio em "Sem envio programado". Ao trocar de "Sem envio" para outra frequência, preenche com `sugestao_proximo`.
  - `<label for="envPor">Quem programa</label>` com `<select id="envPor">` de `quem` (padrão: nome salvo em `ps_perfil_por`, com try/catch como em :1074-1075).
  - Botões: `.btn` "Salvar programação" (#btnSalvarEnvio) e `.btn btn-fantasma` "Enviar agora" (#envAgora, mesmo fluxo de #btnEnviarNotion).
  - Linhas de estado: "Último envio: 08/10/2026 às 17:02 · Abrir no Notion" (link `target=_blank rel=noopener`) ou "Nenhum envio feito ainda."; "Categoria no Notion": «Relatório de Sprints Place2u» gravada / "A base deste cliente não tem a opção «Relatório de Sprints Place2u» na coluna «Secção». Crie a opção no Notion; até lá a página é criada sem categoria." / "Este cliente não tem a base «Informações» no Notion." / "Ainda não verificada: aparece depois da primeira prévia."
  - Texto de honestidade fixo: "O relatório mostra sempre hoje e os 6 dias anteriores. A frequência define só de quanto em quanto tempo ele é enviado; nos envios quinzenais e mensais, os dias entre um envio e outro não aparecem."
  - `<details class="recolhido" id="envHistorico"><summary>Histórico de envios <span class="n">N</span></summary>` com tabela de 5 colunas (≤6): Período · Quando · Origem · Situação · Página. Origem: Programado / Antecipado / Enviado agora. Situação com `.selo`: bom "Enviado", azul "Em andamento", ruim "Falhou" (`title` com a mensagem fixa), atencao "Sem base no Notion", neutro "Pulado". Vazio: `.vazio-box` "Nenhum envio ainda. Use «Enviar agora» ou programe uma frequência."
  - O "Salvar" usa a rota PRÓPRIA `/api/cliente/relatorio-envio/config`. O literal do `POST /api/cliente/perfil` (cliente.js:1160, fixado por regex em teste-dependencia-cliente.mjs:'cliente.js: o bloco de perfil…' e em teste-semanal-rotas.mjs:257) fica intacto.

### 7b. Script compartilhado: src/web/relatorio-envio.js (carregado em cliente.html e planos.html)
Expõe `window.PSEnvio = { enviar(cliente, opcoes), antecipar(escopo, rotulo), frequencia(clientes, rotulo, aoConcluir), rotuloFrequencia, selo(item) }`. Fica fora de cliente.js e acomp.js, porque o teste-shell-ui.mjs conta `btn-primario` apenas nesses dois (a regra "um primário por tela"). O botão de confirmação dentro do `<dialog>` usa `btn btn-primario`, como o diálogo de dependência em app.js. Diálogo nativo `<dialog class="dlg">` com `form method="dialog"`, `aria-labelledby` no h2, região `role="alert"` para erros, Esc fecha, foco inicial no select "Quem envia", `aria-busy` durante o envio. Cores só por token e nenhum emoji.

Cópia do diálogo individual:
- Título: "Enviar o relatório de {cliente} ao Notion?"
- Lista: "Período: 02/10 a 08/10/2026 (hoje e os 6 dias anteriores)" · "Página: «Relatório de Sprints Place2u — 02/10 a 08/10/2026»" · "Onde: base «Informações» do cliente, categoria «Relatório de Sprints Place2u»" · "O que vai: Resumo, Concluído, Em andamento, Próximos passos, Depende de você" (com as contagens de `secoes`) · "Programação: próximo envio 10/10 → 17/10" ou "continua em 10/10 (este envio é avulso)".
- Se já existe: "Já existe a página deste período, enviada hoje às 17:02. Enviar de novo atualiza a mesma página; não cria outra." (e, com hash igual, "Nada mudou desde o último envio" com o botão trocado para "Fechar").
- Se `categoria.estado !== 'ok'`: aviso âmbar "A base deste cliente não tem a opção «Relatório de Sprints Place2u». A página será criada sem categoria."
- Se `base.ok === false`: bloqueio "Este cliente ainda não tem a base «Informações» no Notion; não há onde criar a página." Só "Fechar".
- Campo "Quem envia" (select de `quem`). Botões: "Cancelar" e "Enviar ao Notion".
- Sucesso: o diálogo troca para "Relatório enviado. Abrir no Notion" (link) e "Fechar". Em seguida chama `carregarEnvio(cliente)`. Como `PS.toast` só aceita texto (shell.js:96), o link da página fica no próprio diálogo e na seção Configurar. Além disso `toast('Relatório enviado ao Notion.')`.
- Erros: `toast(e.message, 'erro')`; o botão volta ao rótulo original.

### 7c. /planos
- **planos.html**: dois pontos no `.pg-acoes` (:19-28). Dentro do menu "⋯": `<button type="button" id="btnRelFrequencia">Definir frequência do relatório…</button>` após #btnSyncPrest. Solto, ao lado do "CSV do escopo" (:27): `<button type="button" id="btnRelAntecipar" class="btn btn-fantasma">Enviar relatório antecipadamente</button>`. Fica em 2 secundárias soltas (o máximo do sistema de design) e 0 novos primários (o primário de /planos continua sendo #btnDistribuir, :61). Recomendo o botão visível porque o David pediu "um botão"; enterrá-lo no "⋯" escondê-lo do CEO.
- **Bloco recolhido** após #secClientes (:105-115):
```html
<details class="recolhido" id="secEnvios"><summary>Próximos envios de relatório <span class="n" id="nEnvios"></span></summary>
  <p class="sub">Clientes com envio programado ao Notion. O relatório cobre sempre hoje e os 6 dias anteriores e sai a partir das 17h do dia programado.</p>
  <div class="tabela-wrap fixa"><table class="t"><thead><tr><th>Cliente</th><th>Frequência</th><th class="n">Próximo envio</th><th>Último envio</th><th>Situação</th></tr></thead><tbody id="tbEnvios"></tbody></table></div>
</details>
```
Cinco colunas. Nome do cliente com link para `/cliente?cliente=…&aba=configurar`. Situação com `.selo`: azul "Agendado", atencao "Vence hoje" / "Atrasado" / "Sem base no Notion", ruim "Último envio falhou". Vazio: "Nenhum cliente com envio programado. Use «Definir frequência do relatório…» no menu ⋯ para programar." `#secEnvios` abre sozinho quando `location.hash === '#secEnvios'` (o link do resumo da notificação).
- **Por linha (planos.js `renderClientes`, :118-126)**: sob o nome, na linha `.mini`, o selo discreto `<span class="selo azul">Semanal · próximo 10/10</span>`, ou `atencao` "Semanal · venceu 09/10" ou `ruim` "Semanal · último envio falhou". Sem programação, nada aparece. No `td[data-eq]` o 1º filho continua sendo o `<span class="mini">` do contador (a linha :139 faz `td.firstElementChild.textContent`), e depois do botão "Equipe" entra `<details class="menu"><summary class="btn btn-p" aria-label="Mais ações de {cliente}">⋯</summary><div class="menu-lista"><button type="button" data-rel-antecipar="{cliente}">Enviar relatório antecipadamente</button><button type="button" data-rel-freq="{cliente}">Definir frequência…</button></div></details>`. O `colspan="6"` (:110, :113, :121, :124) e a 6ª coluna ficam como estão. O clique é tratado por um novo `addEventListener` delegado em #tbClientes (o existente em :132-140 retorna cedo quando não acha `[data-ficha]`, então os dois coexistem).
- **Agenda**: `carregarClientes` (:108) busca `/api/relatorios/agenda` em paralelo; falha dela é silenciosa nos selos, mas o bloco #secEnvios mostra `erroBloco(e, 'envios')` com retry (`RETRY` em :24 ganha `envios`).
- **Lote (header)**: #btnRelAntecipar abre `PSEnvio.antecipar(escopo(), rotuloDoEscopo)`. NÃO usa `.sel` nem checkbox novo. A seleção é a do escopo (`escopo()` em :40: Total/Squad/Consultor/Seleção).
  - Prévia: `POST /api/relatorios/antecipar {escopo}` mostra "N clientes · X a enviar · Y já enviados hoje · Z sem base conhecida no Notion · W sem programação (receberão um envio avulso)". Se o escopo passar de 25: "Escolha um escopo de até 25 clientes (hoje: 173): use Por squad, Por consultor ou Seleção." com o botão desabilitado.
  - Texto: "Cada cliente recebe no Notion a página «Relatório de Sprints Place2u» com hoje e os 6 dias anteriores (02/10 a 08/10/2026). Quem já recebeu o relatório deste período tem a mesma página atualizada, sem duplicar. A prévia do conteúdo de cada página está em Cliente › Enviar relatório agora."
  - Confirma com "Enviar N relatórios". O progresso reaproveita o painel #job/#jobTxt/#jobBarra (:48-51) via `acompanhar(jobId, rotulo, base)`, que ganha o 3º parâmetro (padrão '/api/planos/job/'; para o lote, '/api/relatorios/job/'). Texto: "Enviando relatórios: 3/12 · {cliente}".
  - Resultado em `#resultado` (`.aviso ok|erro`): "12 relatórios enviados ao Notion · 1 já estava atualizado · 2 com problema", com lista das falhas e o motivo fixo.
- **`travar(on)` (planos.js:232-235)**: acrescentar um 2º laço `for (const id of ['btnRelAntecipar','btnRelFrequencia']) { $(id).disabled = on; $(id).toggleAttribute('aria-busy', on) }` (não mexer no laço existente, que trata #btnDistribuir de forma especial). O lote chama `travar(true)` pelo `acompanhar`. Isso evita dois lotes simultâneos na mesma tela e a mudança de escopo no meio. Os itens `data-rel-*` por linha ficam desabilitados também enquanto `on`. No servidor o lote não consulta o lock de planos.
- **Frequência em lote/linha**: `PSEnvio.frequencia(clientes, rotulo, aoConcluir)`. Campos: "Frequência" (select), "Primeiro envio" (date, opcional; padrão = próxima sexta), "Quem programa" (select). Prévia: "Vai programar o envio {semanal} para 12 clientes, a partir de 09/10/2026. 3 já têm outra frequência e serão alteradas." e `aviso_carga`: "N clientes vencem no mesmo dia; o envio sai em lotes de 6 a cada 10 minutos, a partir das 17h". Botão "Programar".

### 7d. Inventários e teste-shell-ui
- docs/ux/inventario-cliente.json `hooks_js`: `#btnEnviarNotion`, `#secEnvio / #envio (carregarEnvio; contêiner vivo)`, `#envFreq`, `#envProximo`, `#envPor`, `#btnSalvarEnvio`, `#envAgora`, `#envHistorico`, `#dlgEnvio`.
- docs/ux/inventario-planos.json `hooks_js`: `#btnRelAntecipar`, `#btnRelFrequencia`, `#secEnvios`, `#tbEnvios`, `#nEnvios`, `[data-rel-antecipar]`, `[data-rel-freq]`, `#dlgRelFrequencia`.
- scripts/teste-shell-ui.mjs: adicionar 'src/web/relatorio-envio.js' ao `COMPARTILHADOS` (linha 29), porque os ids do diálogo vivem lá e o caso (2) procura o id em HTML + JS da tela + compartilhados. Acrescentar um caso (9) no padrão dos casos 7-8: #secEnvio dentro de `data-painel="configurar"` e depois de #secPerfil; `VIVOS` inclui 'envio'; planos.html mantém `colspan="6"` e tem #secEnvios; relatorio-envio.js sem emoji e sem `style=`; 0 `btn-primario` novo em cliente.js+acomp.js (continua 1); `travar` menciona os dois ids.
- CSS novo só com tokens (`var(--…)`, sem hex), em tela-cliente.css (grade do #envio, `min-height:44px` nos controles) e tela-distribuicao.css (o selo sob o nome).

## 8. O que NÃO muda
src/rotas-planos.js (inclusive o runner `iniciar` e as rotas de job), src/lib/notion-publicar.js, scripts/publicar-notion.mjs (as asserções de teste-semanal-rotas.mjs:241-249 seguem verdes), o literal do POST /api/cliente/perfil, alerta.js, `/api/planos/clientes`, as linhas 59-61 de server.js.

---

# Parte C — Robustez, destino/categoria, auditor, rotas e implantação (versão adotada)

## 0. Fatos novos verificados hoje (além dos 3 relatórios)

- **Origem do "Block does not support children" (verificado por SELECT).** Em `sync_estado`, 166 das 167 chaves `pagina_cliente:*` têm 36 caracteres (id com hífens, vindo da API). A única com 32 caracteres, sem hífens, é `pagina_cliente:H1 Editora = 778ecccd97a04c46878e7dbb421c0e7c`. Esse valor só pode vir do fallback `grava(paginaClienteId)` em `src/lib/plano-informacoes.js:42-48`, que cacheia o texto cru do campo da central sem verificar que é uma página. `acharInformacoesDb` (:56-65) chama `lerBlocos(id,0)` sobre esse id e o Notion devolve 400 "Block does not support children". A causa mais provável é que o campo guarda o id de uma database ou data source. O conserto é validar com `GET pages/{id}` antes de cachear.
- **Dois pares de clientes da central compartilham a mesma página** (SELECT em `pagina_cliente:*` agrupando por valor): "Casa e Brasa (Consultoria)" e "(Assessoria)", e "Brás Estampas" e "Brás Estampas (Plano Legado)". Com título que só tem o período, o segundo cliente do par adotaria a página do primeiro. Isso entra como estado `destino_compartilhado` (seção 3.6).
- `descobrirFontes()` (descobrir.js:~104-150) faz uma busca no Notion com `fetch` cru, sem throttle e sem retry, e varre a central inteira. `placeplan.js:113-123 infoDbDe` chama isso a cada cliente. No lote isso custa N varreduras e deve virar uma só, cacheada em memória por 10 minutos.
- `placeplan.js:116-121` engole o erro de `databases/{id}` com `.catch(() => null)` e usa `infoDb` como `dsId`. Uma base inválida vira um 404 confuso mais adiante. No módulo novo cada erro vira um estado.
- O launchd NÃO tem o plist semanal (`ls ~/Library/LaunchAgents` mostra só cloudflared, eleven, placehost, placelav e placepro). Portanto não há envio automático antigo rodando hoje.
- `teste-semanal-rotas.mjs:257` usa `j.slice(j.indexOf('function desenharPerfil'))` até o FIM do arquivo `cliente.js`. Qualquer código novo depois de `desenharPerfil` (cliente.js:1102) NÃO pode conter `${x.rotulo}`, `${x.descricao}` ou `${x.id}`. Por isso o código novo mora em `src/web/relatorio.js`, e o `cliente.js` só ganha linhas antes de :1102.

## 1. Mapa de módulos

Módulos novos (nenhum importa `db.js`, exceto o fio em `server.js`):

| Arquivo | Papel |
|---|---|
| `src/lib/relatorio-seguro.js` | Puro. `limparTitulo()`, `PROIBICOES`, `auditarBlocos(blocos, {nomesInternos, permitidos})`, `limitesNotion(blocos)`. |
| `src/lib/relatorio-notion.js` | Fábrica `criarRelatorioNotion({notion, estado, fontes, resolverPaginaCliente, acharInformacoesDb, invalidar, agora})`. Resolve destino, lê o esquema, decide categoria, faz buscar por título, criar e arquivar. Exporta as funções puras `esquemaInformacoes(props)`, `valorPropriedade(entrada, nome)` e `decidirCategoria(esquema, {semCategoria})`. |
| `src/lib/relatorio-envio.js` | `SCHEMA_RELATORIO`, funções puras de agenda (`proximaData`, `aposEnvio`, `devido`, `datasPrevistas`, `somarDias`), fábrica `criarRelatorioEnvio({handle, notion, montarBrief, destinos, nomesInternos, agora, hoje, validarPor, notificar, log, elegiveis})`, que devolve `{previa, enviar, lote, programar, tick, diagnosticar, historico, agendador}`. |
| `src/rotas-relatorio.js` | `criarRotasRelatorio({relatorios, quem, clienteCanonico})`, Router puro no molde de `rotas-dependencia.js`. |
| `src/web/relatorio.js` | `window.PSRelatorio` com `montarConfig(alvo, cliente)`, `enviarAgora(cliente)`, `lote(clientes)`, `tabela(alvo)`. Carregado por `cliente.html` e `planos.html` como `ficha.js` e `ofertas.js`. |
| `src/lib/relatorio-brief.js` | Fora do meu escopo (frente de conteúdo): `montarBrief(cliente, {hoje})` chama `montarSemanal` e devolve `{cliente, de, ate, parcial_ate_hora, blocos}`. O contrato que uso é só `blocos` (JSON de blocos do Notion, já limpo) mais `de`, `ate` e `parcial_ate_hora`. |

Alterações aditivas em arquivos existentes: `plano-informacoes.js`, `placeplan.js`, `db.js` (1 exec), `server.js` (fio e timer), `cliente.js`, `cliente.html`, `planos.html`, `planos.js`, `teste-shell-ui.mjs` (1 entrada). NÃO tocar: `notion-publicar.js`, `publicar-notion.mjs`, `notion.js`, `alerta.js`.

## 2. DDL (exec em `db.js` ao lado de SCHEMA_DEPENDENCIA, import de `./relatorio-envio.js`)

```sql
CREATE TABLE IF NOT EXISTS relatorio_programacao (
  cliente TEXT PRIMARY KEY,                       -- nome canônico da central, nunca do corpo cru
  frequencia TEXT NOT NULL DEFAULT 'desligado',   -- desligado | semanal | quinzenal | mensal
  proximo_envio TEXT NOT NULL DEFAULT '',         -- AAAA-MM-DD (dia local); '' quando desligado
  ancora_dia INTEGER NOT NULL DEFAULT 0,          -- mensal: dia do mês de referência (1-31, com clamp); evita deriva 31/01 -> 28/02 -> 28/03
  ativado_por TEXT NOT NULL DEFAULT '', ativado_em TEXT NOT NULL DEFAULT '',   -- confirmação do líder que vale para os envios automáticos
  tentar_apos TEXT NOT NULL DEFAULT '',           -- ISO; backoff depois de falha
  falhas_seguidas INTEGER NOT NULL DEFAULT 0,
  pausado_motivo TEXT NOT NULL DEFAULT '',        -- '' = ativo | sem_base | opcao_ausente_status | pagina_invalida | destino_compartilhado | sem_permissao | falhas
  atualizado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS relatorio_envio (      -- log append-only de tentativas CONFIRMADAS (prévia não grava)
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente TEXT NOT NULL, de TEXT NOT NULL, ate TEXT NOT NULL,
  origem TEXT NOT NULL,                           -- manual | lote | agendado
  estado TEXT NOT NULL,                           -- enviado | adotado | arquivado | falhou | bloqueado
  motivo TEXT NOT NULL DEFAULT '',                -- código fixo (sem_base, conteudo:sem_motivo, notion_403 ...), nunca texto do Notion
  page_id TEXT NOT NULL DEFAULT '', page_url TEXT NOT NULL DEFAULT '',
  categoria TEXT NOT NULL DEFAULT '',             -- aplicada | criada | padrao_da_base | sem_propriedade
  hash TEXT NOT NULL DEFAULT '',                  -- sha256(children) 16 hex: auditoria do que saiu
  por TEXT NOT NULL, em TEXT NOT NULL,
  ms INTEGER NOT NULL DEFAULT 0, incerto INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_relenvio_cli ON relatorio_envio (cliente, ate, estado);
CREATE UNIQUE INDEX IF NOT EXISTS ux_relenvio_vivo ON relatorio_envio (cliente, de, ate) WHERE estado IN ('enviado','adotado');
```

O índice único parcial garante no máximo UMA página viva por cliente e período, mesmo se a trava em memória falhar. Na substituição, a transação faz `UPDATE ... SET estado='arquivado'` na linha antiga e `INSERT` da nova. Diagnóstico por cliente fica em `sync_estado` (`rel_diag:{cliente}`, JSON, sem tabela nova). A chave geral do agendador fica em `sync_estado` (`relatorio_agendador` = 'ligado' ou ausente = desligado).

## 3. Plumbing do Notion (`relatorio-notion.js`)

### 3.1 Resolução do destino, `destinoDe(cliente)` (sempre estados, nunca exceção para casos esperados)

1. `fonte = (await fontes()).find(f => f.cliente === cliente)`. `fontes()` é `descobrirFontes` com cache em memória de 10 minutos, chamada UMA vez por lote. Sem fonte: `sem_pagina`.
2. Se existir `sync_estado relatorio_base:{cliente}` (data source id posto à mão, resposta "base nova"), pula direto para o passo 6.
3. `pagina = resolverPaginaCliente({...fonte})`. Validar com `GET pages/{pagina}`: `object==='page'` e `!archived` e `!in_trash`. Se falhar com 400 ou 404, chamar `invalidar(cliente)` e `resolverPaginaCliente({..., forcar:true})`, uma única vez. Se persistir: `pagina_invalida`.
4. `info = acharInformacoesDb(pagina)`. Retorno null: `sem_base` (cache negativo, ver 3.2). Se lançar `PaginaInvalida` (400 "does not support children"), fazer o mesmo ciclo do passo 3, uma vez.
5. `GET databases/{info}`. 404 ou 400: invalidar `info:{pagina}` e reescanear uma vez, depois `base_invalida`. Escolha do data source: `data_sources.length===1` usa o único; caso contrário usa o de nome `/informa/i`; sem nenhum, `base_invalida`.
6. `GET data_sources/{ds}` com cache de 10 minutos em memória (mesmo TTL de `dependencia-cliente.js:54`). `esquemaInformacoes(props)`. Sem propriedade `title`: `sem_titulo`.
7. Verificação de isolamento: `destino_compartilhado` quando outro cliente da central resolve para o mesmo `ds` ou `pagina`. É um SELECT em `pagina_cliente:*` por valor igual. Hoje são 2 casos reais (Casa e Brasa, Brás Estampas). Bloqueia o envio automático e o em lote. O manual exige `confirmar_destino:true`, e o título passa a levar o nome do cliente entre parênteses ao final, para não colidir na consulta por título. Isso é decisão do líder e aparece na prévia.

Todo id vindo de cache ou texto é checado com `RX_ID = /^[0-9a-f-]{32,36}$/i` antes de entrar em caminho de URL (molde `dependencia-cliente.js:53`). Erros inesperados (5xx, rede, 429 esgotado) são lançados e não viram estado de destino.

### 3.2 Correções em `plano-informacoes.js` (aditivas, também beneficiam `sincronizarPlanos` e o PlacePlan)

- `resolverPaginaCliente({..., forcar=false})`: `if (cache && !forcar) return cache`. O fallback do :48 passa a fazer `GET pages/{paginaClienteId}` e só então `grava`. Se não for página, loga aviso e devolve null (não cacheia lixo).
- `acharInformacoesDb(pagina, {ttlNegativoMs = 6*3600e3})`: lê `info_vazio:{pagina}` (ISO); se for mais recente que o TTL, devolve null sem reescanear. Quando não acha, grava `setEstado('info_vazio:'+pagina, agora)`. Se `lerBlocos` lançar `NotionError` 400 com `/does not support children/` ou 404, relança `PaginaInvalida` (classe exportada com `status`).
- `invalidarCliente(cliente, pagina)`: `setEstado('pagina_cliente:'+cliente,'')`, `setEstado('info:'+pagina,'')`, `setEstado('info_vazio:'+pagina,'')`. Não existe `deleteEstado`, mas `''` é falsy e `getEstado` já é lido com `if (cache)` (:30, :59), então vale como miss. Sem tocar em `db.js`.
- Exportar `parseTituloPlano` (:17), só para o teste provar que o título do relatório nunca casa.

### 3.3 Esquema e categoria (funções puras, testadas com os dois tipos)

`esquemaInformacoes(props)` devolve:

```
{ titulo:{chave}, status:{chave,tipo,opcoes}|null, secao:{chave,tipo,opcoes}|null }
```

- A `chave` é SEMPRE o texto exato lido do esquema ("Lista ", "Secção " com espaço no fim). `normNome` (equipe.js:15) só serve para casar: seção = `normNome(chave) === 'seccao'`, tipo `status` ou `select`.
- `valorPropriedade(entrada, nomeOpcao)` devolve `{[entrada.tipo]:{name:nomeOpcao}}`, o que conserta o bug do PlacePlan.

`decidirCategoria(esquema, {semCategoria})` devolve `{estado, propriedades, aviso}` com a constante `CATEGORIA = 'Relatório de Sprints Place2u'`:

| Situação da base | estado | O que a página faz |
|---|---|---|
| `select`, opção existe (normNome igual; usa a grafia da base) | `ok` | grava a opção existente |
| `select`, opção não existe | `select_cria` | grava `{select:{name:CATEGORIA}}`; o Notion cria a opção. Prévia avisa "a categoria será criada nesta base" |
| `status`, opção existe | `ok` | grava a opção existente |
| `status`, opção ausente (a API não cria opção de status) | `opcao_ausente_status` | **Padrão: bloqueia** (nenhum POST) com a instrução. Com `sem_categoria:true` (manual, líder): cria sem a propriedade, resultado `padrao_da_base`, porque o Notion preenche status omitido com a opção padrão do grupo To-do. Isso pode cair numa categoria ERRADA, como "Marketplaces Ativos". Avisar na prévia (comportamento a confirmar no piloto) |
| sem propriedade Secção | `sem_propriedade` | cria só com o título; resultado `sem_propriedade` |

As 3 respostas possíveis do David ficam cobertas pelo mesmo código: (a) opção criada por fora vira `ok` sozinha na próxima leitura (cache de 10 minutos, com botão "Verificar bases" que limpa); (b) enviar sem categoria é o parâmetro `sem_categoria`, nunca padrão; (c) base nova é o override `relatorio_base:{cliente}` do passo 2 de 3.1. A criação automática dessa base fica FORA desta entrega; seria um script próprio com dry-run depois.

Nunca escrever em `Status`, `Status 1` ou `Link `, só no título e na categoria (superfície mínima). Ícone: gráfico crescente. Sem capa externa.

### 3.4 Criar, adotar, substituir

Título: `Relatório de Sprints Place2u · ${dd/mm/aaaa} a ${dd/mm/aaaa}`, com a data completa nas duas pontas por causa da virada de ano. Para destino compartilhado, termina com ` (${cliente})`.

Provas por regex: não casa `parseTituloPlano` (começa com "relatorio de sprints…", sem `/` depois de `[a-zç]+`), não contém "PlacePlan" (a consulta `contains 'PlacePlan'` em placeplan.js:142 não o encontra) e não começa com "Relatório Semanal" (regra do sync em sync.js:123-126, que só vale no quadro de tarefas).

`acharPorTitulo(ds, tituloProp, titulo)`: `POST data_sources/{ds}/query` com `filter:{property:tituloProp, title:{equals:titulo}}`, `page_size:10`, ignorando `archived/in_trash`. Devolve `[{id,url,created_time}]` ordenado do mais novo.

Fluxo de `criar` (uma única chamada de escrita):

```
POST pages { parent:{data_source_id}, icon, properties:{[tituloChave]:{title:rt(titulo)}, ...categoria}, children: blocos (<=100) }
  notionReq(..., {method:'POST', body, retry5xx:false})   // 429 ainda reenvia (notion.js:37: o pedido não foi processado); 5xx não
```

- **Por que uma chamada só:** o brief tem por desenho no máximo 60 blocos de topo, com `table_row` aninhados como filhos da `table` (1 nível; o limite do Notion para criar é 2 níveis e 100 por array). `limitesNotion(blocos)` rejeita >100 por array, >2 níveis, rich_text >1900 caracteres (truncar com `…` na hora de montar, no molde de `rt()`) e corpo >450 KB. Sem PATCH `blocks/{id}/children`, não existe página "meio preenchida" visível ao cliente, e uma repetição de append nunca duplica blocos.
- **5xx ou timeout na criação (resultado ambíguo):** o código NÃO reenvia. Faz `acharPorTitulo` uma vez. Se achou, adota (`estado='adotado'`, `incerto=1`). Se não achou, `falhou` com `incerto=1`, e a próxima tentativa começa pela mesma consulta por título antes de qualquer POST. Isso cobre também o servidor reiniciado entre o POST e o INSERT local.
- **Reenvio do mesmo período:** existe linha viva em `relatorio_envio` para (cliente, de, ate)? Então `pular`, sem nenhuma escrita. Se não existe linha local mas `acharPorTitulo` acha página, vira `adotar` (grava a linha `adotado`, não escreve no Notion). Só o manual com `substituir:true` (líder, com confirmação explícita) substitui.
- **Substituir: criar a nova ANTES de arquivar a velha.** Escolhi essa estratégia por três razões. Primeiro, são 2 chamadas contra dezenas num PATCH de corpo (listar filhos + 1 DELETE por bloco a ~350 ms cada). Segundo, uma falha no meio nunca deixa a página do cliente vazia ou pela metade. Terceiro, `PATCH pages/{old} {archived:true}` é idempotente e pode usar o retry normal do `notionReq`. Custo: a URL muda e os comentários da página velha ficam na lixeira do Notion, e a prévia avisa. Se o arquivamento falhar, ficam duas páginas com o mesmo título. A próxima operação do cliente relê `acharPorTitulo`, mantém a mais nova e arquiva as demais (auto-cura), sem coluna extra.
- Ordem de gravação local: INSERT `enviado` (ou `UPDATE` da velha para `arquivado` + INSERT, na mesma transação) logo depois do POST ok. Depois `aposEnvio` atualiza a programação.

### 3.5 Erros: mapeamento fixo (molde `dependencia-cliente.js:56-62`)

Mensagens ao usuário: 403 "a integração não tem permissão para criar páginas na base Informações deste cliente"; 404 "página ou base fora do acesso da integração"; 400 "a base mudou: confira a propriedade de título/categoria"; 0 "NOTION_TOKEN ausente"; outros "Notion indisponível agora — tente de novo". O corpo da resposta do Notion (`NotionError.corpo`, `message` com 300 caracteres) NUNCA vai para a resposta HTTP nem para o log. Log só `status` + código (`log('erro', 'relatório <cliente>: notion_403')`). 400/403/404 são não-retentáveis (pausam a programação). 5xx e timeout são retentáveis com backoff.

## 4. Orquestração e agenda (`relatorio-envio.js`)

### 4.1 `enviar(cliente, {por, origem, confirmar, previa_id, substituir, sem_categoria, confirmar_destino})`

1. `cliente` canônico (a rota resolve); prospect `^\[Comercial\] ` rejeitado já na rota. Trava em memória `emVoo` (Set por cliente): segundo envio concorrente recebe 409 "já existe um envio deste cliente em andamento".
2. `confirmar !== true` (estritamente booleano) = **prévia**: monta o brief (`montarBrief`), audita, resolve destino, esquema e categoria, consulta o título. Tudo leitura. Devolve a ação (`criar`, `pular`, `adotar` ou `substituir`) e guarda `{id, brief, expira_em}` num Map por cliente por 15 minutos. NÃO grava nada no banco nem no Notion.
3. `confirmar === true`: exige `por` válido (`validarPor` = `validarLiderOuConsultor`, equipe.js:134), `previa_id` do Map (409 "prévia expirada, gere de novo" se ausente), e para `origem:'manual'` reaudita o MESMO brief da prévia. O que o líder viu é exatamente o que sai e não gasta uma segunda rodada de chamadas ao ML.
4. `auditarBlocos` sobre o payload final. Violação: grava `bloqueado` com `motivo='conteudo:<codigo>'`, retorna `{ok:false, estado:'bloqueado', violacoes:[{codigo, bloco}]}`, **zero chamadas de escrita**. Os trechos ofensivos aparecem só na prévia interna, nunca no log.
5. Destino e categoria (3.1, 3.3). Estado bloqueante devolve `{ok:false, estado, mensagem}` com 200 (estado de negócio; só validação de corpo é 4xx, como `rotas-dependencia.js:16`).
6. Criar, adotar, pular ou substituir (3.4). Timeout duro por cliente de 120 s com `Promise.race`. A geração do brief continua órfã no fundo, mas o resultado é descartado.
7. `primeiro_envio` (nunca houve linha viva ou arquivada do cliente): só a rota unitária `/cliente` pode confirmar (precisa de `previa_id`). Lote e agendador devolvem `precisa_previa` para esse cliente.

### 4.2 Agenda (funções puras, relógio injetado)

Toda aritmética de data usa `Date.UTC(a,m-1,d)`, em dias inteiros, sem hora e sem fuso da máquina. `somarDias('2026-10-25',1)` dá o mesmo valor em qualquer `TZ`. O "hoje" em produção é `hojeLocal` (db.js:259), igual ao `ate` do `montarSemanal`.

- `proximaData(freq, base, {ancoraDia})`: semanal soma 7; quinzenal soma 14; mensal vai para o mesmo `ancoraDia` do mês seguinte com clamp ao último dia (31/01 → 28/02/2027 → 31/03 → 30/04; em 2028, 29/02).
- Intervalo mínimo entre envios: `{semanal:4, quinzenal:9, mensal:18}` dias, constantes no módulo (marca `ponytail:`; vira config se alguém pedir).
- `aposEnvio(prog, enviadoEm)`: parte de `proximo_envio`, avança por `proximaData` enquanto `proximo <= hoje` (perdido: um único envio, sem fila de atraso) e enquanto `proximo - hoje < minimo`. O envio antecipado consome a ocorrência próxima, mas a âncora (dia da semana ou do mês) é preservada. Ex.: semanal, âncora sexta, envio manual na quarta: sexta tem distância 2 < 4, então vai para a sexta seguinte. Envio no domingo: distância 5, mantém a sexta.
- `devido(prog, {hoje, agora})`: frequência ≠ desligado, sem `pausado_motivo`, `proximo_envio <= hoje`, `agora >= tentar_apos`, e janela de envio automático segunda a sexta, das 08:00 às 18:00 locais (fora disso espera; pergunta 3 ao David). O conteúdo é sempre a janela deslizante que termina hoje, então envio atrasado nunca é "velho". Não há tolerância para descartar.
- `datasPrevistas(prog, 3)`: as 3 próximas datas, mostradas na confirmação da programação ("data de programação").
- Ativar a frequência: `programar({cliente, frequencia, proximo_envio, por, confirmar})`. Prévia mostra diagnóstico + 3 datas + a frase "Os envios automáticos criam uma página visível ao cliente, em nome de {por}." Só com `confirmar:true` grava, e `ativado_por` e `ativado_em` registram a confirmação do líder. Padrão sugerido: próxima sexta-feira estritamente futura. Exige destino em estado pronto (`ok` ou `select_cria`, ou `sem_categoria` acordado). `proximo_envio` aceita só AAAA-MM-DD real (round-trip por Date) entre hoje e hoje+60. Desligar zera `proximo_envio` e `falhas_seguidas`.

### 4.3 `tick()` (chamado a cada 10 minutos, junto dos demais timers de `server.js`)

- Sai se: chave geral `relatorio_agendador` ≠ 'ligado'; `rodando` verdadeiro (trava); lote manual em curso.
- Lista programações devidas, ordenadas por `proximo_envio` mais antigo, filtradas por `clientesElegiveis()` (não envia a "Congelado" nem a excluídos pela central). Limite de **4 clientes por tick** e orçamento de 6 minutos de relógio. Em cada cliente: `enviar(..., {origem:'agendado', por: ativado_por})` num try/catch próprio, sequencial.
- Sucesso ou `pular`/`adotar`: `aposEnvio`, `falhas_seguidas=0`. Falha retentável: `falhas_seguidas++`, `tentar_apos = agora + min(30·2^n minutos, 6 h)`. Na 3ª falha: `pausado_motivo='falhas'` + `notificar({tipo:'relatorio_falhou', nivel:'erro', cliente, titulo:'Relatório não enviado: …', corpo: mensagem fixa, link:'/cliente?cliente=…&aba=configurar', dedupeMin:1440})`. Estados não-retentáveis (`sem_base`, `opcao_ausente_status`, `pagina_invalida`, `destino_compartilhado`, `sem_permissao`, `precisa_previa`, bloqueio de conteúdo): pausa imediata com o motivo, sem martelar o Notion de hora em hora.
- Sucesso do agendado NÃO gera notificação por cliente (o `alerta.js`, que não pode ser editado, faz toast com som para cada item novo). Só log. Falha e pausa notificam com dedupe. Lote manual emite UM resumo (`tipo:'relatorio_lote'`, `nivel` sucesso, ou alerta se houve falha) mais as falhas por cliente com `dedupeMin`.

### 4.4 Lote ("Enviar relatório antecipadamente")

`lote({clientes, por, confirmar})`. Prévia: sem montar brief e sem ML, só lê o diagnóstico em cache (`rel_diag:*`, 24 h) e a programação, e lista por cliente `acao` (`enviar`, `ja_enviado_hoje`, `precisa_previa`, `bloqueado:<motivo>`). Confirmar: cria job em runner PRÓPRIO (molde de `rotas-promocoes.js:76-89`, com `GET /api/relatorio/job/:id`; NÃO usa `iniciar()` de `rotas-planos.js:53`, para não disputar o lock global de 1 job). Máximo de 40 clientes por pedido (400 acima disso), sequencial, com `Promise.race` de 120 s por cliente. O runner de lote e o `tick` compartilham o mesmo mutex `rodando`, então nunca rodam juntos.

### 4.5 Diagnóstico (fase ii, somente leitura)

`diagnosticar({clientes?})`, chamado em job, usando `fontes()` uma vez só e fazendo por cliente: validar a página, achar Informações, ler o esquema e decidir a categoria. Grava `rel_diag:{cliente}` = `{em, pagina, informacoes, secao_tipo, categoria, destino, perfil:'salvo'|'padrao', ml_conectado, pronto, proxima_acao}`. Cerca de 3 a 4 GETs por cliente a 350 ms, então ~5 minutos para ~170 clientes. `proxima_acao` com frases fixas, por exemplo "Criar a opção “Relatório de Sprints Place2u” em Informações › Secção" ou "Criar a base Informações na página do cliente" (NÃO criamos a base automaticamente) ou "Conferir o id da página do cliente na central". CSV: `cliente;pagina;informacoes;secao_tipo;categoria;perfil;ml_conectado;frequencia;proximo_envio;ultimo_envio;pronto;proxima_acao`, UTF-8 com BOM, separador ";", prefixo `'` contra fórmulas (mesma regra de `paraCsv` em rotas-promocoes.js).

## 5. Auditor de conteúdo (`relatorio-seguro.js`), a prova de "nada vaza"

`auditarBlocos(blocos, {nomesInternos, permitidos})` achata todo `rich_text` (e `table_row.cells`) em texto e devolve `[{codigo, bloco}]`. Em produção `nomesInternos()` junta `tarefas.responsavel` do cliente (split por vírgula), `listaOficial()` de analistas e `lideresEConsultores()`, comparados com `normNome` em palavras inteiras, só nomes com 2 ou mais palavras (evita falso positivo com "Ana"). `permitidos` é o nome do próprio cliente.

| código | pega |
|---|---|
| `sem_motivo` | `SEM_MOTIVO` de dependencia-cliente.js:38 ("sem motivo registrado", "registre pela tela") |
| `id_interno` | ` · PS-xxxxxxxx`, `MLB-?\d{6,}`, "Painel executivo" |
| `analista` | qualquer nome interno |
| `bloqueio_cru` | `^Bloqueio\b` e `Bloqueio:` |
| `jargao` | `RX_JARGAO` (render-semanal.js:23, passa a ser `export`) mais `/\b(notion|backlog|payload|webhook|endpoint|dry-?run|merov[ií]ngio|algoritmo|sync|p_sucesso|score)\b/i`. A palavra "Sprints" só é aceita no título e na categoria fixos |
| `promessa` | `garant\w+`, `comprovad\w*`, `certeza`, `vai (vender\|aumentar\|subir\|dobrar)`, `ranking`, `primeira posi[cç][aã]o`, `top ?1`, "resultado garantido" |
| `causalidade` | `causou`, `provocou`, "resultado direto d..." |
| `efeito_observado` | "efeito observado" (regra já testada em teste-semanal-render) |
| `valor_invalido` | `undefined`, `NaN`, `null`, `[object` |
| `segredo` | `secret_`, `ntn_`, `Bearer `, `access_token`, `APP_USR` |
| `url_interna` | `localhost`, `127.0.0.1`, `:3012` |
| `tipo_bloco` | tipo fora de paragraph, heading_1/2/3, callout, bulleted_list_item, numbered_list_item, table, table_row, divider, toggle, quote. Bloqueia `file`, `embed`, `bookmark`, `link_preview`, `child_page` |
| `limite` | `limitesNotion` (100 por array, 2 níveis, 1900 por rich_text) |

A limpeza na ORIGEM (`limparTitulo`, usado pelo brief) é a primeira camada: remove ` · PS-…`, `(MLB…)` e cabeçalhos "Bloqueio:", e para dependência sem registro troca `SEM_MOTIVO` por "Aguardando um retorno seu". O auditor é a rede de proteção; se ele bloquear com frequência, o brief tem bug. Por isso o log conta bloqueios por código.

## 6. Contratos das rotas (`rotas-relatorio.js`)

Padrão: `trata` como em `rotas-dependencia.js:13` (erro com `status` vira JSON `{erro}`; sem `status`, vai ao handler global de `server.js` → 500 "erro interno"). `json(req)` exige `Content-Type: application/json` (415 "envie o corpo como JSON (Content-Type: application/json)"). `guardaLocal` (server.js:55) já barra Origin diferente em POST. Mensagens fixas, nunca ecoam valor recebido.

- `POST /api/relatorio/enviar` `{cliente, por, confirmar?, previa_id?, substituir?, sem_categoria?, confirmar_destino?}`.
  - 200 prévia: `{ok:true, previa:true, previa_id, titulo, de, ate, parcial_ate_hora, destino:{estado, pagina_titulo, informacoes_url}, categoria:{estado, tipo, aviso}, acao, ja_enviado:{em, por, url}|null, primeiro_envio, violacoes:[], avisos:[], linhas:[texto simples dos blocos], expira_em}`.
  - 200 envio: `{ok:true, previa:false, estado:'enviado'|'adotado'|'ja_enviado'|'substituido', url, categoria, proximo_envio}`. Estado de negócio impeditivo: `{ok:false, estado:'bloqueado'|'falhou'|'sem_base'|…, mensagem}`.
  - 400 `informe "cliente"` / `informe "por" (quem está enviando — líder ou consultor)`. 403 `somente líder ou consultor da central envia relatório ao cliente`. 404 `cliente não encontrado na central`. 409 `já existe um envio deste cliente em andamento` / `prévia expirada — gere de novo`. 415.
- `POST /api/relatorio/lote` `{clientes[1..40], por, confirmar?}`. Prévia `{itens:[{cliente, acao, motivo}]}`. Confirmar `{job}`. Cliente repetido é deduplicado, prospect e desconhecido vão para `itens` com `acao:'ignorado'` (sem eco do nome).
- `GET /api/relatorio/job/:id` (404 se não existir).
- `POST /api/relatorio/programacao` `{cliente, frequencia, proximo_envio?, por, confirmar?}`. Prévia `{datas_previstas:[3], diag, avisos}`. Confirmar grava. 400 `frequência desconhecida — escolha desligado, semanal, quinzenal ou mensal` / `data inválida (use AAAA-MM-DD, entre hoje e 60 dias)`.
- `GET /api/relatorio/cliente?cliente=` `{programacao, historico[≤20], diag, frequencias:[{id,rotulo}], quem}`.
- `GET /api/relatorio/diagnostico` `{itens, resumo:{prontos, opcao_ausente, sem_base, sem_pagina, nao_verificados}}`, `GET /api/relatorio/diagnostico.csv`, `POST /api/relatorio/diagnostico/verificar` `{clientes?}` → `{job}` (somente leitura).
- `GET|POST /api/relatorio/agendador` `{ligado, por}` — interruptor geral (líder). Padrão desligado.

Cobertura de envio unitário e programação: só líder ou consultor (padrão da casa para escrita externa, `validarLiderOuConsultor`, equipe.js:134). Isso é restrição de produto, não de segurança, porque o painel não tem login; a proteção real é o `guardaLocal`.

## 7. Telas (mínimo, sem criar segundo primário)

- **/planos** (`planos.html`): no menu `⋯` do cabeçalho (:20-25) entram os itens "Enviar relatório antecipadamente" (`#btnRelatorioLote`, usa `escopo()`/`selecionados`) e "Pausar/retomar envios automáticos" (`#btnAgendador`). O único `.btn-primario` continua `#btnDistribuir` (:41). Nova `details.recolhido#secRelatorios` depois de `#secClientes` com `#tbRelatorios`, `#pagRelatorios`, `#btnVerificarBases` e `#lnkRelatorioCsv`, de ≤6 colunas (Cliente · Frequência · Próximo envio · Último envio · Situação · menu "⋯"), `colspan` 6, selos `.selo` (`.bom` enviado, `.azul` agendado, `.atencao` pausado ou atrasado, `.ruim` falhou). A tabela "Planos por cliente" (6 colunas) NÃO ganha coluna; o selo "Relatório: Semanal · próx. 10/10" vai no `.mini` da célula Cliente (planos.js:120-121) e o item "Enviar relatório agora" no "⋯" da linha, depois do botão Equipe. O delegador `#tbClientes` (:132-140) só reage a `[data-ficha]`, então um `[data-rel]` novo não colide, e o `td[data-eq]` mantém o contador como primeiro filho. Checkboxes novos SEM classe `.sel`.
- **/cliente**: menu `⋯` (cliente.js:350-352) ganha `<button id="btnRelatorioAgora">Enviar relatório ao Notion agora</button>` ao lado do `#btnPlacePlan`; o handler fica em `PSRelatorio.enviarAgora` (prévia → `confirmar()` → execução → toast → restaura rótulo, molde :475-492). Aba Configurar (:413) ganha `<section id="secRelatorio">` com `#relFreq` (select: Desligado, Semanal, Quinzenal, Mensal), `#relProximo` (input date), `#btnSalvarRelatorio` (`.btn`, não primário), `#relHistorico` (`details.recolhido`). Alterações em `cliente.js`: `'relatorio'` em `VIVOS` (:69), `carregarRelatorio(d.cliente)` ao lado de `carregarPerfil` (:513) e a função definida ANTES de :1102. `cliente.html` ganha `<script src="relatorio.js">` antes de `cliente.js`.
- Copy sob o select: "A frequência define quando enviamos. O conteúdo é sempre dos últimos 7 dias, até o dia do envio."

## 8. Conserto do PlacePlan (Secção = select)

`placeplan.js:134-135`: hoje `acha('Status','select')` e `seccaoProp` só para `type==='status'`; no :155-156 grava sempre `{status:{name}}`. Em bases criadas por `criar-planos-informacoes.mjs` (select) a categoria nunca é gravada. Troca: `const esq = esquemaInformacoes(props)`; `statusProp = esq.status`, `seccaoProp = esq.secao`; gravar com `valorPropriedade(entrada, nome)`; `opcao(prop, alvo)` passa a ler `entrada.opcoes`. A regra "usa SÓ opções que já existem" é mantida. O `montarPlacePlan` (puro) não muda, então `teste-placeplan.mjs` (que roda sobre o banco real, sem rede) segue verde. A cobertura nova da parte de propriedades vai para `teste-relatorio-envio.mjs`, sem tocar no teste existente.

## 9. Desempenho

- **Notion por envio:** validar página (1), `databases/{info}` (1), `data_sources/{ds}` (1, cacheado 10 min), consulta por título (1), POST (1), arquivar (1, só substituição). Cerca de 4 a 5 chamadas a ≥350 ms de throttle (notion.js:7) = ~2 s. Diagnóstico: 3 a 4 GETs por cliente, ~5 min para ~170.
- **Brief:** `montarSemanal` (semanal.js:86) faz chamadas AO VIVO ao ML (negócio ×2 por `comComparativo`, Ads ×2, produtos mais vendidos, ofertas) sem timeout próprio. Não pude medir (ML proibido nesta exploração). Por isso `relatorio_envio.ms` registra cada envio e a fase i mede antes de ligar qualquer coisa. Nunca `execFileSync`, então não bloqueia o event loop como o Chrome do `publicar-notion.mjs:51`.
- **Capacidade:** 4 clientes por tick de 10 minutos = 24 por hora; janela útil de 10 h por dia = ~240 por dia. Mesmo todos os ~170 devidos numa sexta terminam antes das 16h. Orçamento do tick: 6 minutos de relógio, com `rodando` impedindo sobreposição. Timeout duro de 120 s por cliente.
- Contenção: o throttle é global ao processo (notion.js:8), então o sync do Notion e o relatório se enfileiram entre si sem estourar o limite. O tick só roda entre 8h e 18h, fora da janela de coleta do ML (4h a 6h, server.js:340-360).

## 10. Implantação em fases, com chave geral desligada

- **Fase i (nada escreve no Notion).** Tabelas, módulos, rotas, UI, correções de cache. O timer é instalado, mas `relatorio_agendador` está desligado. A prévia funciona (só GETs). Gate: todos os `scripts/teste-*.mjs` e os 5 novos passam, e `TZ=Pacific/Auckland` também.
- **Fase ii (diagnóstico para o David).** Botão "Verificar bases" → lista com quem está pronto, quem tem opção ausente, quem não tem Informações, quem tem id inválido (o H1 Editora deve aparecer como `pagina_invalida` e se corrigir sozinho) e quem tem destino compartilhado (os 2 pares). Ele baixa o CSV e decide a pergunta 1.
- **Fase iii (1 piloto).** O David escolhe o cliente. Roteiro: prévia → ele lê o texto e o destino → "Enviar" → abre a página no Notion e confere categoria, o que o Notion fez com o status omitido (se o caso se aplicar), aparência no celular e que não há nome de analista nem jargão → clica "Enviar" de novo (deve pular) → só então testa "Substituir". Nada de frequência ainda.
- **Fase iv (frequência por cliente, padrão desligado).** Líder ativa no /cliente (ou em lote por cliente-a-cliente, a partir da lista pronta). O agendador continua desligado, então só vale a data.
- **Fase v (agendador).** Liga a chave geral numa segunda ou terça, com o David presente para a primeira sexta real. O botão "Pausar envios automáticos" é o freio de emergência (sem reiniciar servidor).
- **Relação com o envio antigo.** `automacao/com.place2u.place-sprints.semanal.plist` não está carregado e continua assim. `publicar-notion.mjs` fica como ferramenta MANUAL para o PDF completo sob demanda (`--cliente X`). Escreve no quadro "Tarefas - {Cliente}" (linha "Relatório Semanal", barra e botão do ML) e o novo escreve em Informações, então as linhas não duplicam. O risco é só o cliente receber dois artefatos se alguém carregar o plist, e por isso um aviso novo no cabeçalho do plist e no `CLAUDE.md` pede para não ativar os dois. A linha "Relatório Semanal" que o sync pula (sync.js:123-126) não é afetada: o novo destino não é o quadro de tarefas. O `sincronizarPlanos` lê todas as páginas de Informações, mas descarta as de título que não casa antes de `lerBlocos` (plano-informacoes.js:101-102), então o custo por relatório novo é desprezível.

## 11. O que o David vê no 1º dia

1. /planos › nova seção recolhida "Relatórios para o cliente": todas as frequências "Desligado", nenhum envio automático. Botão "Verificar bases" e o resumo "X prontos · Y sem a categoria · Z sem Informações".
2. No "⋯" do /planos, "Enviar relatório antecipadamente": ao selecionar clientes ele vê uma prévia por cliente (pronto, bloqueado por quê, precisa abrir o cliente para o 1º envio) e nada vai ao Notion sem confirmar.
3. No /cliente › "⋯" › "Enviar relatório ao Notion agora": prévia com o texto que o cliente vai ler, o destino ("Informações › categoria Relatório de Sprints Place2u") e os avisos. Em Configurar, a frequência, a data do próximo envio, as 3 datas previstas e o histórico recolhido.

## 12. Estrutura da página enviada (casca que o auditor valida; o texto de cada bloco vem do brief)

Ícone gráfico crescente, título determinístico (3.4), propriedade de categoria (3.3). Corpo, nesta ordem e no máximo 60 blocos de topo:

1. `callout` cinza: "Resumo de {dd/mm/aaaa} a {dd/mm/aaaa}{, hoje até HH:MM}. Próximo envio previsto: {dd/mm}." (omitir a 2ª frase se a programação estiver desligada).
2. `heading_2` "Em uma frase" + `quote` com o veredito.
3. `heading_2` "Resultados dos últimos 7 dias" + `table` (Indicador · Últimos 7 dias · 7 dias anteriores · Variação, ≤8 linhas, "—" quando não houve coleta, com a nota "sem coleta" em vez de zero).
4. `heading_2` "Concluído", "Em andamento", "Próximos passos" (cada item com a data na frente, ex.: "12/10 · …"; sem itens: "Nenhum passo com data definida ainda") e, só se houver, "Depende de você" (callout âmbar, sem responsável nem prazo).
5. `divider` + `paragraph` pequeno: "Resumo dos últimos 7 dias. Números sem coleta aparecem como “—”. A ligação entre ações e resultados é uma leitura indicativa, não garantia."