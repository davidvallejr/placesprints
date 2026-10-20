# Promoções por cliente — módulo do Place Sprints

Traz para **dentro de cada cliente** (qualquer um com conta Mercado Livre conectada) tudo o que as habilidades
`controle-promocoes-ml` e `analista-promocoes` fazem: coleta de campanhas e ofertas, elegíveis a rebate, curva ABC, MC,
recomendação do analista, decisão humana (ENTRAR?), plano de execução em dry-run, cobertura, regras por SKU, pendências
e auditoria. Tela: `/promocoes?cliente=…`. API: `/api/promocoes/…`.

> **Princípios que o dono já cravou e o módulo obedece:** só leitura até a execução · decisão financeira é humana ·
> **nunca sair de campanha** (24/08/2026) · nunca MC negativa (exceto SKU "Livre") · LIGHTNING nunca é recomendada ·
> a rodada só termina com o invariante provado por read-back · sem custo → **"SEM CUSTO"** (nunca um número inventado).

## 1. Arquivos

| Arquivo | Papel |
|---|---|
| `src/lib/promocoes-mc.js` | Funções **puras**: MC, preço vigente, cobertura contínua, curva ABC, degrau de frete, preço-alvo, derrubadas |
| `src/lib/promocoes-db.js` | Tabelas `promo_*` (criadas no import) e acesso a dados. `PS_PROMO_MEMORIA=1` troca o banco real por um em memória (testes) |
| `src/lib/promocoes-coleta.js` | Coleta **só GET** por cliente (campanhas, itens por campanha, detalhes, oferta viva por anúncio, tarifa/frete) |
| `src/lib/promocoes-analista.js` | O analista (R1/R2/…), vigias, interrogatório, invariante e read-back |
| `src/lib/promocoes-plano.js` | Plano **dry-run** (a lista exata das chamadas) — nunca executa |
| `src/lib/promocoes-exec.js` | Executor ao vivo — **travado por duas chaves**, desligado por padrão, **não testado em produção** |
| `src/rotas-promocoes.js` | Router Express (`rotasPromocoes`) |
| `src/web/promocoes.{html,js,css}` | Tela |
| `scripts/teste-promocoes.mjs` | Autoteste (sintético, sem rede, banco em memória) — `node scripts/teste-promocoes.mjs` |

## 2. Modelo de dados

**Todas** as tabelas têm `cliente` na chave: nada se mistura entre clientes.

| Tabela | Chave | Guarda |
|---|---|---|
| `promo_config` | cliente | `piso_mc` (20), `piso_relampago` (19), `imposto_pct`, `dias_vigia` (7), `janela_cobertura_dias` (3), `hedge_cobertura`, `execucao_habilitada` (**0**), `execucao_max_itens` (**1**) |
| `promo_coleta` | cliente | carimbo da última coleta (`concluida_em`, frescor de 12h), resumo e **limites declarados** |
| `promo_campanha` | cliente × pid | tipo, nome, status, datas, `rebate`, `relampago`, `origem` (`listagem` ou `item` = a listagem a escondia) |
| `promo_oferta` | cliente × item × pid × offer_id | status `candidate/started/pending`, preço, preço original, `meli_pct`, `seller_pct`, datas, min/max |
| `promo_anuncio` | cliente × item | SKU (e a camada de onde veio), status/`sub_status`, `under_review`, estoque, categoria, `protegido`, tarifa/frete coletados |
| `promo_decisao` | cliente × item × pid × origem | `analista` \| `humano`; `marcado`; `regra` (`R1 R2 R1C HEDGE LIVRE PISO_SKU RELAMPAGO SEM_MARCA HUMANO`); motivo, obs, preço/MC no momento da decisão, `ordem_direta`, `aprovado`, quem/quando. **A aprovação 🤖 vale para os NÚMEROS aprovados** (preço, MC%, trilha): se a rodada do analista recalcular com número diferente (ou sem a campanha), a aprovação é **revogada** (`aprovacao_revogada` na auditoria) — nunca herdada pelo número novo |
| `promo_alerta` | cliente × tipo × chave | vigias persistidos (`cobertura`, `rebate_pior`, `lembrete`, `sem_custo`, `under_review`) — é daqui que o **read-back** lê |
| `promo_regras_sku` | cliente × mlb × sku | `Livre` \| `N%` \| `Revisar toda rodada` + nota |
| `promo_custos_sku` | cliente × sku | custo em R$ e fonte — é a camada **manual** (aba Custos); ERP/planilha ficam em `erp_custos_sku` (§10) |
| `promo_plano` | id | `dry-run` → `aprovado` → `executando` (claim atômico) → `executado` \| `executado_parcial` \| `erro` (+ `cancelado`); itens (as chamadas + o bloco `aprovado`: pid, offer_id, preço, MC% — o baseline do executor), `hash` (cobre chamadas **e** baseline), validade (24h), resultado |
| `promo_auditoria` | id | todo evento: coleta, marca humana/recusa, aprovação, analista, plano, execução bloqueada/feita, sync, config |
| `promo_snapshot` | cliente × rodada | foto das participações started/pending (para achar "derrubada antes do prazo") |
| `promo_aprendizados` | id | respostas do interrogatório (padrão, escopo item/SKU/global, resposta, ação `nota/ignorar/regra_sku`) |

