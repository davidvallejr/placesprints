# Contrato — Pendências do cliente por canal (08/10/2026)

Plano aprovado: `~/.claude/plans/na-matriz-eisenhower-a-crystalline-beacon.md` (seção "NOVO PEDIDO"). Esta página fixa a fronteira entre as frentes e o contrato HTTP/JSON.

## Frentes e donos dos arquivos

| Rodada | Frente | Dona de |
|---|---|---|
| A | **F1 — correções de agenda e envio** | `src/lib/relatorio-envio.js`, `src/rotas-relatorio.js`, `scripts/semear-relatorio-programacao.mjs`, `scripts/fixtures/relatorio-mundo.mjs`, `scripts/teste-relatorio-envio.mjs`, `scripts/teste-relatorio-rotas.mjs` |
| A | **F2 — correções de conteúdo, auditor e Notion** | `src/lib/relatorio-brief.js`, `src/lib/relatorio-brief-real.js`, `src/lib/relatorio-seguro.js`, `src/lib/relatorio-notion.js`, `src/lib/plano-informacoes.js`, `src/lib/placeplan.js`, `config/relatorio-brief.json`, `scripts/teste-relatorio-brief.mjs`, `teste-relatorio-seguro.mjs`, `teste-relatorio-notion.mjs`, `scripts/criar-planos-informacoes.mjs` |
| A | **F3 — catálogo, avaliador, registro manual, rotas, regra do plano** | `config/dependencias-cliente.json`, `docs/dependencias-cliente-por-canal.md`, `src/lib/pendencias-cliente.js`, `src/rotas-pendencias.js`, `src/lib/dependencia-cliente.js` (tipos), `src/lib/plano-cliente.js`, `src/lib/ficha-nucleo.js`, `src/lib/db.js` (só `pendencia_cliente`), `src/server.js` (só montar as rotas de pendências e corrigir o `desde` do risco), `scripts/teste-pendencias-*.mjs`, `scripts/teste-dependencia-cliente.mjs` (lista de tipos) |
| B | **F4 — explicação nos relatórios** | `relatorio-brief.js`/`relatorio-notion.js` (callouts), `semanal.js`, `render-semanal.js`, `relatorio.js`, `render-relatorio.js`, `render-plano-cliente.js` e os testes que fixam essas saídas |
| B | **F5 — alerta (interno + Notion do cliente)** | `src/lib/alerta-cliente.js`, `src/rotas-alertas.js`, `alerta_cliente` em `db.js`, linhas de timer/varredura em `server.js`, `scripts/teste-alerta-cliente.mjs` |
| B | **Telas (lead)** | `src/web/*`, `docs/ux/*`, `scripts/teste-shell-ui.mjs`, docs gerais |

Ninguém edita arquivo de outra frente; se precisar, descreva no relatório final.

## Pendência (saída do avaliador)

```
Pendencia = {
  id: 'estoque_curva_a|ml|resumo',          // estável: item|canal|chave
  item: 'estoque_curva_a',                  // id do catálogo
  rotulo: 'Estoque dos produtos que mais vendem',
  canal: 'ml' | 'shopee' | 'amazon' | 'tiktok' | 'magalu' | 'geral', canal_rotulo: 'Mercado Livre',
  tipo: 'produto',                          // chave de TIPOS (dependencia-cliente.js)
  fonte: 'medido' | 'tarefa' | 'registro',
  gravidade: 'critico' | 'atencao' | 'info', gravidade_rotulo: 'Crítico',
  desde: 'AAAA-MM-DD' | null, dias: number | null,
  evidencia: 'texto factual, datado, sem nome interno e sem ID',
  por_que_importa, efeito_se_atrasar, o_que_precisamos, o_que_fazemos,   // templates FIXOS do catálogo (nunca texto livre)
  impacto: { tipo: 'medido' | 'previsto' | 'sem_estimativa', valor_brl: number | null, rotulo: 'texto curto', premissa: string | null },
  tarefas: number,                          // tarefas do Notion paradas por este assunto
  registro_id: number | null
}
```

Regras: dado não coletado = `null`/"—", nunca zero; R$ só quando medido ou previsto com premissa declarada; sem integração (Shopee, Amazon, TikTok, Magalu) o impacto é `sem_estimativa`; texto ao cliente nunca cita responsável, prazo, ID, nome interno nem promete resultado; associação não é causalidade.

## HTTP

| Rota | Corpo / query | Resposta |
|---|---|---|
| `GET /api/cliente/pendencias?cliente=` | — | `{ cliente, gerado_em, resumo:{ total, criticas, atencao, impacto:{ valor_brl, tipo, premissa }\|null }, itens:[Pendencia], tarefas:[{id,titulo,url,dias,canal,tipo_rotulo}], alinhadas }` (prospect `[Comercial]` → 400; `alinhadas` = pendências e anúncios omitidos por alinhamento com o cliente, interno — `docs/alinhamentos.md`) |
| `GET /api/pendencias/catalogo` | — | `{ itens:[{ id, rotulo, canais, tipo }], canais:[{ id, rotulo }], gravidades:[…] }` |
| `POST /api/pendencias/registrar` | `{ cliente, item, canal, detalhe (≤300), desde?, evidencia?, gravidade?, por, confirmar? }` | prévia `{ ok:true, previa:true, pendencia:Pendencia, texto_cliente:{…} }`; confirmar `{ ok:true, registro_id }` (só líder/consultor; `confirmar === true` estrito) |
| `POST /api/pendencias/resolver` | `{ registro_id, por, nota?, confirmar? }` | prévia/confirmar no mesmo molde |

