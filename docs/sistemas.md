# Os 8 sistemas do Place Sprints (glossário)

Decisão do David, 15/10/2026. Catálogo fechado em `config/sistemas.json`; helper puro em `src/lib/sistemas.js`; teste `scripts/teste-sistemas.mjs`.

**Regra:** toda comunicação **interna** (avisos do sino, Discord do time, logs do servidor, selo ao lado do título das seções) diz de qual sistema vem. Ao **cliente** (WhatsApp, Notion, relatórios, PDF, versão cliente do `/diagnostico-motor`) só o Merovíngio assina, com o texto de sempre: `Merovíngio · Place Sprints | Equipe Place2u` (`ASSINATURA` em `src/lib/plano-semana-texto.js`). Nenhum texto ao cliente mudou com esta reestruturação.

| Sistema | O que faz | Onde está no código | O que assina |
|---|---|---|---|
| **Trinity** | Coleta: lê o Mercado Livre e o Notion (só leitura) e entrega o dado limpo aos outros. | `meli-serie.js`, `meli-api.js`, `meli-contas.js`, `saude-coleta.js`, `sync.js`, `notion-cliente.js`, `anuncio-historico.js` (fotografias), `promocoes-coleta.js` | Avisos e logs de conexão, coleta e sync. |
| **Arquiteto** | O Algoritmo: regras, plano por anúncio, prioridade e Foco 80/20. | `diagnostico-conta.js`, `plano-anuncios.js`, `config/algoritmo.json`, `diagnostico-motor.js`, `alinhamentos.js`, `ofertas-algoritmo.js` | Plano da semana interno, ações propostas, diagnóstico. |
| **Oráculo** | Previsão e calibração: probabilidade, faixas, cobertura de estoque, aprendizado com o que já foi medido. | `calibracao.js`, `aprendizado.js`, `compras-previsao.js`, `lead-time.js`, `retroalimentacao.js` | Previsões, calibração, retroalimentação. |
| **Merovíngio** | Medição e causalidade: antes × depois com controle e atribuição. | `impacto-tarefas.js`, `acompanhamento.js`, `merovingio.js`, `duplicacao.js`, `preco-historico.js`, `estado-anuncio.js` | Medições internas e **tudo o que vai ao cliente**. |
| **Chaveiro** | Execução: o caminho de cada ação e a escrita no ML com aprovação e conferência. | `chaveiro.js`, `src/rotas-chaveiro.js`, `config/chaveiro.json`, `promocoes-exec.js` | Execução do plano. |
| **Morpheus** | Comunicação: plano de terça, alertas, relatórios, Discord, respostas e dossiê. | `gatilhos.js`, `gatilhos-envio.js`, `gatilhos-real.js`, `plano-semana-texto.js`, `consultor-discord.js`, `relatorio-envio.js`, `alerta-cliente.js`, `respostas-relatorio.js`, `dossie.js`, `notificacoes.js`, `scripts/resumo-time-discord.mjs` | Discord do time, avisos ao time, entregas e falhas de envio. |
| **Smith** (Agente Smith) | Guardião financeiro: custo, preço, margem e caixa. | `custos-db.js`, `custos-webhook.js`, `erp-*.js`, `lucro.js`, `lucro-real.js`, `ofertas-preco.js`, `promocoes-mc.js`, `custo-vinculo.js` | Custos, preço, margem, Ads sem retorno. |
| **Neo** | Modo autônomo (marcos M3–M5): age sozinho dentro dos limites aprovados. | Ainda não implementado (`docs/desenho-causalidade-executor.md`). | Ações autônomas (ainda não ligado). |

## Como o código usa

- `sistema(id)` → `{ id, nome, papel, assina }`; id fora do catálogo lança erro (catálogo fechado).
- `voz(id, texto)` → `«Arquiteto · texto»` (logs e títulos de aviso). `secao(id, texto)` → `«Merovíngio — o que rendeu»` (cabeçalho de seção no Discord).
- `mapaDeOrigem(chave)` → id do sistema de origem para uma **regra** de `config/algoritmo.json`, um **tipo de gatilho** de `config/gatilhos.json` ou um **tipo de aviso/evento** (`cliente_conectado`, `relatorio_falhou:…`, `s90_…`, `coleta`, `plano` …); `null` quando não sabe. Chave que é regra e gatilho ao mesmo tempo (ex.: `anuncio_restrito`) tem um dono só: quem detecta o sinal.