Linhas `SEM_MARCA` (`marcado = 0`, `pid ''`) existem de propósito: quem **não** recebe marca guarda o **motivo** (é o que o invariante exige).

## 3. Fluxo

```
Coletar (GET) → Analista (R1/R2 + vigias) → Humano (marca/recusa/aprova 🤖) → Plano dry-run → [Execução travada] → Sync → Auditoria
```

1. **Coletar** — `POST /api/promocoes/coletar` (job; lock único). Só GET, sequencial com pausa, retry em 429/5xx, nunca cai por um anúncio.
   Guarda carimbo; **coleta com mais de 12h é "velha"** e o analista recusa gravar em cima dela. A coleta compara com a foto anterior e lista as
   participações que sumiram antes do prazo. Faturamento 30d e curva ABC vêm da série de pedidos **pagos** que o Place Sprints já coleta
   (a tela mostra "vendas até DD/MM"; "atualizar vendas antes" roda a coleta de vendas existente).
   **Coleta para todos com interruptor por cliente (08/10/2026, decisão 3 do David):** a coleta (só leitura) roda de madrugada para **todo** cliente com conta ML, em lotes: `config/promocoes.json` (`coleta_para_todos: true`, `lote_por_madrugada: 5`) e `perfil_cliente.coleta_promocoes` (null = padrão da base, 1 liga, 0 desliga; Cliente → Configurar, "Coletar promoções do Mercado Livre"). `server.js`, no laço diário das 4–6h, depois dos clientes e antes de `coleta_ml_dia`, chama `coletarPromocoes(c, { por: 'madrugada' })` para `loteNoturno(conexões sem erro)` (`promocoes-coleta.js`: só ligados; nunca coletou primeiro, depois a coleta mais antiga, depois nome, até o lote) e grava no `sync_log` ("coleta de promoções (madrugada) …"). A madrugada chama `coletarPromocoes` direto, sem o lock de job em memória das rotas: coleta manual simultânea perde a posse do carimbo e `gravarColeta` descarta a mais velha. "Coletar agora" continua valendo com a coleta desligada. `GET /api/promocoes/clientes` e `/resumo` devolvem `coleta_ligada`; a tela mostra "Coleta desligada para este cliente — Ligue em Configurar" numa única faixa (junto do erro de coleta quando há um). A cada coleta, `gravarColeta` grava na mesma transação o **estado de promoção** no change-log do anúncio (`meli_item_mudanca`, campo `promocao`, fonte `promo`; `docs/acompanhamento-e-retroalimentacao.md`, seção de 08/10).
