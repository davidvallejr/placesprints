// Autoteste do auditor de conteúdo do relatório ao Notion (relatorio-seguro.js): cada código da tabela barra um bloco que o viola,
// texto honesto passa, o trecho ofensivo só aparece no retorno (nunca no log), limites do Notion, tipo de bloco e nomes internos. Puro: sem banco, sem rede.
// Rodar: node scripts/teste-relatorio-seguro.mjs
import assert from 'node:assert/strict'
import { auditarBlocos, auditarTexto, limitesNotion, PROIBICOES, TIPOS_PERMITIDOS, CATEGORIA, RX_JARGAO, textoDoBloco, linhasDeTexto, codigosDe, MAX_TOPO, criarDetectorNomes, limpaTexto } from '../src/lib/relatorio-seguro.js'

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const rich = t => [{ type: 'text', text: { content: t } }]
const par = t => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: rich(t) } })
const bul = t => ({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: rich(t) } })
const linha = (...cels) => ({ object: 'block', type: 'table_row', table_row: { cells: cels.map(rich) } })
const tabela = (...linhas) => ({ object: 'block', type: 'table', table: { table_width: linhas[0].table_row.cells.length, has_column_header: true, children: linhas } })
const NOMES = ['Giovanna Torres', 'Carla Souza', 'Adriano L.']
const cod = (blocos, o = {}) => auditarBlocos(blocos, { nomesInternos: NOMES, permitidos: ['Torres Materiais'], ...o }).map(v => v.codigo)

await ok('texto honesto passa: números, datas, hipótese rotulada, ressalvas com negação, "—", título/categoria fixos', () => {
  const limpo = [par('Conta em crescimento. Faturamento +12,4% nos últimos 14 dias (R$ 31.200,00 contra R$ 27.760,00).'), bul('Novas fotos do kit · Mercado Livre · 03/10'),
    par('Causa mais provável (hipótese): aumento de visitas. A associação entre ações e números não prova causa.'),
    par('Leitura indicativa; isto não é garantia de resultado e nada aqui foi comprovado como causa. Sem certeza de repetição.'),
    par('Medido · confiança média (72/100). “—” significa que o dado não foi coletado; nunca é zero.'),
    tabela(linha('Indicador', '7 dias', '7 dias anteriores', 'Variação'), linha('Faturamento', 'R$ 14.920,00', 'R$ 13.410,00', '▲ 11,3%')),
    par(`${CATEGORIA} · 02/10 a 08/10/2026`)]
  assert.deepEqual(auditarBlocos(limpo, { nomesInternos: NOMES }), [])
  assert.deepEqual(auditarTexto(`${CATEGORIA} · 02/10 a 08/10/2026`), [])
})

await ok('os 13 códigos existem na tabela PROIBICOES, cada um com descrição', () => {
  assert.deepEqual(PROIBICOES.map(p => p.codigo).sort(), ['analista', 'bloqueio_cru', 'causalidade', 'efeito_observado', 'id_interno', 'jargao', 'limite', 'promessa', 'segredo', 'sem_motivo', 'tipo_bloco', 'url_interna', 'valor_invalido'])
  assert.ok(PROIBICOES.every(p => p.descricao.length > 10 && typeof p.acha === 'function'))
})