| Origem | Regras / gatilhos / avisos |
|---|---|
| Trinity | sinais lidos direto da coleta: `anuncio_restrito`, `reputacao_em_risco`, `envio_atrasado`, reclamações e perguntas sem resposta, `estoque_zerado`; avisos de conexão/coleta (`cliente_conectado`, `dados_prontos`, `coleta_falhou`, `conexao_caiu`, `conta_trocada`, `s90_*` …) |
| Arquiteto | regras do plano (IMA, catálogo, Ads entrar/escalar/otimizar, conteúdo, frete, sazonal, urgência oculta, duplicação, Ofertas, quedas por anúncio, concentração, Full parado, estoque dividido, SKU ausente); `diagnostico_pronto` |
| Oráculo | `estoque_ruptura`, `full_envio`, `ruptura_curva_a`, `ciclo_estoque_previsto`, `envio_full_sugerido` |
| Merovíngio | `preco_mudou_vendas_cairam`, `queda_forte_conta`, `queda_conta`, `queda_por_preco` |
| Smith | `cadastrar_custos`, `margem_negativa`, `oferta_preco`, `promocao_giro`, `ads_reduzir`, `ads_abaixo_meta`, `preco_alterado_drastico`, `oferta_terminando`, `ads_sem_retorno`, `custos_nao_informados`, `promocao_encerrada` |
| Morpheus | `dependencia_vencida`, `aviso_assessoria*`, `gatilho_falhou`, `consultor_discord_*`, `relatorio_*`, `alerta_*`, `dossie_mensal` (e o padrão de qualquer aviso sem dono conhecido) |

A tabela completa é `MAPA` em `src/lib/sistemas.js`; `scripts/teste-sistemas.mjs` falha se surgir regra ou gatilho sem dono.

## Onde aparece

1. **Avisos do sino** (`notificar()` em `src/lib/notificacoes.js`): o chamador pode passar `sistema`; sem ele vale `mapaDeOrigem(tipo)` e, por fim, Morpheus. O título vira «Trinity · Novo cliente conectado: Acme» e a linha guarda a coluna aditiva `sistema` (devolvida por `GET /api/notificacoes`). `src/web/alerta.js` não mudou.
2. **Discord do time**: resumo semanal (`consultor-discord.js`) com «✅ Merovíngio — o que rendeu», «🔁 Merovíngio — sem resultado medido…», «🔔 Morpheus — pontos da assessoria» (cada item com o sistema de origem: «Smith · Anúncios pagos sem retorno») e «📲 Morpheus — enviado ao cliente»; o script `scripts/resumo-time-discord.mjs` ganha ainda «💰 Smith — custos e preço», «🔮 Oráculo — previsão de estoque» e «📦 Arquiteto — plano da semana»; o dossiê mensal sai como «📁 Morpheus · Prestação de contas mensal». As 3 menções obrigatórias e o consultor continuam no topo da 1ª parte.
3. **Logs do servidor**: `logS(sistema, nivel, msg)` em `src/server.js` (coleta = Trinity, plano/diagnóstico/alinhamentos = Arquiteto, financeiro/custos = Smith, gatilhos/relatórios/alertas/consultor/dossiê/respostas = Morpheus); os módulos de gatilhos, relatórios e consultor recebem um `log` que já prefixa «Morpheus · ».
4. **Telas internas**: selo `span.sis[data-sistema]` (classe `.sis` em `ui.css`) ao lado do título das seções de `/cliente`, `/planos`, `/resultados`, `/integracoes`, `/metodologia` e da versão interna do `/diagnostico-motor`; nenhum id nem nº de colunas mudou (mapa em `docs/ux/inventario-*.json → selos_sistema`). `/metodologia` tem a seção «Os 8 sistemas» (`#secSistemas`).

Chaveiro e Neo ainda não têm seção própria no Discord: não há dado de execução no resumo semanal hoje (YAGNI até existir).