2. **Analista** — `POST /api/promocoes/analista` (dry-run por padrão; grava só com `aplicar: true` booleano). Recalcula **só** as linhas 🤖.
3. **Humano** — `POST /marcar` (`true` marca, `false` recusa, `null` limpa) e `POST /aprovar-analista`. Marcar **não executa nada**.
   Recusa 👤 e os bloqueios do dono (aprendizado IGNORAR, regra "Revisar toda rodada") são **vinculantes** (`repo.recusasHumanas`): nem analista, nem hedge, nem plano, nem executor os contornam; "Aprovar todas" não aprova campanha recusada (`aprova_analista_bloqueada`). Marca 👤 no anúncio e a última decisão humana vencem a 🤖 aprovada.
   Marca 👤 torna o bloco do anúncio **intocável** para o analista **enquanto a campanha marcada ainda for candidata ou estiver ativa (started/pending)**; marca 👤 de campanha encerrada (acabou/saiu) libera o anúncio — o analista reavalia, a linha gravada diz "marca 👤 antiga em campanha encerrada — reavaliado" e a decisão humana não é revogada (sem leitura confiável das ofertas, a marca segue valendo). Recusa 👤 impede só aquela campanha de ser re-sugerida.
4. **Plano** — `POST /plano` re-busca **cada anúncio ao vivo** (GET) e grava o dry-run; `POST /plano/aprovar` exige **o nome de quem aprova**.
5. **Execução** — `POST /plano/executar`. Ver §7: as travas conhecíveis sem rede são conferidas **na rota, antes de criar o job**: sem as duas chaves (ou plano expirado/adulterado) devolve **403 `{erro, motivo}`** e **nada é chamado**.
6. **Sync** — `POST /plano/sync` (só GET), apenas **≥ 30 min** depois da execução; nunca limpa marcas em massa.
7. **Auditoria** — `GET /auditoria`, `GET /exportar.csv?tipo=auditoria`.

## 4. Regras portadas (e de onde vêm)