await ok('cada código barra um bloco que o viola (um por vez)', () => {
  const casos = {
    sem_motivo: ['Aguardando devolutiva — sem motivo registrado — registre pela tela Painel executivo', 'Painel executivo'],
    id_interno: ['Duplicar oferta · PS-ab12cd34', 'Anúncio MLB123456789 voltou', 'ID do Produto: 77', 'Pedido 1234567890123456', 'Página 778ecccd97a04c46878e7dbb421c0e7c', 'Página 778eccdd-97a0-4c46-878e-7dbb421c0e7c'],
    analista: ['Feito por Giovanna Torres ontem', 'ajuste de CARLA SOUZA', 'responsável: Adriano L.', 'GIOVANNA  TORRES'],
    bloqueio_cru: ['Bloqueio: falta foto', 'Bloqueio de carga na entrega'],
    jargao: ['O API retornou 500 ao ler', 'veja config/algoritmo.json', 'status 403 no canal', 'foi ao Notion', 'Rodamos o sync', 'Pelo Merovíngio e o algoritmo', 'Relatório de Sprints da semana', 'transcrito do card'],
    promessa: ['Resultado garantido em 30 dias', 'Efeito comprovado', 'Temos certeza do ganho', 'Vai vender mais', 'Sobe no ranking', 'Primeira posição na busca', 'Fique no top 1'],
    causalidade: ['A promoção causou o aumento', 'A mudança provocou queda', 'Resultado direto da ação'],
    efeito_observado: ['Efeito observado: +9%'],
    valor_invalido: ['Faturamento: undefined', 'Ticket NaN', 'Visitas null', 'Conversão [object Object]', 'Ticket Infinity'],
    segredo: ['token secret_abc123', 'Authorization: Bearer xyz', 'ntn_1234', 'APP_USR-123', 'access_token=abc'],
    url_interna: ['abra http://localhost:3012/cliente', 'em 127.0.0.1', 'host 192.168.0.4', 'servidor.local'],
  }
  for (const [codigo, textos] of Object.entries(casos)) for (const t of textos) assert.ok(cod([par(t)]).includes(codigo), `${codigo}: "${t}" devia ser barrado`)
  // tipo_bloco: nada de arquivo, embed, bookmark, link_preview, child_page
  for (const tipo of ['file', 'embed', 'bookmark', 'link_preview', 'child_page', 'image', 'pdf', 'code']) assert.ok(cod([{ object: 'block', type: tipo, [tipo]: {} }]).includes('tipo_bloco'), tipo)
  for (const tipo of TIPOS_PERMITIDOS) assert.ok(!cod([{ object: 'block', type: tipo, [tipo]: { rich_text: rich('ok') } }]).includes('tipo_bloco'), tipo)
  // limite: 61 blocos de topo, trecho de 1901, 3 níveis, 101 filhos
  assert.ok(cod(Array.from({ length: MAX_TOPO + 1 }, () => par('x'))).includes('limite'))
  assert.ok(!cod(Array.from({ length: MAX_TOPO }, () => par('x'))).includes('limite'))
  assert.ok(cod([par('a'.repeat(1901))]).includes('limite')); assert.ok(!cod([par('a'.repeat(1900))]).includes('limite'))
  const fundo = { object: 'block', type: 'toggle', toggle: { rich_text: rich('t'), children: [{ object: 'block', type: 'toggle', toggle: { rich_text: rich('u'), children: [par('três níveis')] } }] } }
  assert.ok(cod([fundo]).includes('limite'))
  assert.ok(limitesNotion([tabela(linha('a', 'b'), ...Array.from({ length: 100 }, () => linha('c', 'd')))]).some(v => /100/.test(v.motivo)), '101 filhos')
  assert.ok(limitesNotion([par('x'.repeat(1000))].concat(Array.from({ length: 50 }, () => par('y'.repeat(9000)))), { maxTopo: 100 }).some(v => /450/.test(v.motivo)), 'corpo > 450 KB')
})

await ok('negação honesta não é promessa ("não é garantia", "sem comprovação", "nunca garantimos"), mas a promessa afirmada é', () => {
  for (const t of ['Isso não é garantia de resultado.', 'Sem comprovação de causa.', 'Nunca garantimos esse ganho.', 'não há certeza de repetição']) assert.ok(!cod([par(t)]).includes('promessa'), t)
  for (const t of ['Garantimos o resultado.', 'É garantido que sobe. Não duvide.', 'ranking primeira posição']) assert.ok(cod([par(t)]).includes('promessa'), t)
})

await ok('"Sprints" só vale no título/categoria fixos; nome do cliente em `permitidos` não conta como analista', () => {
  assert.deepEqual(auditarTexto(CATEGORIA), [])
  assert.ok(auditarTexto('Sprints da semana').map(v => v.codigo).includes('jargao'))
  assert.ok(auditarTexto(`${CATEGORIA} e mais Sprints`).map(v => v.codigo).includes('jargao'))
  // analista "Torres" só existe dentro do nome do cliente
  assert.deepEqual(auditarBlocos([par('Torres Materiais cresceu 10%')], { nomesInternos: ['Torres'], permitidos: ['Torres Materiais'] }), [])
  assert.ok(auditarBlocos([par('Torres cresceu')], { nomesInternos: ['Torres'], permitidos: ['Acme'] }).some(v => v.codigo === 'analista'))
  // palavra inteira: "Carla" não casa dentro de "carlana"
  assert.deepEqual(auditarBlocos([par('Carlana vendeu')], { nomesInternos: ['Carla'] }), [])
  assert.ok(auditarBlocos([par('Carla vendeu')], { nomesInternos: ['Carla'] }).length)
  assert.deepEqual(auditarBlocos([par('Ana vendeu')], { nomesInternos: ['Ao', '', '  '] }), [], 'nome curto/vazio é ignorado')
})