Mensagens de erro fixas, nunca ecoam o valor recebido; 415 sem JSON; estado de negócio impeditivo é 200 com `ok:false`.

## Alerta (rodada B)

`alerta_cliente` (tabela própria), título `Alerta Place2u · {tema} · dd/mm/aaaa`, interruptor `alerta_auto` desligado por padrão, cooldown 7 dias por (cliente, item), teto semanal por cliente, janela própria, reconferência ao vivo, auditor em todo template. Detalhes no plano.

## Regras comuns

- Node: `export PATH=$HOME/.local/node/bin:$PATH`. Testes importam `db.js` só com `process.env.PS_DB_MEMORIA = '1'` antes dos imports.
- Nunca copiar `data/db.sqlite`; nunca reiniciar o servidor (porta 3012); nunca chamar Notion/Mercado Livre de verdade (stubs); nunca editar `src/web/alerta.js`, `src/lib/notion-publicar.js`, `scripts/publicar-notion.mjs`, `src/lib/notion.js`.
- Sem git: edite só o necessário e confira com `node --check`; a suíte inteira (`node scripts/teste-*.mjs`) precisa terminar verde.
- Contratos de teste que MUDAM DE PROPÓSITO precisam ser listados no relatório final com o motivo.

## Política de gravidade e visibilidade (08/10/2026, depois da revisão do tom)

- **Data aproximada nunca é crítica.** Pendência de tarefa cuja data de início vem da última edição do card (`desde_origem = ultima_edicao`) tem gravidade no máximo `atencao`, não gera alerta automático ao cliente e, no texto ao cliente, não mostra contagem de dias ("em aberto, data aproximada dd/mm"). A classe `retorno_pendente` (tarefa sem tipo registrado) também fica em `atencao` no máximo: sem registro de o que foi pedido ao cliente, o sistema não afirma gravidade.
- **Crítica só com registro:** tipo registrado pelo líder (`encerrar` em dependência), registro manual ou medição do sistema (estoque curva A com leitura fresca, conta ML com erro).
- **Visibilidade:** o avaliador recebe `paraCliente` (padrão `true`): para texto ao cliente conta só tarefas com `visivel_cliente = 1`; as telas internas pedem `paraCliente:false`.
- **Quinta linha de explicação:** os relatórios mostram também "O que fazemos quando recebermos" (`o_que_fazemos`), para registrar o trabalho da Place2u.

### Como ficou no código (F7, 08/10/2026)

- `avaliar(cliente, { hoje, paraCliente = true })` em `src/lib/pendencias-cliente.js`. Quem vê: `paraCliente:false` = Resumo (`GET /api/cliente/pendencias`) e plano de ação (`plano-cliente.js` → `extra.pendCliente`); o PDF semanal e o relatório do sprint usam `paraCliente: !interno`; brief/Notion, alerta e o documento do plano (`/plano`) usam o padrão. Dependência injetada `visiveis(cliente, ids) → Set` (fiação real: `SELECT id FROM tarefas WHERE cliente = ? AND visivel_cliente = 1 AND id IN (SELECT value FROM json_each(?))`); sem ela o núcleo não filtra (só nos testes antigos). Medição do ML e registro manual não dependem da visibilidade.
- Teto de gravidade da tarefa: `retorno_pendente` e `desde_origem = ultima_edicao` ficam em `atencao` no máximo (`ate(grav, 'atencao')`). Consequência: `gatilhos.excluir_itens` do alerta já cobria `retorno_pendente`; a tarefa aproximada deixa de ser crítica e, portanto, de alertar.
- Texto: `evidencia` com `paraCliente` e data aproximada = `fatoAproximado(n, desde)` = "N tarefa(s) aguarda(m) o retorno do cliente (em aberto; data aproximada: dd/mm)."; a evidência interna (Resumo) mantém "N dia(s); data aproximada pela última atualização da tarefa". `impacto.rotulo` de tarefa aproximada não leva "há N dia(s)". `pendenciaParaCliente` zera `dias` quando aproximada e carrega `o_que_fazemos`; `quandoDe` = "em aberto; data aproximada: dd/mm" (data real: "desde dd/mm (N dias)"). `fatoParaCliente(p)` reconstrói o fato de qualquer pendência aproximada (usado no resumo do alerta do brief e em `alertaParaBlocos`).
- `linhasDePendencia` devolve 5 linhas: por que importa, se atrasar, o que precisamos, impacto e **O que fazemos quando recebermos** (`o_que_fazemos`, template do catálogo), iguais nos 4 relatórios.
- Aditivo: `calcularKpis().dependencia_14d_exata` (só datas reais) alimenta o "N há 14+ dias" do stat do sprint; `dependencia_14d` segue igual para as telas internas.