| Regra | Onde no código | Origem |
|---|---|---|
| Rebate = `meli_percentage > 0` em SMART/PRICE_MATCHING/MARKETPLACE_CAMPAIGN; DEAL, SELLER_CAMPAIGN, cupom, PRICE_DISCOUNT, LIGHTNING, Pix fora. Tipo desconhecido com meli% > 0 conta e é sinalizado | `ehRebate` (mc) | `regras-promocoes.md` §1 |
| Fonte da carga = campanhas (`/seller-promotions/users/{uid}` → `/promotions/{pid}/items`, `search_after`, `limit` ≤ 50) | `coletarPromocoes` | `regras-promocoes.md` §2 |
| SKU em camadas (`SELLER_SKU` → `seller_custom_field` com `||` → `/user-products` → variações) | `resolverSku` | `regras-promocoes.md` §3 |
| MC = preço − (comissão − rebate) − frete − custo − imposto; rebate = meli% × preço **original**; "SEM CUSTO" | `calcularMC`, `resolverCustos` | `regras-promocoes.md` §4 |
| Faturamento 30d de pedidos **pagos** + curva ABC (A < 80%, B < 95%) | `curvaABC`, `faturamento30` | `regras-promocoes.md` §5 |
| Dedup/hedge: entrar em todas as campanhas equivalentes (mesmo preço e meli%) — exceto recusada 👤 / anúncio barrado pelo dono; hedge só existe no **dry-run** (o executor não envia hedge novo) | `montarPlano` (hedge) | `regras-promocoes.md` §7 |
| Execução: `POST …/seller-promotions/items/{MLB}?app_version=v2` com `offer_id` = `ref_id` do candidato **vivo**; pular started/pending/não-candidato | `montarPlano`, `executarPlano` | `regras-promocoes.md` §9 |
| Cobertura contínua (mescla; lacuna corta; data > 60 dias suspeita; data da oferta, senão da campanha; relâmpago sem fallback) e **separação com × sem rebate** | `coberturaContinua` | `regras-promocoes.md` §12 + SKILL (plano 213) |
| Painel × API: a tela manda; `price` muda de sentido por tipo (SMART = slot; LIGHTNING = teto; DEAL sem price) | `normalizarOferta`, `precoVigente` | `regras-promocoes.md` §13/§13-bis |
| Preço vigente = **menor** `price` entre as started que mexem no preço (fora PRICE_MATCHING/cupom/BANK); nunca o price do candidato | `precoVigente` | SKILL "ORDEM DA RODADA" |
| Relâmpago SMART = só painel (o plano pula **sempre** marca de trilha `painel`, e pelo nome vivo completado pela campanha); LIGHTNING nunca é recomendada | `avaliarAnuncio`, `montarPlano` | `regras-promocoes.md` §14 · `aprendizados.md` 02/09/2026 |
| R2 (sem campanha viva) e R1 (migra só se MC ≥ atual **e** ≥ piso; empate conta); piso 20%; nunca MC < 0; nunca desmarca; uma marcação por anúncio (maior MC) + as demais ≥ piso na observação | `avaliarAnuncio`, `montarObs` | SKILL Fase 1.5 |
| Camada ⚠P (já started em outra campanha → não dar desconto sobre desconto) | `avisoP` | SKILL "Camada ⚠P" |
| Regras por SKU: `Livre` (qualquer campanha, melhor rebate; "já ativo, não mexer"), `N%`, `Revisar toda rodada` (lembra, nunca decide) | `avaliarAnuncio`, `vigias.lembretes` | SKILL Fase 1.5 |
| `under_review`: não recebe marca, declara a causa | `avaliarAnuncio` | SKILL "GOTCHA under_review" |
| Piso do relâmpago 19%; R1-cobertura (campanha atual vence hoje); hedge de cobertura (melhor acaba em ≤ 3 dias → marca também a de maior vigência) | `config.piso_relampago`, `R1C`, `HEDGE` | `aprendizados.md` 16/08, 28/07+31/08, 28/09 |
| Marca do analista é distinta/recalculável e não toca em marca humana; `👤 IGNORAR` não é re-proposto | `aplicarHumanos`, aprendizado `ignorar` | SKILL + `aprendizados.md` 04/09 |
| Vigia de cobertura dos protegidos (curva A/B ou marcados) com saída MARCAR × SUGERIR MANUAL; anúncio fechado/pausado/under_review/sem leitura = exceção declarada, nunca "coberto" presumido | `vigiaCobertura` | analista passo 3 · `aprendizados.md` 31/07, 04/09 |
| Vigia de **rebate pior no ar** (empate de preço com rebates diferentes; elegível melhor), sazonal fica para o dono, fim próximo do "a manter" = não mexer | `vigiaRebatePior` | SKILL "Rebate pior no ar" · analista 3-bis |
| Interrogatório (concordamos em N de M; divergências por padrão; pergunta objetiva) + aprendizado que vira regra e não é re-perguntado | `interrogar`, `promo_aprendizados` | analista passo 5 |
| **Invariante**: 0 elegíveis ≥ piso sem decisão + 0 protegidos descobertos sem alerta + 0 rebate-pior sem menção, com read-back em contagens (anúncios distintos na janela do KPI; a outra janela à parte). Fica **vermelho** também se algo que decide mudou depois da rodada: o marcador grava um selo (`entrada_hash`: pisos/imposto/janelas, custos por SKU e do cliente, regras por SKU, aprendizados IGNORAR, marcas/recusas 👤, ofertas e anúncios) e a marca gravada (pid, regra, preço **e MC%**) tem de bater com o recálculo | `invariante`, `lerInvariante`, `entradaSelo` | analista passo 6 / regra nº 1 |
| Plano: dry-run padrão, expira em 24h, pre-check **por margem**, MC negativa só com ordem direta, **nunca gera saída** | `montarPlano`, `assertSemSaida` | SKILL Fase 3 + "NUNCA SAIR DE CAMPANHA" |
| Executor: 2xx ≠ entrou; 409/504/400 podem ter gravado; propagação ~30 min; "0 entraram" é suspeita; só "entrou" com prova. Envia **exatamente** as chamadas do plano aprovado, contra os números aprovados | `promocoes-exec.js` | SKILL Fase 4 |
| Derrubadas (campanha sumiu antes do prazo × vencida × saiu da coleta) | `compararRodadas` | SKILL Fase 1 (`comparar_rodadas`) |

Convenções que merecem atenção: a **curva ABC** classifica pelo acumulado **antes** do anúncio (< 80% = A) — a mesma de
`diagnostico-conta.js`; "a de maior MC" na uma-marcação-por-anúncio é a de maior **MC%**; comparações com o piso usam MC arredondada a 2 casas.