await ok('estrutura: tabela, filhos aninhados e link; caminho do bloco ("3" ou "3.1.0"); no máximo uma ocorrência por (código, bloco)', () => {
  const t = tabela(linha('Indicador', 'Valor'), linha('Pedido', 'NaN'))
  const v = auditarBlocos([par('ok'), par('ok'), t], { nomesInternos: [] })
  assert.deepEqual(v.map(x => [x.codigo, x.bloco]), [['valor_invalido', '2.1']])
  const c = { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'veja aqui', link: { url: 'http://localhost:3012/x' } } }] } }
  assert.deepEqual(auditarBlocos([c]).map(x => x.codigo), ['url_interna'], 'a URL do link também é auditada')
  const dup = auditarBlocos([par('undefined e NaN e null')]); assert.equal(dup.length, 1)
  assert.deepEqual(auditarBlocos([{ object: 'block', type: 'divider', divider: {} }]), [])
  assert.equal(textoDoBloco(linha('a', 'b')), 'a | b')
  assert.deepEqual(linhasDeTexto([par('um'), tabela(linha('x', 'y')), { object: 'block', type: 'divider', divider: {} }, bul('dois')]), ['um', 'x | y', 'dois'])
})

await ok('o trecho ofensivo é curto e só vem no retorno; codigosDe é o que vai ao log (nunca o texto)', () => {
  const v = auditarBlocos([par('x'.repeat(200) + ' Giovanna Torres ' + 'y'.repeat(200))], { nomesInternos: NOMES })
  assert.equal(v.length, 1); assert.ok(v[0].trecho.includes('Giovanna Torres') && v[0].trecho.length <= 81, v[0].trecho.length)
  assert.deepEqual(codigosDe([...v, ...v]), ['analista'])
  assert.ok(!JSON.stringify(codigosDe(v)).includes('Giovanna'))
})

await ok('RX_JARGAO local idêntico ao de render-semanal.js (quando a frente de conteúdo o exporta)', async () => {
  const m = await import('../src/lib/render-semanal.js')
  if (m.RX_JARGAO) assert.equal(m.RX_JARGAO.source, RX_JARGAO.source), assert.equal(m.RX_JARGAO.flags, RX_JARGAO.flags)
  else console.log('   (render-semanal.js ainda não exporta RX_JARGAO — cópia local mantida)')
  assert.ok(RX_JARGAO.test('config/x.json') && RX_JARGAO.test('retornou 500') && !RX_JARGAO.test('vendas subiram'))
})

// ── correções da revisão adversarial nº 2 (F2): as duas camadas ficam coerentes e o texto livre não passa ──────────────────────────────────────
const ZWSP = String.fromCharCode(0x200B), NBSP = String.fromCharCode(0x00A0)
const codT = (t, o = {}) => auditarTexto(t, { nomesInternos: NOMES, permitidos: [], ...o }).map(v => v.codigo)