## 5. O que NÃO foi portado (e por quê)

| Fora | Motivo / substituto |
|---|---|
| VPS (`dropx-rodar.sh`, scp, `nohup`, ssh) e o repo DropX | Este módulo roda no próprio servidor do Place Sprints, com o token OAuth do cliente |
| Bling (custo por SKU, ponderado por estoque) | Custo por SKU agora chega pela **integração de custos** (§10: planilha por webhook, Bling ou Tiny), somado ao manual (`promo_custos_sku`); como fallback, `custos_cliente` em percentuais. **Sem nenhum: SEM CUSTO**. Custo médio ponderado por estoque **não existe na API do Bling**: vale o `precoCusto` do fornecedor padrão (o médio só no Tiny, opt-in por cliente) |
| Google Sheets (planilha "Controle de Promoções", abas, ✔ lilás, banner, carimbo, `salvar_marcas`/`reaplicar_marcas`, Obs como canal de comando) | O banco e a tela substituem a planilha; as marcas ficam em `promo_decisao` (não morrem em rebuild) e a Obs de comando **não existe**: a decisão é por marca/recusa/regra |
| BFF e ponte de navegador (preço/"você recebe" do painel, siblings, `confirm-from-modal`, entrada de relâmpago SMART, preço próprio pelo modal, Pix pelo painel) | Não há sessão de painel. Relâmpago SMART é só recomendado e **sempre pulado no plano** (entra à mão no painel). MC é **estimada pela API** (não vê o subsídio de tarifa do painel: subestima, nunca infla) |
| **Campanhas escondidas pela listagem** (caso 30/09/2026) | Sem o BFF não há como listar todas. Mitigação parcial: toda campanha que aparece na **oferta de algum anúncio lido** é adotada (`origem = item`). **Declarado como limite em toda coleta** |
| Aba "Posicionamento" (lista privilegiada) | "Protegido" = curva A/B ou marcado como protegido na tela |
| Calculadora/aba "s/ rebate", "Promoções Manuais", `executar_sem_rebate`, PRICE_DISCOUNT 30d, Desconto no Pix, fila de sazonal, "campanha forte sem rebate" (manual − R$ 0,10) | O módulo cobre **rebate**. O vigia de cobertura aponta "SUGERIR MANUAL" com preço-alvo de 22% (`precoParaMargem`), mas **não cria promoção manual** |
| Competitividade de preço (Magalu/BPC), simulador T–Y | Dependem do painel e de outros canais |
| Sair de campanha (DELETE) | **Proibido pelo dono**: não existe no código, e o plano/executor recusam qualquer chamada que não seja POST de entrada |
| Camada 1 do SKU (`order.seller_sku` da venda) e fechamento no ClickUp | Não há leitura de pedido item a item aqui / fora do escopo |
| Imposto por empresa fixo (12%/13%) | `promo_config.imposto_pct` por cliente (ou `custos_cliente.imposto_pct`); **sem alíquota não há MC** |

## 6. Limites conhecidos

* **Campanha oculta** (acima): cobertura/elegíveis podem estar incompletos até conferir o painel.
* **MC é estimativa pela API**: comissão e taxa fixa são medidas no **preço de referência** (candidato em outra faixa de taxa fixa pode diferir); o frete usa o degrau de 8 faixas medido por anúncio. A coleta de tarifa/frete só roda para SKUs **com custo em R$ e rebate em jogo**, e **não foi validada contra a API real** (a conta de teste não tem campanha de rebate) — só testada com stub. Falha vira `NOT_AVAILABLE` e a MC cai no fallback percentual ou em "SEM TARIFA/FRETE".
* **Preço próprio em SMART** (desconto % pelo modal) não existe aqui: o plano entra no preço que o ML sugere.
* **Execução**: nunca testada ao vivo. O token do cliente precisa de escrita em ofertas (os escopos atuais trazem `urn:ml:mktp:offers:/read-write`; confirme no DevCenter). 403/409/5xx aparecem como `recusado`/`incerto`, nunca como "entrou".
* **Propagação**: o ML leva ~30 min para refletir a leva; o sync recusa ler antes disso.
* **Faturamento 30d/ABC** dependem da série de vendas do Place Sprints (a tela mostra até que dia vai); pedidos truncados em 1000/dia herdam o limite da coleta existente.
* Uma coleta/execução por vez no servidor (lock único em memória); reinício do servidor perde o acompanhamento do job (o resultado já gravado permanece).
* O ML pode devolver `limit` máximo de 50 por página; páginas por campanha limitadas a 100 (declarado se truncar).

## 7. Como habilitar a execução com segurança

A execução só roda com **duas chaves ao mesmo tempo**: (1) `promo_config.execucao_habilitada = 1` **daquele cliente** e (2) `confirmar === true` explícito
(`"true"`, `1`, `"sim"` são recusados). Além disso: plano **aprovado**, não expirado (24h), com hash íntegro, no máximo `execucao_max_itens` anúncios (padrão **1**).
Não há botão para ligar a chave 1 na tela — de propósito.

O executor **só envia as chamadas que estão no plano aprovado** (hedge ou oferta nova que apareceu ao vivo vira `nao_enviada` e pede novo plano; só o `offer_id` vivo é atualizado quando a campanha já está no plano),
compara a margem **contra o bloco `aprovado` do plano** (nunca contra marcas regravadas depois), relê a chave 1 **antes de cada POST** (desligar interrompe: o resto vira `nao_enviada`, estado `executado_parcial`),
recusa reenviar item × campanha com POST nos últimos 30 min (em **qualquer** plano) e reivindica o plano de forma atômica (`aprovado` → `executando`): uma execução por plano.
O plano **sempre termina gravado**: `executado` (houve POST), `executado_parcial` (houve POST e algo falhou/interrompeu) ou `erro` (falhou/foi interrompido sem nenhum POST), com o resultado parcial e a auditoria `execucao_erro`.
**Nunca `executado` com 0 chamadas:** se a execução não enviou nada por leitura ao vivo que falhou (ex.: 503) ou porque o pre-check barrou todos os itens, o plano **volta a `aprovado`** (vale até expirar), a auditoria é `execucao_nao_iniciada` com o motivo e a resposta da execução traz `estado: "nao_iniciada"` (o plano segue `aprovado`) e `nada_enviado: true`.
O resultado parcial (chamadas já enviadas) e o sinal de vida (`executando_em`) são gravados no plano **a cada POST**. Plano preso em `executando` após queda do servidor (sem sinal de vida há mais de 10 min) é **recuperado sozinho** — ao subir o servidor e antes de ler/sincronizar o plano:
vira `executado_parcial` com as chamadas reconstruídas da auditoria (`exec_pre` = tentativa de POST, `exec_post` = resposta; sem nenhum `exec_pre` vira `erro`), a auditoria é `execucao_recuperada` e a resposta do ML, que não foi guardada, faz nada virar "entrou" sem prova.
Plano recuperado **não se reexecuta**: sincronize (depois de ~30 min do último POST), confira em `/items/{id}/prices` e no painel e gere um plano novo (o guarda de 30 min impede o reenvio imediato).
**Hedge:** o hedge só existe por causa da campanha-âncora (guardada em `promo_decisao.ancora` no hedge do analista e em `ancora` no item do plano, coberta pelo hash). Recusa 👤 ou bloqueio da âncora — inclusive **depois** da aprovação — derruba o hedge (executor: `nao_enviada`, `ancora_recusada`);
o hedge nunca herda a origem "humano" da âncora (IGNORAR / Revisar toda rodada do anúncio vale para ele). Hedge SMART sem nome (nem na oferta nem na coleta) não entra: sem o nome não dá para saber se é relâmpago (`relampago_nome_desconhecido`).
**Pre-check:** com MC aprovada conhecida e MC viva não calculável (tarifa/custo/imposto sumiram) o item **não entra** — o ramo de preço só vale quando o aprovado também não tem MC.