await ok('item 10: radicais de causalidade e promessa (graças a, por causa de, devido a, gerou, trouxe, resultado da ação, provocado/causado, efeito direto, consequência, assegura, sem dúvida, vai bombar, dobrará, líder da categoria, número um, primeiro lugar, comprova…)', () => {
  const causal = ['Vendas dobraram graças à nova foto', 'Graças a esta ação', 'Aumento por causa da otimização do título', 'por causa do ajuste', 'devido à promoção, subiu', 'A ação gerou aumento de 20%', 'A ação trouxe R$ 5.000 de faturamento', 'Resultado da otimização',
    'resultado de nossa ação', 'provocado pela mudança', 'causado pela promoção', 'efeito direto da tarefa', 'consequência da troca', 'ocasionou o aumento', 'resultou em mais vendas', 'impactou positivamente']
  for (const t of causal) assert.ok(codT(t).includes('causalidade'), `causalidade: ${t}`)
  const promessa = ['Assegura mais vendas', 'Asseguramos o resultado', 'Sem dúvida sobe', 'Vai bombar no Natal', 'Dobrará o faturamento', 'Aumentará as vendas', 'Crescerá 30%', 'Líder da categoria', 'Número um do nicho', 'Nº 1 em vendas', 'Primeiro lugar na busca', 'Comprova o ganho', 'Comprovou que funciona', '100% certo', 'Sucesso total', 'Certamente vai crescer', 'Vai explodir em vendas', 'Garantir resultado', 'É garantido', 'Garantimos', 'A loja garante', 'Garantia de resultado']
  for (const t of promessa) assert.ok(codT(t).includes('promessa'), `promessa: ${t}`)
  // ressalva com negação segue valendo
  for (const t of ['Isso não é garantia de resultado.', 'Sem comprovação de causa.', 'Não houve consequência medida.', 'Não gerou aumento.', 'Nada comprova que foi a ação.', 'Sem certeza de repetição.', 'Nunca asseguramos ganho.', 'Sem garantia de resultado.']) assert.deepEqual(codT(t).filter(c => ['promessa', 'causalidade'].includes(c)), [], t)
  // "garantia" (atributo do anúncio) é palavra comum; "comprovante/comprovação" também; a definição do ROAS (texto fixo do motor) é definição, não causa
  for (const t of ['Garantia de 12 meses do fabricante', 'Ampliar as garantias oferecidas', 'Comprovante de Pagamento e Assinatura', 'Comprovação de tarefa', 'Quanto cada R$ 1 investido em anúncios trouxe de vendas (receita atribuída ÷ investimento).', 'Causa mais provável: caixa de compra perdida.'])
    assert.deepEqual(codT(t).filter(c => ['promessa', 'causalidade'].includes(c)), [], t)
  // normalização: espaço duplo, NBSP e zero-width não escondem o texto proibido
  for (const t of [`Efeito  observado: +9%`, `Efeito${NBSP}observado`, `Efeito obs${ZWSP}ervado`, `EFEITO OBSERVADO`]) assert.ok(codT(t).includes('efeito_observado'), JSON.stringify(t))
  assert.ok(codT(`Resultado gar${ZWSP}antido`).includes('promessa')); assert.ok(codT(`por${NBSP}causa${NBSP}da ação`).includes('causalidade'))
  assert.equal(limpaTexto(`a${ZWSP}b${NBSP}${NBSP}c\nd`), 'ab c\nd', 'limpaTexto: zero-width some, NBSP/espaço duplo viram um espaço, a quebra de linha fica')
})

await ok('item 11: "Sprint" só é jargão como produto/gestão ("Place Sprints", "sprints", "sprint de/da/do…", "a sprint"); nome de campanha passa; garantia não é promessa', () => {
  for (const t of ['Sprint Black Friday: preparar anúncios', 'Sprint final de estoque', 'Revisar preço (garantia estendida)']) assert.deepEqual(codT(t), [], t)
  for (const t of ['Sprints da semana', 'Relatório de Sprints Place2u e mais Sprints', 'sprint de vendas', 'Sprint do mês', 'na sprint atual', 'Sprint 3', 'Place Sprints', 'sprint planning']) assert.ok(codT(t).includes('jargao'), t)
  assert.deepEqual(codT(CATEGORIA), []); assert.deepEqual(codT(`${CATEGORIA} · 02/10 a 08/10/2026`), [])
  for (const t of ['ver planilha interna do ERP', 'Painel interno da equipe', 'uso interno']) assert.ok(codT(t).includes('jargao'), t)
})