1. Coleta **fresca** (< 12h), analista aplicado, invariante **verde**, `SEM CUSTO` conhecido e aceito.
2. Gere o plano (dry-run), leia **cada** chamada (método, caminho, corpo, `offer_id` vivo) e aprove com o seu nome.
3. **Primeira vez: 1 anúncio, supervisionado.** O limite padrão já força isso (se o plano tocar mais anúncios, marque só um e gere de novo).
4. Ligue a chave 1 (exige a frase inteira):
   ```bash
   curl -s -X POST http://localhost:3012/api/promocoes/config -H 'Content-Type: application/json' \
     -d '{"cliente":"<NOME EXATO>","execucao_habilitada":1,"habilitacao":"HABILITAR EXECUCAO REAL","por":"<seu nome>"}'
   ```
5. Execute pela tela (pede para digitar `EXECUTAR`) ou `POST /api/promocoes/plano/executar` com `{"cliente":…,"id":…,"confirmar":true,"por":…}`.
6. Espere **30 min**, rode **Sincronizar** e confira em `/items/{id}/prices` e no painel. "2xx" não é "entrou"; "0 entraram" é suspeita, não veredito: não refaça escrita antes de conferir na fonte.
7. **Desligue a chave 1** ao terminar (`"execucao_habilitada":0`). Só depois de uma execução provada suba `execucao_max_itens` aos poucos.

Toda tentativa bloqueada e toda chamada feita ficam em `promo_auditoria`: `execucao_bloqueada` (rota, executor, plano expirado/adulterado, chave desligada, frase errada, falta de `por`, lock de job), `plano_aprovacao_bloqueada`,
`aprova_analista_bloqueada`, `aprovacao_revogada`, `exec_pre`, `exec_post`, `execucao`, `execucao_erro`, `sync_pos_execucao`.

## 8. Rotas

Todas exigem `cliente` (precisa ter conta ML conectada). Erros são JSON `{ erro }`, sem stack; parâmetro repetido usa o primeiro valor.

| Método e rota | O que faz |
|---|---|
| `GET /api/promocoes/clientes` | clientes conectados + data da última coleta |
| `GET /resumo` | KPIs, invariante (read-back), frescor, **pendências e limites declarados** |
| `POST /coletar` · `GET /job/:id` | coleta em job (`vendas: true` atualiza a série de vendas antes); `por` obrigatório (400 sem ele) — vai na auditoria `coleta` e no job. Anúncio que o multiget devolve com 4xx por item (403/404/410…) vira **sem leitura** declarada (limite `ANUNCIOS_SEM_LEITURA` com os ids, `anuncios_sem_leitura` no resumo; ofertas descartadas, último dado velho) e NÃO deixa a coleta parcial; 429/5xx/rede/401 continuam parcial, e nada lido = erro |
| `GET /elegiveis` | por anúncio; filtros `curva`, `campanha`, `situacao`, `so_piso`, `q`, `sem_rebate`, `pagina`, `limite` |
| `POST /marcar` · `POST /aprovar-analista` · `POST /protegido` | decisão humana / aprovação de 🤖 (devolve `aprovadas` e `bloqueadas_por_recusa`) / protegido. `aprovar-analista` exige `itens: [{item_id, pid, preco, mc_pct}]` com os números EXIBIDOS (não há mais `todos: true`; "Aprovar todas" envia `GET /resumo` → `sugestoes_pendentes`): se qualquer sugestão mudou desde que a tela carregou, nada é aprovado — 409 `codigo: numeros_mudaram` |
| `POST /analista` | `aplicar: true` grava; qualquer outro valor é dry-run |
| `GET /participando` · `GET /relampago` | cobertura, descobertos, rebate pior, derrubadas / relâmpago |
| `GET/POST/DELETE /regras-sku` | CRUD das regras por SKU |
| `GET /custos` · `POST /custos/importar` | custos por SKU (CSV colado ou JSON) e SKUs sem custo. `GET /custos` traz `skus` (só o manual, como sempre), `skus_efetivos` (`{ total, itens }`, até 1.000: o custo que o analista de fato usa, com fonte, campo do ERP, frescor e fontes perdedoras) e `custos_pendencias` (`CUSTO_*`, §10). Texto colado: só **2 colunas** (`SKU;custo`) — 3+ colunas (`;`, tab ou `,`) é rejeitada com motivo; cabeçalho = só a 1ª linha e sem nenhum dígito, qualquer outra linha que falhe aparece em `rejeitadas` |
| `GET/POST /config` | pisos, imposto, janelas (ligar execução exige a frase) |
| `GET /interrogatorio` · `GET/POST /aprendizados` · `POST /aprendizados/desativar` | divergências e aprendizados (desativar um `regra_sku` desfaz a regra por SKU criada por ele — volta a anterior ou sai; regra editada à mão depois fica — e devolve `regra_desfeita`) |
| `POST /plano` · `GET /plano` · `GET /planos` · `POST /plano/aprovar` · `POST /plano/executar` · `POST /plano/sync` | plano (aprovar e executar exigem `por`; executar bloqueado = 403 `{erro, motivo}` sem job; sync lê também plano `executado_parcial`/`erro` e exige `por`, que vai na auditoria `sync_pos_execucao`) |
| `GET /auditoria` · `GET /exportar.csv?tipo=elegiveis\|plano\|auditoria\|descobertos` | auditoria e CSV (UTF-8 com BOM, `;`, apóstrofo contra fórmulas `= + - @`) |

## 9. Ligar no `server.js`

```js
import { rotasPromocoes } from './rotas-promocoes.js'          // junto dos outros imports
app.use(rotasPromocoes)                                          // logo depois de app.use(rotasPlanos)
app.get('/promocoes', (req, res) => res.sendFile(join(ROOT, 'src', 'web', 'promocoes.html')))   // junto de /cliente, /planos…
```

As tabelas `promo_*` nascem no primeiro import. A guarda global do servidor (Host local, bloqueio de POST de Origin externa) vale para as rotas novas.

## 10. Custos vindos de ERP/planilha (Bling, Tiny, Google Sheets)

Guia do usuário: `docs/integracao-custos-erp.md` · especificação: `docs/integracao-custos-erp-SPEC.md`.

* **Única troca no módulo:** `carregarEntrada` (analista) e a coleta (seleção de quem precisa de tarifa/frete) montam `custosSku` com `custosEfetivos(cliente)` (`src/lib/custos-db.js`) em vez de ler só `promo_custos_sku`. É um `Map<sku_minúsculo, custo>` igual ao de antes: `resolverCustos`, `calcularMC`, `montarPlano` e o executor não mudaram.
* **Precedência por cliente:** `manual > bling > tiny > sheets` (configurável; fonte fora da lista não é consumida). A aba Custos continua sendo o "manual" e sempre vence.
* **Nunca vira custo:** vazio, `null`, 0, negativo, texto, "R$ 12,50" vindo de máquina — a linha é rejeitada com código e o custo anterior continua valendo. Valor em **quarentena** (variação > 50% sobre o vigente da mesma fonte, custo ≥ preço cheio, kit divergente) também não vale até o dono aprovar: a MC não muda.
* **Custo que muda pode revogar aprovação 🤖** (regra existente: a aprovação vale para os números aprovados). O selo de entrada já inclui os custos, então a rodada fica desatualizada se um custo chegar no meio dela.
* **Pendências novas em `GET /resumo`:** `CUSTO_FONTE_VELHA` (3 dias ERP / 14 dias planilha), `CUSTO_FONTE_ERRO`, `CUSTO_REAUTORIZAR`, `CUSTO_QUARENTENA`, `CUSTO_REJEITADO`, `CUSTO_NAO_VISTO`. O texto de `SEM_CUSTO` aponta também para Integrações.
* **Troca de conta ML** (`limparPromocoesDoCliente`) apaga os derivados mas **preserva** custos, histórico, quarentena e credenciais (são entradas do dono); só limpam os conflitos que dependiam dos MLBs antigos.
* **Limite herdado:** custo de ERP só chega a anúncio **com SKU** (a chave é o SKU, sem casamento por título); anúncio com variações usa o SKU que a coleta resolveu (custo por variação não é suportado).
* Teste ponta a ponta (sem rede): `node scripts/teste-custos-integracao.mjs`; todos os de custos: `npm run teste:custos`.