await ok('item 15: nome interno por qualquer nome/sobrenome de 3+ letras, com separador _ - . , e zero-width; `permitidos` token a token; e-mail ignorado; palavra comum só junto do nome completo', () => {
  const N = ['Giovanna Torres', 'Carla Souza', 'Adriano L.', 'Thayná Alves Lava', 'Julia Rosa De Aguiar Araujo', 'Sara Souza', 'lojakairos@gmail.com', 'comercial@setefarma.com']
  const c = (t, o = {}) => codT(t, { nomesInternos: N, ...o })
  for (const t of ['feito pela Giovanna', 'Torres, Giovanna', 'G. Torres', 'Giovanna_Torres', 'GIOVANNA-TORRES', 'Gio Torres', `Giovanna${ZWSP}Torres`, 'GiovannaTorres', 'ajuste do Souza', 'por Adriano L.', 'Carla S.', 'TAREFA DE CASA SARA: CADASTRO MANUAL', 'feito pela Sara', 'Thayná', 'Thayná Alves Lava', 'Julia ajustou'])
    assert.ok(c(t).includes('analista'), `deve barrar: ${t}`)
  // permitidos por token: o sobrenome que existe no nome do cliente passa, o primeiro nome continua barrado
  assert.deepEqual(c('Torres Materiais cresceu 10%', { permitidos: ['Torres Materiais'] }).filter(x => x === 'analista'), [])
  assert.ok(c('Giovanna cuidou da Torres Materiais', { permitidos: ['Torres Materiais'] }).includes('analista'), 'só o token permitido sai')
  // e-mail não vira lista de palavras ("com", "gmail", "br", "comercial")
  for (const t of ['Reunião: Chamado com Suporte Meli', 'Enviar ao comercial por e-mail gmail', 'Anúncio .com.br']) assert.ok(!c(t).includes('analista'), t)
  // palavra comum (cor, verbo, sobrenome-palavra) só vale com o nome completo
  for (const t of ['Trocar capa para: Biquíni Rosa', 'Cadastro Bases - Boca Rosa', 'Máquina Lava Roupas 11kg', 'Shampoo Lava Autos', 'Cor Lima', 'Curva A — DG da Silva', 'Prazo de 30 dias']) assert.ok(!c(t, { nomesInternos: [...N, 'Marcelo Lima Pontes Junior', 'Alexandre Silva', 'Mariana Dias'] }).includes('analista'), t)
  assert.ok(c('Marcelo Lima Pontes Junior ajustou', { nomesInternos: ['Marcelo Lima Pontes Junior'] }).includes('analista'), 'nome completo ainda barra')
  assert.ok(c('Rosa ajustou', { nomesInternos: ['Rosa'] }).includes('analista'), 'se o nome interno é SÓ a palavra comum, ela vale sozinha')
  // palavra inteira e partículas
  assert.deepEqual(c('Carlana e Giovannas venderam', { nomesInternos: ['Carla', 'Giovanna Torres'] }).filter(x => x === 'analista'), [])
  assert.deepEqual(codT('a maioria dos anúncios, dos quais', { nomesInternos: ['Maria dos Santos'] }).filter(x => x === 'analista'), [], 'a partícula dos/das não vira nome')
  // o detector é reutilizável (a camada 1 do brief usa o mesmo) e memoizado
  const d = criarDetectorNomes(N, []); assert.equal(d.vazio, false); assert.ok(d.test('Giovanna')); assert.equal(d.achar('nada a ver'), null); assert.equal(criarDetectorNomes(N, []), d, 'memoizado'); assert.equal(criarDetectorNomes(['x', 'a@b.com'], []).vazio, true)
})

await ok('item 16k: IDs mais curtos — MLB com espaço, MLBU, MLA/MLM/MLC, 10–12 dígitos (CPF/CNPJ/telefone), CPF e CNPJ formatados; números do relatório continuam passando', () => {
  for (const t of ['Anúncio MLB 123456789', 'MLB-1234 56789', 'MLBU1234567890', 'MLA1234567', 'MLM123456789', 'MLC 1234567', 'Pedido 1234567890', 'CPF 12345678901', 'Tel 11999998888', 'CPF 123.456.789-01', 'CNPJ 12.345.678/0001-90', 'Duplicar · PS-ab12cd34', 'tarefaPS-ab12cd34x'])
    assert.ok(codT(t).includes('id_interno'), t)
  for (const t of ['Faturamento R$ 1.234.567,89', '12.345 visitas', '115 pedidos em 2026-10-08', 'Cobertura de 45 dias', 'MLB 2024', 'Pedidos: 7 de 9', 'Nota 4,8 (1.203 avaliações)']) assert.ok(!codT(t).includes('id_interno'), t)
})

await ok('diagnóstico (08/10): job de Ofertas ("job" + 8 hex) e ids do contrato do diagnóstico (ev-/dp- + 10 hex) são ID interno; o que só se parece passa', () => {
  for (const t of ['Galeria · job 3e0c980e (escopo oferta_completa, objetivo lancar)', 'JOB 3E0C980E', 'conferir ev-0123456789', 'prompt dp-abcdef0123', 'ver ev-abcdefabcd.']) assert.ok(codT(t).includes('id_interno'), t)
  for (const t of ['Job de verão da loja', 'job 12345', 'ev-123 e dp-xyz', 'job 3e0c980', 'kit dev-abcdefabcd', 'nev-abcdefabcd']) assert.ok(!codT(t).includes('id_interno'), t)
})

await ok('diagnóstico (refutação 08/10): fragmento de variante sem anúncio ("variante" + 8 hex, título de oferta_cadastro) é ID interno; o que só se parece passa', () => {
  for (const t of ['Lançar anúncio novo: variante 7c1e9a42', 'Galeria · Variante ABCDEF12', 'variante 12ab34cd.']) assert.ok(codT(t).includes('id_interno'), t)
  for (const t of ['variante azul', 'variante 7c1e9a4', 'variante 7c1e9a42x', 'Camiseta variante P', 'invariante 7c1e9a42']) assert.ok(!codT(t).includes('id_interno'), t)
})

console.log(`\n${n} verificações do auditor ok.`)
