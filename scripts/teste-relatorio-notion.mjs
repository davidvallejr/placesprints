// Autoteste do plumbing Notion do relatório (relatorio-notion.js): brief → blocos, esquema com os dois tipos de Secção (select e status) e chaves com espaço
// no fim, decisão da categoria, destino (estados, revalidação única, id por regex, cache de 10 min), criação numa chamada só com o corpo exato, consulta por título,
// mapeamento fixo de erros SEM eco do corpo do Notion e a política de envio com 5xx → consulta por título (incerto) e substituir (cria antes de arquivar).
// STUB do Notion + banco em memória + relógio falso: nunca toca o Notion real nem data/db.sqlite.
// Rodar: node scripts/teste-relatorio-notion.mjs
process.env.PS_DB_MEMORIA = '1'   // plano-informacoes.js (parseTituloPlano) entra por import() dinâmico; o banco é em memória
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { briefParaBlocos, esquemaInformacoes, valorPropriedade, decidirCategoria, decidirStatus, criarRelatorioNotion, classificarErro, tituloOk, tituloAlertaOk, PREFIXO_ALERTA, tituloFinal, casaTituloPlano, rt, urlDe, RX_ID, MSG_NOTION, MSG_POR_CODIGO } from '../src/lib/relatorio-notion.js'
import { auditarBlocos, limitesNotion, CATEGORIA, linhasDeTexto } from '../src/lib/relatorio-seguro.js'
import { estadoDeHandle } from '../src/lib/relatorio-envio.js'
import { criarMundo, criarRelogio, briefSintetico, propsInformacoes, SEGREDO, montarEnvio, confirmar, linhasEnvio } from './fixtures/relatorio-mundo.mjs'
import { pendenciaParaCliente, quandoDe, fatoAproximado, fatoParaCliente } from '../src/lib/pendencias-texto.js'
import { montar as montarPend, itemMl, baseMl, tarefa as tarefaDep } from './fixtures/pendencias-mundo.mjs'

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const tipos = bs => bs.map(b => b.type)
const todoTexto = bs => linhasDeTexto(bs).join('\n')

// ── 1. brief → blocos (puro) ────────────────────────────────────────────────────────────────────────────────
await ok('briefParaBlocos: sequência do plano (callout, carimbo, divider, Resultados em tabela, Atividades, Desenvolvimento, Próximos passos em tabela, Depende, divider, rodapé)', () => {
  const bs = briefParaBlocos(briefSintetico('Acme'))
  assert.deepEqual(tipos(bs), ['callout', 'paragraph', 'divider', 'heading_2', 'table', 'paragraph', 'paragraph', 'heading_2', 'heading_3', 'bulleted_list_item', 'bulleted_list_item', 'heading_3', 'bulleted_list_item',
    'heading_3', 'bulleted_list_item', 'heading_2', 'heading_3', 'bulleted_list_item', 'heading_3', 'bulleted_list_item', 'heading_2', 'table', 'heading_2', 'callout', 'divider', 'paragraph', 'paragraph', 'paragraph'])
  assert.ok(bs.length <= 60)
  assert.deepEqual(bs.filter(b => b.type.startsWith('heading')).map(b => b.type), bs.filter(b => b.type.startsWith('heading')).map(b => b.type).filter(t => t !== 'heading_1'), 'heading só h2/h3 (h1 é do título)')
  assert.equal(bs[0].callout.color, 'green_background'); assert.equal(bs[0].callout.icon.emoji, '🧭')
  assert.match(todoTexto(bs), /Gerado em 16\/10\/2026 às 17:00 · Últimos 7 dias fechados: 09\/10 a 15\/10\/2026/)
  const tab = bs[4].table
  assert.deepEqual([tab.table_width, tab.has_column_header, tab.children.length], [4, true, 4])
  assert.deepEqual(tab.children[0].table_row.cells.map(c => c[0].text.content), ['Indicador', '7 dias', '7 dias anteriores', 'Variação'])
  // só a célula de variação leva cor (verde = bom, vermelho = ruim); vazio é célula vazia/"—", nunca zero inventado
  assert.equal(tab.children[1].table_row.cells[3][0].annotations.color, 'green'); assert.equal(tab.children[2].table_row.cells[3][0].annotations.color, 'red')
  assert.ok(tab.children.every(l => l.table_row.cells.slice(0, 3).every(c => !c[0]?.annotations)), 'só a Variação tem cor')
  assert.deepEqual(tab.children[3].table_row.cells.map(c => c[0].text.content), ['Pedidos cancelados', '—', '—', '—'])
  assert.match(todoTexto(bs), /Hoje \(16\/10\) até 17:00: R\$ 320,00 em 4 pedidos — dia em andamento, fora da comparação acima\./)
  const px = bs.filter(b => b.type === 'table')[1].table
  assert.deepEqual(px.children.map(l => l.table_row.cells.map(c => c[0].text.content)), [['Quando', 'O que vem'], ['Quarta, 21/10', 'Novas fotos do kit de jardinagem'], ['Segunda, 02/11', 'No radar: preparar a Black Friday (27/11)']])
  assert.equal(bs[23].callout.color, 'yellow_background', 'Depende de você = callout âmbar')
  assert.deepEqual(auditarBlocos(bs, { nomesInternos: [], permitidos: ['Acme'] }), [], 'o que o conversor gera passa no auditor')
  assert.deepEqual(limitesNotion(bs), [])
})

await ok('tom do callout por resultado; "Depende de você" só se houver; vazios honestos; modo sem_resultados mantém Atividades e Próximos passos', () => {
  const cor = tom => briefParaBlocos(briefSintetico('A', { extra: { abertura: { tom, cabecalho: 'X', frase: 'y', nudge: '' } } }))[0].callout.color
  assert.deepEqual(['verde', 'amarelo', 'laranja', 'cinza', 'qualquer'].map(cor), ['green_background', 'yellow_background', 'orange_background', 'gray_background', 'gray_background'])
  const vazio = { depende: { itens: [] }, atividades: { lista: false, concluido: { total: 0, por_canal: [], grupos: [] }, andamento: { total: 0, itens: [], promocoes: [] } }, proximos: { itens: [], radar: [], agenda: null, vazio: null },
    desenvolvimento: { resultados: [], vazio_resultados: null, mudancas: [], vazio_mudancas: null } }
  const bs = briefParaBlocos(briefSintetico('A', { modo: 'sem_resultados', extra: vazio }))
  const t = todoTexto(bs)
  assert.ok(!bs.some(b => b.type === 'callout' && b.callout.color === 'yellow_background' && /desde/.test(JSON.stringify(b))), 'sem dependências: sem callout âmbar')
  assert.ok(!/Depende de você/.test(t))
  for (const frase of ['Conta do Mercado Livre ainda não conectada ao relatório; nenhum número foi estimado.', 'Nenhuma ação concluída neste período.', 'Nenhuma ação em andamento no momento.', 'Sem datas futuras confirmadas para os próximos 14 dias.', 'Nenhuma tarefa concluída tem efeito medido ou informado até agora.']) assert.ok(t.includes(frase), frase)
  assert.ok(!t.includes('O que mudou nos anúncios') && !t.includes('Nenhuma mudança relevante registrada neste período.'), 'sem histórico de anúncios (sem Mercado Livre): a seção some em vez de afirmar "nenhuma mudança"')
  assert.ok(!bs.some(b => b.type === 'table'), 'sem números e sem datas: nenhuma tabela')
  // frases vazias do próprio brief têm prioridade
  const t2 = todoTexto(briefParaBlocos(briefSintetico('A', { extra: { ...vazio, desenvolvimento: { resultados: [], vazio_resultados: 'Sem efeito medido ainda.', mudancas: [], vazio_mudancas: 'O histórico ainda não cobre a semana.' }, proximos: { itens: [], radar: [], agenda: null, vazio: 'Nada marcado.' } } })))
  assert.ok(t2.includes('Sem efeito medido ainda.') && t2.includes('O histórico ainda não cobre a semana.') && t2.includes('Nada marcado.'))
  // cliente que não lista tarefas: uma linha de contagem por canal
  const t3 = todoTexto(briefParaBlocos(briefSintetico('A', { extra: { atividades: { lista: false, concluido: { total: 5, por_canal: [{ canal: 'TikTok Shop', n: 4 }, { canal: 'Mercado Livre', n: 1 }], grupos: [] }, andamento: { total: 2, itens: [], promocoes: [] } } } })))
  assert.ok(t3.includes('5 ações concluídas — TikTok Shop 4 · Mercado Livre 1.') && t3.includes('2 ações em andamento.'))
})

await ok('nenhum "undefined"/"NaN"/"null" mesmo com brief torto; rich_text em segmentos ≤1900 (sem truncar); no máximo 60 blocos de topo no pior caso', () => {
  const torto = { cliente: 'A', hoje: '2026-10-16', janela: { rotulo: undefined }, abertura: { tom: 'verde', cabecalho: undefined, frase: null, nudge: undefined },
    resultados: { disponivel: true, linhas: [{ rotulo: undefined, atual: null, anterior: undefined, variacao: { texto: undefined, sinal: 'bom' } }, null, { chave: 'x', rotulo: 'Visitas', atual: 1263, anterior: NaN, variacao: undefined }], hoje: { ate_hora: '14:20', faturamento: undefined, pedidos: undefined }, nao_coletado: [undefined, null], outros: [{ canal: undefined, texto: 'x' }, null] },
    atividades: { lista: true, concluido: { total: undefined, grupos: [{ rotulo: undefined, n: NaN }, null] }, andamento: { itens: [{ rotulo: undefined }, null], promocoes: [{ rotulo: 'P', ate: undefined }, null] } },
    desenvolvimento: { resultados: [{ rotulo: undefined, selo: 'x', confianca: { nivel: undefined, pct: undefined }, metrica: undefined }, null], mudancas: [{ quando: undefined, texto: 'm' }, null] },
    proximos: { itens: [{ quando: undefined, rotulo: 'r' }, null], radar: [{ rotulo: 'rr' }], agenda: { p7: undefined, p8_14: 2 } }, depende: { itens: [{ rotulo: 'd', desde: undefined, dias: undefined }, null] }, rodape: [undefined, null, 'ok'] }
  const bs = briefParaBlocos(torto), j = JSON.stringify(bs)
  assert.ok(!/\bundefined\b|\bNaN\b|\[object/.test(j), 'sem undefined/NaN no JSON')
  assert.deepEqual(auditarBlocos(bs, { nomesInternos: [] }).filter(v => v.codigo === 'valor_invalido'), [])
  // segmentos
  const longo = 'palavra '.repeat(1000)                              // 8000 caracteres
  const seg = rt(longo); assert.ok(seg.length >= 5 && seg.every(s => s.text.content.length <= 1900))
  assert.equal(seg.map(s => s.text.content).join(''), longo, 'não trunca em silêncio')
  assert.deepEqual(rt(''), []); assert.deepEqual(rt(undefined), []); assert.deepEqual(rt(null), [])
  const b2 = briefParaBlocos(briefSintetico('A', { extra: { abertura: { tom: 'verde', cabecalho: 'T', frase: longo, nudge: '' } } }))
  assert.ok(b2[0].callout.rich_text.every(s => s.text.content.length <= 1900) && limitesNotion(b2).length === 0)
  // pior caso: tudo no teto
  const mx = briefSintetico('A', { extra: {
    atividades: { lista: true, concluido: { total: 99, grupos: Array.from({ length: 30 }, (_, i) => ({ rotulo: `a${i}`, canal: 'ML', quando: '03/10', n: 1 })) }, andamento: { total: 30, itens: Array.from({ length: 30 }, (_, i) => ({ rotulo: `b${i}` })), promocoes: Array.from({ length: 30 }, (_, i) => ({ rotulo: `p${i}`, ate: '2026-10-20' })) } },
    desenvolvimento: { resultados: Array.from({ length: 30 }, (_, i) => ({ rotulo: `r${i}`, selo: 'medido', metrica: { rotulo: 'm', texto: 't' } })), mudancas: Array.from({ length: 30 }, (_, i) => ({ quando: '03/10', texto: `m${i}` })) },
    proximos: { itens: Array.from({ length: 30 }, (_, i) => ({ quando: '2026-10-21', rotulo: `i${i}` })), radar: Array.from({ length: 30 }, (_, i) => ({ quando: '2026-11-02', rotulo: `r${i}` })), agenda: { p7: 1, p8_14: 1 } },
    depende: { itens: Array.from({ length: 30 }, (_, i) => ({ rotulo: `d${i}`, desde: '2026-10-09', dias: 7 })) }, rodape: Array.from({ length: 30 }, (_, i) => `rodapé ${i}`) } })
  const bmax = briefParaBlocos(mx)
  assert.ok(bmax.length <= 60, `pior caso com ${bmax.length} blocos`); assert.deepEqual(limitesNotion(bmax), [])
})

// ── 2. esquema, categoria, status ───────────────────────────────────────────────────────────────────────
await ok('esquemaInformacoes: chaves EXATAS lidas do esquema ("Secção " com espaço no fim), tipos select e status, "Status 1"/"Lista "/"Link " ignorados', () => {
  const a = esquemaInformacoes(propsInformacoes({ secao: 'select', opcaoCategoria: true }))
  assert.deepEqual(a.titulo, { chave: 'Name' })
  assert.deepEqual(a.secao, { chave: 'Secção ', tipo: 'select', opcoes: ['Plano de Ação', CATEGORIA] })
  assert.deepEqual(a.status, { chave: 'Status', tipo: 'select', opcoes: ['Pendente', 'Concluído'] }, '"Status 1" (tipo status) não é o Status')
  const b = esquemaInformacoes(propsInformacoes({ secao: 'status' }))
  assert.deepEqual([b.secao.chave, b.secao.tipo], ['Secção ', 'status'])
  assert.equal(esquemaInformacoes(propsInformacoes({ secao: null })).secao, null)
  // variações de grafia: Seção/Secção, com e sem espaço, caixa; tipo errado não casa
  for (const k of ['Seção', 'secção', 'SECÇÃO ', ' Secao']) assert.equal(esquemaInformacoes({ T: { type: 'title' }, [k]: { type: 'select', select: { options: [] } } }).secao?.chave, k, k)
  assert.equal(esquemaInformacoes({ T: { type: 'title' }, 'Secção ': { type: 'multi_select', multi_select: { options: [] } } }).secao, null)
  assert.deepEqual(esquemaInformacoes(undefined), { titulo: null, status: null, secao: null })
  assert.deepEqual(valorPropriedade({ chave: 'x', tipo: 'select' }, 'A'), { select: { name: 'A' } }); assert.deepEqual(valorPropriedade({ chave: 'x', tipo: 'status' }, 'A'), { status: { name: 'A' } })
})

await ok('decidirCategoria: ok (grafia da base), select_cria, status ok, opcao_ausente_status (bloqueia), padrao_da_base (sem_categoria), sem_propriedade — com a chave exata', () => {
  const E = o => esquemaInformacoes(propsInformacoes(o))
  let c = decidirCategoria(E({ secao: 'select', opcaoCategoria: true }))
  assert.deepEqual([c.estado, c.bloqueia, c.propriedades], ['ok', false, { 'Secção ': { select: { name: CATEGORIA } } }])
  const grafia = esquemaInformacoes({ N: { type: 'title' }, 'Secção ': { type: 'select', select: { options: [{ name: 'relatório de sprints PLACE2U ' }] } } })
  c = decidirCategoria(grafia); assert.deepEqual([c.estado, c.propriedades['Secção '].select.name], ['ok', 'relatório de sprints PLACE2U '], 'usa a grafia da base')
  c = decidirCategoria(E({ secao: 'select', opcaoCategoria: false }))
  assert.deepEqual([c.estado, c.bloqueia, c.propriedades, /será criada|vai criá-la/.test(c.aviso)], ['select_cria', false, { 'Secção ': { select: { name: CATEGORIA } } }, true])
  c = decidirCategoria(E({ secao: 'status', opcaoCategoria: true })); assert.deepEqual([c.estado, c.propriedades], ['ok', { 'Secção ': { status: { name: CATEGORIA } } }])
  c = decidirCategoria(E({ secao: 'status', opcaoCategoria: false }))
  assert.deepEqual([c.estado, c.bloqueia, c.propriedades], ['opcao_ausente_status', true, {}]); assert.ok(c.aviso.includes('Informações › Secção') && c.aviso.includes(CATEGORIA))
  c = decidirCategoria(E({ secao: 'status', opcaoCategoria: false }), { semCategoria: true })
  assert.deepEqual([c.estado, c.bloqueia, c.propriedades], ['padrao_da_base', false, {}]); assert.ok(/categoria errada|padrão da base/.test(c.aviso))
  c = decidirCategoria(E({ secao: null })); assert.deepEqual([c.estado, c.bloqueia, c.propriedades], ['sem_propriedade', false, {}])
  // 09/10: status sem a opção própria mas com uma alternativa já existente (config categoria_alternativas: «Relatórios») → ok_alternativa, não bloqueia; o alerta (outra categoria) não usa alternativa
  const alt = esquemaInformacoes({ N: { type: 'title' }, 'Secção ': { type: 'status', status: { options: [{ name: 'Marketplaces Ativos' }, { name: 'Relatórios' }, { name: 'Alinhamentos' }] } } })
  c = decidirCategoria(alt); assert.deepEqual([c.estado, c.bloqueia, c.propriedades], ['ok_alternativa', false, { 'Secção ': { status: { name: 'Relatórios' } } }]); assert.ok(c.aviso.includes('«Relatórios»'))
  c = decidirCategoria(alt, { categoria: 'Alertas' }); assert.deepEqual([c.estado, c.bloqueia], ['opcao_ausente_status', true], 'alternativa só vale para a categoria do relatório')
  // Status = Concluído só com a opção que já existe (nunca cria opção)
  assert.deepEqual(decidirStatus(E({ concluido: true })).propriedades, { Status: { select: { name: 'Concluído' } } })
  const sem = decidirStatus(E({ concluido: false })); assert.deepEqual(sem.propriedades, {}); assert.match(sem.aviso, /Concluído/)
  assert.deepEqual(decidirStatus(esquemaInformacoes({ N: { type: 'title' } })), { propriedades: {}, aviso: '' })
})

await ok('título: nunca casa parseTituloPlano (a de verdade) nem contém PlacePlan; destino compartilhado leva o cliente ao final', async () => {
  const { parseTituloPlano } = await import('../src/lib/plano-informacoes.js')
  const titulos = [`${CATEGORIA} · 02/10 a 08/10/2026`, `${CATEGORIA} · 29/12/2026 a 04/01/2027`, `${CATEGORIA} · 02/10 a 08/10/2026 (Casa e Brasa (Consultoria))`]
  for (const t of titulos) { assert.equal(parseTituloPlano(t), null, t); assert.equal(casaTituloPlano(t), false); assert.ok(tituloOk(t), t); assert.ok(!/PlacePlan/i.test(t)) }
  // a cópia local concorda com o parser real em títulos de plano e de não-plano
  for (const t of ['Setembro/26 - Amz', 'Outubro/26 ML · PlacePlan', 'março/2026 - Shopee', 'Janeiro / 26 - X', 'Relatório Semanal', 'abril/26 sem traço', 'foo/26 - x', 'Outubro/26 - ']) assert.equal(casaTituloPlano(t), parseTituloPlano(t) !== null, t)
  for (const ruim of ['Setembro/26 - Amz', `${CATEGORIA} · x PlacePlan`, `${CATEGORIA}\n2`, 'Outro título', 'x'.repeat(300)]) assert.equal(tituloOk(ruim), false, ruim)
  assert.equal(tituloFinal(titulos[0], { cliente: 'Casa e Brasa', compartilhado: true }), `${titulos[0]} (Casa e Brasa)`); assert.equal(tituloFinal(titulos[0], { cliente: 'A' }), titulos[0])
  const b = briefSintetico('A'); assert.ok(tituloOk(b.titulo) && parseTituloPlano(b.titulo) === null)
})

// ── 3. destino, consulta, criação, arquivo, erros (stub do Notion) ─────────────────────────────────────────────────
function montarNotion(w, relogio = criarRelogio()) {
  const h = new Database(':memory:'); const estado = estadoDeHandle(h)
  const nt = criarRelatorioNotion({ notion: w.notion, estado, fontes: w.destinos.fontes, resolverPaginaCliente: w.destinos.resolverPaginaCliente, acharInformacoesDb: w.destinos.acharInformacoesDb, invalidar: w.destinos.invalidar, agora: relogio.agora })
  return { nt, estado, h, relogio }
}

await ok('destinoDe: ok (página validada, base, data source, esquema) — e o schema é cacheado por 10 minutos', async () => {
  const w = criarMundo(); w.adicionar('Acme', { secao: 'select', opcaoCategoria: true })
  const { nt, relogio } = montarNotion(w)
  const d = await nt.destinoDe('Acme')
  assert.deepEqual([d.estado, d.cliente, d.compartilhado, d.pagina_titulo, d.mensagem], ['ok', 'Acme', [], 'Página de Acme', ''])
  assert.ok(RX_ID.test(d.ds) && d.esquema.secao.chave === 'Secção ' && d.informacoes_url.startsWith('https://www.notion.so/'))
  assert.deepEqual(w.chamadas.map(c => c.caminho.replace(/[0-9a-f]{32}/g, 'ID')), ['pages/ID', 'databases/ID', 'data_sources/ID'])
  await nt.destinoDe('Acme'); assert.equal(w.chamadasDe('GET', 'data_sources/').length, 1, 'schema em cache')
  relogio.avancarMin(11); await nt.destinoDe('Acme'); assert.equal(w.chamadasDe('GET', 'data_sources/').length, 2, 'cache vence em 10 min')
})

await ok('destinoDe: todos os casos esperados viram ESTADOS (sem_pagina, pagina_invalida, sem_base, base_invalida, destino_compartilhado, sem_titulo, sem_permissao)', async () => {
  const w = criarMundo()
  w.adicionar('SemFonte', { semFonte: true }); w.adicionar('PaginaMorta', { pagina: '404' }); w.adicionar('PaginaArquivada', { pagina: 'arquivada' }); w.adicionar('SemBase', { base: false }); w.adicionar('SemAcesso', { pagina: '403' })
  w.adicionar('BaseQuebrada'); w.infoDePagina.set(w.cfgCli.get('BaseQuebrada').pagina_id, 'f'.repeat(32))        // info aponta para uma base que não existe (404)
  w.adicionar('Par A'); w.adicionar('Par B', { paginaId: w.cfgCli.get('Par A').pagina_id }); w.idPagina.set(w.cfgCli.get('Par A').pagina_id, 'Par A')
  const { nt, estado } = montarNotion(w)
  estado.set('pagina_cliente:Par A', w.cfgCli.get('Par A').pagina_id); estado.set('pagina_cliente:Par B', w.cfgCli.get('Par A').pagina_id)
  const est = async c => (await nt.destinoDe(c))
  assert.equal((await est('Inexistente')).estado, 'sem_pagina'); assert.equal((await est('SemFonte')).estado, 'sem_pagina')
  const pm = await est('PaginaMorta'); assert.equal(pm.estado, 'pagina_invalida'); assert.equal(w.invalidados.filter(([c]) => c === 'PaginaMorta').length, 1, 'invalida UMA vez')
  assert.equal((await est('PaginaArquivada')).estado, 'pagina_invalida')
  assert.equal((await est('SemBase')).estado, 'sem_base'); assert.equal((await est('SemAcesso')).estado, 'sem_permissao')
  const bq = await est('BaseQuebrada'); assert.equal(bq.estado, 'base_invalida')
  w.chamadasInfo.length = 0; await nt.destinoDe('SemBase'); assert.deepEqual(w.chamadasInfo, [{ ttlNegativoMs: 6 * 3600e3 }], 'o relatório PASSA o cache negativo de 6 h (o padrão de acharInformacoesDb é 0)')
  w.chamadasInfo.length = 0; await nt.destinoDe('SemBase', { reescanear: true }); assert.deepEqual(w.chamadasInfo, [{ ttlNegativoMs: 0 }], '"Verificar bases" reescaneia')
  const pa = await est('Par A'); assert.deepEqual([pa.estado, pa.compartilhado], ['destino_compartilhado', ['Par B']]); assert.ok(pa.ds && pa.esquema, 'compartilhado traz o destino resolvido (o manual pode confirmar)')
  assert.match(pa.mensagem, /compartilhad/)
  // sem coluna de título
  w.adicionar('SemTitulo'); const c = w.cfgCli.get('SemTitulo'); const orig = w.notion.req
  w.notion.req = async (cam, o) => { const r = await orig(cam, o); return cam === `data_sources/${c.ds_id}` ? { ...r, properties: { Status: r.properties.Status } } : r }
  const { nt: nt2 } = montarNotion(w); assert.equal((await nt2.destinoDe('SemTitulo')).estado, 'sem_titulo')
  // mensagens fixas por estado, sem ids
  for (const c of ['SemFonte', 'PaginaMorta', 'SemBase', 'SemAcesso', 'BaseQuebrada', 'Par A']) assert.ok(!/[0-9a-f]{32}/.test((await est(c)).mensagem), c)
})

await ok('destinoDe: id velho do cache → revalida UMA vez com forcar e se corrige; id fora do formato nunca entra numa URL', async () => {
  const w = criarMundo(); const c = w.adicionar('H1 Editora', { secao: 'select', opcaoCategoria: true })
  c.velha = 'd'.repeat(32)                                                  // o cache aponta para uma "página" que não existe (404)
  const { nt } = montarNotion(w)
  const d = await nt.destinoDe('H1 Editora'); assert.equal(d.estado, 'ok')
  assert.deepEqual(w.chamadasDe('GET', 'pages/').map(x => x.caminho.slice(6, 8)), ['dd', c.pagina_id.slice(0, 2)], 'tentou o velho, invalidou, resolveu de novo')
  assert.equal(w.invalidados.length, 1)
  // id mal formado (caminho, query) nunca é usado em URL
  const w2 = criarMundo(); const c2 = w2.adicionar('Mau'); c2.pagina_id_resolvido = '../databases/xyz?x=1'
  const { nt: nt2 } = montarNotion(w2)
  const d2 = await nt2.destinoDe('Mau'); assert.notEqual(d2.estado, 'ok')
  assert.ok(w2.chamadas.every(x => !x.caminho.includes('..') && !x.caminho.includes('?')), 'nenhuma chamada com id mal formado')
  assert.equal(RX_ID.test('../x'), false)
})

await ok('destinoDe: base posta à mão (relatorio_base:{cliente}) pula página e Informações; PaginaInvalida vira estado', async () => {
  const w = criarMundo(); const c = w.adicionar('Manual', { base: false, secao: 'status', opcaoCategoria: true })
  const { nt, estado } = montarNotion(w)
  assert.equal((await nt.destinoDe('Manual')).estado, 'sem_base')
  estado.set('relatorio_base:Manual', c.ds_id); nt.invalidarCaches(); w.limpar()
  const d = await nt.destinoDe('Manual'); assert.equal(d.estado, 'ok'); assert.equal(d.esquema.secao.tipo, 'status')
  assert.deepEqual(w.chamadas.map(x => x.caminho.slice(0, 13)), ['data_sources/'], 'só o schema')
  const w2 = criarMundo(); w2.adicionar('Lixo').lancaPaginaInvalida = true
  const { nt: nt2 } = montarNotion(w2); assert.equal((await nt2.destinoDe('Lixo')).estado, 'pagina_invalida')
})

await ok('acharPorTitulo / criar / arquivar: corpo EXATO (parent, ícone 🧭, título + categoria + Status na chave exata, blocos), UMA chamada, retry5xx:false', async () => {
  const w = criarMundo(); w.adicionar('Acme', { secao: 'select', opcaoCategoria: false })
  const { nt } = montarNotion(w)
  const d = await nt.destinoDe('Acme'); w.limpar()
  const b = briefSintetico('Acme'), blocos = briefParaBlocos(b)
  assert.deepEqual(await nt.acharPorTitulo(d, b.titulo), [])
  const q = w.chamadas[0]; assert.deepEqual([q.caminho.endsWith('/query'), q.method, q.body], [true, 'POST', { filter: { property: 'Name', title: { equals: b.titulo } }, page_size: 10 }])
  const cat = decidirCategoria(d.esquema), st = decidirStatus(d.esquema)
  const pg = await nt.criar({ destino: d, titulo: b.titulo, blocos, propriedades: { ...cat.propriedades, ...st.propriedades } })
  const posts = w.chamadasDe('POST', 'pages'); assert.equal(posts.length, 1, 'UMA chamada de escrita')
  assert.equal(posts[0].retry5xx, false)
  assert.deepEqual(posts[0].body, { parent: { data_source_id: d.ds }, icon: { type: 'emoji', emoji: '🧭' },
    properties: { Name: { title: [{ type: 'text', text: { content: b.titulo } }] }, 'Secção ': { select: { name: CATEGORIA } }, Status: { select: { name: 'Concluído' } } }, children: blocos })
  assert.ok(RX_ID.test(pg.id) && pg.url.startsWith('https://www.notion.so/'))
  // consulta de novo: acha, ignora arquivadas, mais nova primeiro
  assert.deepEqual((await nt.acharPorTitulo(d, b.titulo)).map(p => p.id), [pg.id])
  await nt.arquivar(pg.id); const arq = w.chamadas.at(-1); assert.deepEqual([arq.method, arq.caminho, arq.body], ['PATCH', `pages/${pg.id}`, { archived: true }])
  assert.deepEqual(await nt.acharPorTitulo(d, b.titulo), [], 'arquivada não conta')
  const adot = await nt.adotar(d, b.titulo); assert.deepEqual(adot, { pagina: null, duplicadas: [] })
  // título proibido: nem chega à rede
  w.limpar()
  for (const t of ['Setembro/26 - Amz', `${CATEGORIA} PlacePlan`]) await assert.rejects(nt.criar({ destino: d, titulo: t, blocos: [] }), e => e.codigo === 'titulo_invalido')
  await assert.rejects(nt.arquivar('../x'), e => e.status === 400)
  assert.equal(w.chamadas.length, 0)
})

await ok('erros do Notion: mapeamento fixo (403/404/400/0/outros), retentável × não, ambíguo só em 5xx/rede; o corpo NUNCA aparece', () => {
  const e = status => Object.assign(new Error(`Notion ${status}: ${SEGREDO}`), { status, corpo: SEGREDO })
  const tab = { 403: ['notion_403', false, false], 404: ['notion_404', false, false], 400: ['notion_400', false, false], 0: ['notion_0', false, false], 429: ['notion_429', true, false], 500: ['notion_500', true, true], 502: ['notion_502', true, true], 401: ['notion_401', false, false] }
  for (const [s, [codigo, retentavel, ambiguo]] of Object.entries(tab)) {
    const c = classificarErro(e(Number(s))); assert.deepEqual([c.codigo, c.retentavel, c.ambiguo], [codigo, retentavel, ambiguo], s)
    assert.ok(!JSON.stringify(c).includes(SEGREDO), 'sem eco')
  }
  assert.equal(classificarErro(e(403)).mensagem, MSG_NOTION[403]); assert.match(MSG_NOTION[403], /permissão para criar páginas na base Informações/)
  assert.equal(classificarErro(e(500)).mensagem, 'Notion indisponível agora — tente de novo')
  assert.equal(classificarErro(e(401)).mensagem, MSG_NOTION[401]); assert.match(MSG_NOTION[401], /token do Notion/)
  const rede = classificarErro(Object.assign(new Error('fetch failed'), { name: 'TimeoutError' })); assert.deepEqual([rede.codigo, rede.retentavel, rede.ambiguo], ['notion_rede', true, true])
  assert.equal(urlDe({ url: 'https://evil.example/x', id: 'a'.repeat(32) }), `https://www.notion.so/${'a'.repeat(32)}`, 'URL fora do Notion não é aceita'); assert.equal(urlDe({}), '')
})

// ── 4. política de envio sobre o plumbing: 5xx → consulta por título (incerto); substituir cria ANTES de arquivar; erros sem eco ─────────────────────
const linhas = linhasEnvio

await ok('criação OK numa chamada só; 5xx COM página criada → NÃO reenvia: consulta por título e adota (incerto=1)', async () => {
  const { w, h, e } = montarEnvio()
  w.falhas.criar.push({ status: 502, cria: true })
  const r = await confirmar(e, 'Acme')
  assert.deepEqual([r.ok, r.estado], [true, 'adotado']); assert.equal(w.criadas(), 1, 'um único POST pages')
  const l = linhas(h); assert.equal(l.length, 1); assert.deepEqual([l[0].estado, l[0].incerto, l[0].motivo], ['adotado', 1, ''])
  assert.match(l[0].page_url, /^https:\/\/www\.notion\.so\//)
  const consultas = w.chamadas.filter(c => c.caminho.endsWith('/query')); assert.ok(consultas.length >= 2, 'consultou por título antes do POST e depois do erro')
  assert.equal(w.chamadas.findIndex(c => c.caminho === 'pages' && c.method === 'POST') < w.chamadas.map(c => c.caminho.endsWith('/query')).lastIndexOf(true), true, 'a consulta pós-erro vem DEPOIS do POST')
})

await ok('5xx SEM página criada → falhou incerto=1, UM POST só; a próxima tentativa começa pela consulta por título e então cria', async () => {
  const { w, h, e } = montarEnvio()
  w.falhas.criar.push({ status: 503, cria: false })
  const r = await confirmar(e, 'Acme')
  assert.deepEqual([r.ok, r.estado, r.motivo, r.retentavel, r.incerto], [false, 'falhou', 'notion_503', true, true]); assert.equal(w.criadas(), 1)
  assert.ok(!JSON.stringify(r).includes(SEGREDO)); assert.equal(r.mensagem, 'Notion indisponível agora — tente de novo')
  const l = linhas(h); assert.deepEqual([l.length, l[0].estado, l[0].incerto, l[0].motivo], [1, 'falhou', 1, 'notion_503'])
  w.limpar()
  const r2 = await confirmar(e, 'Acme'); assert.deepEqual([r2.ok, r2.estado], [true, 'enviado'])
  const iq = w.chamadas.findIndex(c => c.caminho.endsWith('/query')), ip = w.chamadas.findIndex(c => c.caminho === 'pages' && c.method === 'POST')
  assert.ok(iq >= 0 && iq < ip, 'consulta por título ANTES de qualquer POST')
  assert.equal(linhas(h).filter(x => x.estado === 'enviado').length, 1)
})

await ok('erro 403 do Notion: mensagem fixa, não retentável, zero eco no retorno, no log e no banco', async () => {
  const { w, h, e, logs } = montarEnvio()
  w.falhas.criar.push({ status: 403 })
  const r = await confirmar(e, 'Acme')
  assert.deepEqual([r.ok, r.estado, r.motivo, r.retentavel, r.incerto], [false, 'falhou', 'notion_403', false, false]); assert.equal(r.mensagem, MSG_NOTION[403])
  const tudo = JSON.stringify([r, linhas(h), logs]); assert.ok(!tudo.includes(SEGREDO), 'o corpo do Notion não vaza'); assert.ok(logs.some(l => /notion_403/.test(l)))
})

await ok('substituir: cria a página NOVA antes de arquivar a velha (ordem das chamadas), linha antiga vira arquivado, a nova fica viva; falha ao arquivar não perde a nova', async () => {
  const { w, h, e } = montarEnvio()
  const r1 = await confirmar(e, 'Acme'); assert.equal(r1.estado, 'enviado')
  const velha = w.chamadasDe('POST', 'pages').length === 1 && w.paginasVivas(w.cfgCli.get('Acme').ds_id)[0]
  w.limpar()
  const r2 = await confirmar(e, 'Acme', { substituir: true })
  assert.deepEqual([r2.ok, r2.estado], [true, 'substituido']); assert.notEqual(r2.url, r1.url, 'a URL muda')
  const iPost = w.chamadas.findIndex(c => c.method === 'POST' && c.caminho === 'pages'), iPatch = w.chamadas.findIndex(c => c.method === 'PATCH')
  assert.ok(iPost >= 0 && iPatch > iPost, 'POST da nova ANTES do PATCH que arquiva a velha')
  assert.equal(w.chamadas[iPatch].caminho, `pages/${velha.id}`)
  assert.deepEqual(linhas(h).map(x => x.estado), ['arquivado', 'enviado'])
  assert.deepEqual(w.paginasVivas(w.cfgCli.get('Acme').ds_id).map(p => p.url), [r2.url])
  // sem `substituir` o reenvio PULA (nenhuma escrita)
  w.limpar(); const r3 = await confirmar(e, 'Acme'); assert.deepEqual([r3.ok, r3.estado, r3.url], [true, 'ja_enviado', r2.url]); assert.equal(w.criadas(), 0)
  // arquivar falha: a nova foi criada e gravada, o retorno avisa
  w.falhas.arquivar.push({ status: 500 }); w.limpar()
  const r4 = await confirmar(e, 'Acme', { substituir: true }); assert.equal(r4.estado, 'substituido'); assert.match(r4.aviso, /não pôde ser arquivada/)
  assert.equal(linhas(h).filter(x => ['enviado', 'adotado'].includes(x.estado)).length, 1)
})

await ok('adotar: página com o mesmo título já no Notion e nenhuma linha local → adota sem escrever; duplicatas do mesmo título são arquivadas (a mais nova fica)', async () => {
  const { w, h, e } = montarEnvio()
  const ds = w.cfgCli.get('Acme').ds_id, b = briefSintetico('Acme')
  w.paginasDs.get(ds).push({ id: 'e'.padEnd(32, '1'), url: 'https://www.notion.so/' + 'e'.padEnd(32, '1'), titulo: b.titulo, created_time: '2026-10-16T10:00:00.000Z', archived: false },
    { id: 'e'.padEnd(32, '2'), url: 'https://www.notion.so/' + 'e'.padEnd(32, '2'), titulo: b.titulo, created_time: '2026-10-16T11:00:00.000Z', archived: false })
  const r = await confirmar(e, 'Acme'); assert.deepEqual([r.ok, r.estado, r.url], [true, 'adotado', 'https://www.notion.so/' + 'e'.padEnd(32, '2')])
  assert.equal(w.criadas(), 0, 'adotar não escreve páginas novas')
  assert.deepEqual(w.chamadasDe('PATCH').map(c => c.caminho), [`pages/${'e'.padEnd(32, '1')}`], 'a duplicata mais velha foi arquivada')
  assert.deepEqual(linhas(h).map(x => [x.estado, x.incerto]), [['adotado', 0]])
})

const par1 = t => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: rt(t) } })
// ── 4b. correções da revisão adversarial nº 2 (F2) ─────────────────────────────────────────────────────────────
await ok('item 14: confiança sem pct não vira "0/100"; nível com acento (média); pct 0 real continua; nível desconhecido não inventa', () => {
  const com = conf => todoTexto(briefParaBlocos(briefSintetico('A', { extra: { desenvolvimento: { resultados: [{ rotulo: 'Fotos', canal: 'Mercado Livre', quando: '2026-09-30', metrica: { rotulo: 'Faturamento adicional (causa provável)', texto: '+ R$ 1.240' }, selo: 'medido', confianca: conf }], mudancas: [], vazio_mudancas: null } } })))
  assert.match(com({ nivel: 'media', pct: null }), /· Medido · confiança média$/m); assert.ok(!/\(0\/100\)|\/100/.test(com({ nivel: 'media', pct: null })))
  assert.match(com({ nivel: 'média', pct: 72 }), /confiança média \(72\/100\)/); assert.match(com({ nivel: 'alta', pct: 91.4 }), /confiança alta \(91\/100\)/); assert.match(com({ nivel: 'baixa', pct: '' }), /confiança baixa$/m)
  assert.match(com({ nivel: 'baixa', pct: 0 }), /confiança baixa \(0\/100\)/, 'zero REAL é número: aparece')
  assert.ok(!/confiança/.test(com({ nivel: 'xyz', pct: 50 })) && !/confiança/.test(com(null)) && !/media\b/.test(com({ nivel: 'media', pct: 5 })), 'sem nível reconhecido, sem frase de confiança; "media" nunca sai sem acento')
})

await ok('itens 16i e 16j: canal não se repete no título genérico; grupo mostra o fim do período; seção "Resultados ligados a ações"; prazo de ação só aprovada é "previsto"', () => {
  const b = briefSintetico('A', { extra: {
    atividades: { lista: true, concluido: { total: 5, grupos: [{ rotulo: 'Ajuste de rotina — Mercado Livre', canal: 'Mercado Livre', quando: '2026-10-06', n: 1 }, { rotulo: 'Revisão de títulos', canal: 'Mercado Livre', quando: '2026-10-02', fim: '2026-10-06', n: 4 }, { rotulo: 'Fotos novas', canal: 'Shopee', quando: '2026-10-03', fim: '2026-10-03', n: 1 }] },
      andamento: { total: 1, itens: [{ rotulo: 'Ajuste de rotina — Mercado Livre', canal: 'Mercado Livre', previsto: '2026-10-21' }], promocoes: [] } },
    desenvolvimento: { resultados: [{ rotulo: 'Ajuste de rotina — Mercado Livre', canal: 'Mercado Livre', quando: '2026-09-30', metrica: { rotulo: 'Resultado informado pela equipe', texto: '14 pedidos recuperados' }, selo: 'informado', confianca: null }], mudancas: [], vazio_mudancas: null },
    proximos: { itens: [{ quando: '2026-10-21', rotulo: 'Recuperar a caixa de compra em 2 anúncios', origem: 'acao', previsto: true }, { quando: '2026-10-22', rotulo: 'Ficha técnica nova', origem: 'tarefa' }, { quando: '2026-10-23', fim: '2026-10-25', rotulo: 'Fotos', origem: 'acao', previsto: true }], radar: [], agenda: null, vazio: null } } })
  const t = todoTexto(briefParaBlocos(b)).split('\n')
  assert.ok(t.includes('Ajuste de rotina — Mercado Livre · 06/10'), 'genérico + canal repetido: só uma vez'); assert.ok(!t.some(l => /Mercado Livre · Mercado Livre/.test(l)))
  assert.ok(t.includes('Revisão de títulos (x4) · Mercado Livre · 02/10 a 06/10'), 'grupo com fim mostra o período'); assert.ok(t.includes('Fotos novas · Shopee · 03/10'), 'fim igual ao início: uma data só')
  assert.ok(t.includes('Ajuste de rotina — Mercado Livre · previsto 21/10'), 'em andamento: canal não repetido')
  assert.ok(t.some(l => /^Ajuste de rotina — Mercado Livre · 30\/09 — Resultado informado pela equipe: 14 pedidos recuperados · Informado pela equipe$/.test(l)), 'resultado: canal não repetido')
  const bs = briefParaBlocos(b)
  assert.ok(bs.some(x => x.type === 'heading_3' && x.heading_3.rich_text[0].text.content === 'Resultados ligados a ações') && !todoTexto(bs).includes('O que gerou resultado'), 'o título da seção não afirma causa')
  const px = bs.filter(x => x.type === 'table')[1].table.children.map(l => l.table_row.cells.map(c => c[0].text.content))
  assert.deepEqual(px, [['Quando', 'O que vem'], ['Quarta, 21/10 (previsto)', 'Recuperar a caixa de compra em 2 anúncios'], ['Quinta, 22/10', 'Ficha técnica nova'], ['Sexta, 23/10 a 25/10 (previsto)', 'Fotos']], '"previsto" só nas ações aprovadas (tarefa agendada não)')
  assert.deepEqual(auditarBlocos(bs, { nomesInternos: [], permitidos: ['A'] }), [], 'o auditor aceita o conteúdo novo (nenhum radical causal nos títulos fixos)')
})

await ok('item 16l: Secção só casa "Secção/Seção/Secao" exatos; "Sector"/"Seção X"/"Sections" não são a categoria', () => {
  const sec = k => esquemaInformacoes({ T: { type: 'title' }, [k]: { type: 'select', select: { options: [] } } }).secao
  for (const ruim of ['Sector', 'Seção X', 'Sections', 'Secundário', 'Seção do plano']) assert.equal(sec(ruim), null, ruim)
  for (const bom of ['Secção ', 'Seção', 'seccao', ' SECAO ']) assert.ok(sec(bom), bom)
})

await ok('item 16f/16g: 400 do NOSSO payload ≠ "a base mudou"; 401 = token inválido (não retentável); erros internos (destino/id/título) idem; mensagens fixas, sem eco', async () => {
  const e = (status, extra = {}) => Object.assign(new Error(`Notion ${status}: ${SEGREDO}`), { status, ...extra })
  const base = classificarErro(e(400, { corpo: JSON.stringify({ object: 'error', status: 400, code: 'validation_error', message: `Could not find property with name or id: Secção ${SEGREDO}` }) }))
  assert.deepEqual([base.codigo, base.mensagem, base.retentavel, base.ambiguo], ['notion_400', MSG_NOTION[400], false, false], 'propriedade que sumiu = a base mudou')
  const nosso = classificarErro(e(400, { corpo: JSON.stringify({ object: 'error', status: 400, code: 'validation_error', message: `body failed validation: body.children[3].callout.rich_text[0].text.content.length should be ≤ 2000, instead was 2300. ${SEGREDO}` }) }))
  assert.deepEqual([nosso.codigo, nosso.mensagem, nosso.retentavel, nosso.ambiguo], ['notion_payload', MSG_NOTION.payload, false, false]); assert.ok(!/base mudou/.test(nosso.mensagem))
  assert.equal(classificarErro(e(400, { corpo: JSON.stringify({ code: 'invalid_json', message: SEGREDO }) })).codigo, 'notion_payload')
  assert.equal(classificarErro(e(400, { corpo: 'texto cru qualquer' })).codigo, 'notion_400', 'sem pista de payload, mantém a mensagem da base')
  for (const codigo of ['destino_invalido', 'id_invalido', 'titulo_invalido', 'categoria_ausente']) { const c = classificarErro(Object.assign(new Error(SEGREDO), { codigo, status: 400 })); assert.deepEqual([c.codigo, c.retentavel, c.ambiguo, c.mensagem], ['notion_payload', false, false, MSG_NOTION.payload], codigo) }
  const c401 = classificarErro(e(401)); assert.deepEqual([c401.codigo, c401.retentavel, c401.ambiguo, c401.mensagem], ['notion_401', false, false, MSG_NOTION[401]])
  assert.deepEqual(Object.keys(MSG_POR_CODIGO).sort(), ['notion_0', 'notion_400', 'notion_401', 'notion_403', 'notion_404', 'notion_payload'])
  for (const m of [...Object.values(MSG_NOTION), ...Object.values(MSG_POR_CODIGO)]) assert.ok(!m.includes(SEGREDO))
  assert.ok(![base, nosso, c401].some(c => JSON.stringify(c).includes(SEGREDO)), 'sem eco do corpo')
  // acharPorTitulo / arquivar com destino ou id malformado: erro NOSSO, não "a base mudou"
  const w = criarMundo(); w.adicionar('Acme', { secao: 'select', opcaoCategoria: true }); const { nt } = montarNotion(w); const d = await nt.destinoDe('Acme')
  const r1 = await nt.acharPorTitulo({ ...d, ds: '../x' }, 'T').catch(x => x); assert.equal(classificarErro(r1).codigo, 'notion_payload'); assert.equal(classificarErro(r1).mensagem, MSG_NOTION.payload)
  const r2 = await nt.arquivar('../x').catch(x => x); assert.equal(classificarErro(r2).codigo, 'notion_payload')
  assert.equal(w.chamadas.filter(c => c.caminho.includes('..')).length, 0, 'nenhuma chamada com id malformado')
})

await ok('item 16a: o desvio manual (`relatorio_base:`) também confere destino compartilhado, por data source (outro cliente com o mesmo desvio, ou já resolvido para essa base)', async () => {
  const w = criarMundo(); const a = w.adicionar('Alfa', { secao: 'select', opcaoCategoria: true }); w.adicionar('Beta', { secao: 'select', opcaoCategoria: true }); w.adicionar('Gama', { secao: 'select', opcaoCategoria: true })
  const { nt, estado } = montarNotion(w)
  estado.set('relatorio_base:Alfa', a.ds_id)
  assert.equal((await nt.destinoDe('Alfa')).estado, 'ok', 'sozinho, o desvio manual vale')
  estado.set('relatorio_base:Beta', a.ds_id); nt.invalidarCaches()
  const dA = await nt.destinoDe('Alfa'), dB = await nt.destinoDe('Beta')
  assert.deepEqual([dA.estado, dA.compartilhado, dB.estado, dB.compartilhado], ['destino_compartilhado', ['Beta'], 'destino_compartilhado', ['Alfa']]); assert.ok(dA.ds && dA.esquema, 'traz o destino (o líder pode confirmar)')
  // Gama resolve normalmente para a SUA base; um desvio manual de Delta apontando para a base de Gama colide por data source
  const g = w.cfgCli.get('Gama'); w.adicionar('Delta', { secao: 'select', opcaoCategoria: true })
  nt.invalidarCaches(); estado.set('relatorio_base:Alfa', ''); estado.set('relatorio_base:Beta', '')
  assert.equal((await nt.destinoDe('Gama')).ds, g.ds_id)
  estado.set('relatorio_base:Delta', g.ds_id)
  const dD = await nt.destinoDe('Delta'); assert.deepEqual([dD.estado, dD.compartilhado], ['destino_compartilhado', ['Gama']])
})

await ok('item 16b: `forcar`/"Verificar bases" e o envio confirmado limpam o cache do esquema (10 min)', async () => {
  const w = criarMundo(); w.adicionar('Acme', { secao: 'select', opcaoCategoria: false }); const { nt } = montarNotion(w)
  const gets = () => w.chamadasDe('GET', 'data_sources/').length
  const d = await nt.destinoDe('Acme'); await nt.destinoDe('Acme'); assert.equal(gets(), 1, 'cache')
  await nt.destinoDe('Acme', { forcar: true }); assert.equal(gets(), 2, 'forcar relê o esquema'); await nt.destinoDe('Acme'); assert.equal(gets(), 2)
  await nt.destinoDe('Acme', { reescanear: true }); assert.equal(gets(), 3, '"Verificar bases" também')
  await nt.criar({ destino: d, titulo: briefSintetico('Acme').titulo, blocos: [], propriedades: {} }); await nt.destinoDe('Acme'); assert.equal(gets(), 4, 'depois de criar, o esquema é lido de novo (o Notion pode ter criado a opção de Secção)')
  await assert.rejects(nt.criar({ destino: d, titulo: 'Título ruim', blocos: [] }), e => e.codigo === 'titulo_invalido')
})

await ok('item 17: parâmetros aditivos — decidirCategoria({categoria}), decidirStatus({preferidos}), tituloAlertaOk, criar({validarTitulo,icone,categoria,statusPreferido}); defaults idênticos ao relatório', async () => {
  const E = o => esquemaInformacoes(propsInformacoes(o))
  // categoria própria (o alerta usa uma existente; a do relatório segue o padrão)
  assert.deepEqual(decidirCategoria(E({ secao: 'select', opcaoCategoria: true })).propriedades, { 'Secção ': { select: { name: CATEGORIA } } })
  let c = decidirCategoria(E({ secao: 'select', opcaoCategoria: true }), { categoria: 'Plano de Ação' }); assert.deepEqual([c.estado, c.propriedades], ['ok', { 'Secção ': { select: { name: 'Plano de Ação' } } }])
  c = decidirCategoria(E({ secao: 'status', opcaoCategoria: false }), { categoria: 'Alertas' }); assert.deepEqual([c.estado, c.bloqueia], ['opcao_ausente_status', true]); assert.ok(c.aviso.includes('«Alertas»') && !c.aviso.includes(CATEGORIA))
  c = decidirCategoria(E({ secao: 'select', opcaoCategoria: false }), { categoria: 'Alertas' }); assert.deepEqual([c.estado, c.propriedades], ['select_cria', { 'Secção ': { select: { name: 'Alertas' } } }])
  // Status preferido (Pendente/Em andamento para o alerta aberto; Concluído para a resolução)
  const sts = esquemaInformacoes({ N: { type: 'title' }, Status: { type: 'select', select: { options: [{ name: 'Em Andamento' }, { name: 'Concluído' }] } } })
  assert.deepEqual(decidirStatus(sts).propriedades, { Status: { select: { name: 'Concluído' } } })
  assert.deepEqual(decidirStatus(sts, { preferidos: ['pendente', 'em andamento'] }).propriedades, { Status: { select: { name: 'Em Andamento' } } }, 'primeira preferida que EXISTE; grafia da base')
  assert.deepEqual(decidirStatus(E({ concluido: true }), { preferidos: ['pendente', 'em andamento'] }).propriedades, { Status: { select: { name: 'Pendente' } } })
  const nada = decidirStatus(sts, { preferidos: ['pendente'] }); assert.deepEqual(nada.propriedades, {}); assert.match(nada.aviso, /não tem a opção «Pendente»/)
  // título do alerta
  assert.ok(tituloAlertaOk(`${PREFIXO_ALERTA}Estoque dos produtos que mais vendem · 16/10/2026`)); assert.equal(PREFIXO_ALERTA, 'Alerta Place2u · ')
  for (const ruim of ['Alerta Place2u · ', 'Alerta Place2u - x', `${CATEGORIA} · 02/10 a 08/10/2026`, `${PREFIXO_ALERTA}x\ny`, `${PREFIXO_ALERTA}${'x'.repeat(200)}`, `${PREFIXO_ALERTA}PlacePlan`, '', null]) assert.equal(tituloAlertaOk(ruim), false, String(ruim))
  assert.equal(tituloOk(`${PREFIXO_ALERTA}Estoque`), false, 'o título do alerta não vale como título do relatório')
  const { parseTituloPlano } = await import('../src/lib/plano-informacoes.js'); assert.equal(parseTituloPlano(`${PREFIXO_ALERTA}Estoque · 16/10/2026`), null)
  // criar com os parâmetros do alerta: ícone, título, categoria e Status vindos do esquema; sem eles, o corpo é o do relatório (testado acima)
  const w = criarMundo(); w.adicionar('Acme', { secao: 'select', opcaoCategoria: true }); const { nt } = montarNotion(w); const d = await nt.destinoDe('Acme'); w.limpar()
  const tit = `${PREFIXO_ALERTA}Estoque · 16/10/2026`
  await assert.rejects(nt.criar({ destino: d, titulo: tit, blocos: [] }), e => e.codigo === 'titulo_invalido', 'o validador padrão é o do relatório')
  await nt.criar({ destino: d, titulo: tit, blocos: [par1('x')], validarTitulo: tituloAlertaOk, icone: '⚠️', categoria: 'Plano de Ação', statusPreferido: ['pendente', 'em andamento'] })
  assert.deepEqual(w.chamadasDe('POST', 'pages').at(-1).body, { parent: { data_source_id: d.ds }, icon: { type: 'emoji', emoji: '⚠️' },
    properties: { Name: { title: [{ type: 'text', text: { content: tit } }] }, 'Secção ': { select: { name: 'Plano de Ação' } }, Status: { select: { name: 'Pendente' } } }, children: [par1('x')] })
  const w2 = criarMundo(); w2.adicionar('Beta', { secao: 'status', opcaoCategoria: false }); const { nt: nt2 } = montarNotion(w2); const d2 = await nt2.destinoDe('Beta')
  await assert.rejects(nt2.criar({ destino: d2, titulo: tit, blocos: [], validarTitulo: tituloAlertaOk, categoria: 'Alertas' }), e => e.codigo === 'categoria_ausente', 'Secção do tipo status sem a opção: não cria; classificarErro trata como erro nosso')
  assert.equal(w2.criadas(), 0)
})

await ok('item 17: atualizarStatus(pageId, nome) — PATCH do Status só quando a opção existe; nunca cria opção; id malformado nem chega à rede', async () => {
  const w = criarMundo(); w.adicionar('Acme', { secao: 'select', opcaoCategoria: true }); const { nt } = montarNotion(w)
  const d = await nt.destinoDe('Acme'); const pg = await nt.criar({ destino: d, titulo: briefSintetico('Acme').titulo, blocos: [], propriedades: {} })
  const orig = w.notion.req
  w.notion.req = async (cam, o = {}) => (o.method || 'GET') === 'GET' && cam === `pages/${pg.id}` ? { object: 'page', id: pg.id, parent: { type: 'data_source_id', data_source_id: d.ds } } : orig(cam, o)   // o stub do mundo só serve páginas de cliente
  w.limpar()
  const r = await nt.atualizarStatus(pg.id, 'Concluído'); assert.deepEqual([r.ok, r.status], [true, 'Concluído'])
  const patch = w.chamadasDe('PATCH')[0]; assert.deepEqual([patch.caminho, patch.body], [`pages/${pg.id}`, { properties: { Status: { select: { name: 'Concluído' } } } }])
  assert.deepEqual(await nt.atualizarStatus(pg.id, 'concluido'), { ok: true, status: 'Concluído' }, 'casa sem acento/caixa e usa a grafia da base')
  w.limpar(); assert.deepEqual(await nt.atualizarStatus(pg.id, 'Arquivado'), { ok: false, motivo: 'sem_opcao' }); assert.equal(w.chamadasDe('PATCH').length, 0, 'opção que não existe: nada é escrito (e nenhuma é criada)')
  await assert.rejects(nt.atualizarStatus('../x', 'Concluído'), e => e.codigo === 'id_invalido' && classificarErro(e).codigo === 'notion_payload'); assert.ok(!w.chamadas.some(c => c.caminho.includes('..')))
  // página fora de uma data source, base sem coluna Status, erro do Notion: sobem/voltam sem inventar
  w.notion.req = async (cam, o = {}) => (o.method || 'GET') === 'GET' && cam === `pages/${pg.id}` ? { object: 'page', id: pg.id, parent: { type: 'page_id', page_id: 'a'.repeat(32) } } : orig(cam, o)
  assert.deepEqual(await nt.atualizarStatus(pg.id, 'Concluído'), { ok: false, motivo: 'sem_destino' })
  const w3 = criarMundo(); w3.adicionar('Sem', { secao: 'select', opcaoCategoria: true, concluido: true }); const { nt: nt3 } = montarNotion(w3); const d3 = await nt3.destinoDe('Sem')
  const origSt = w3.notion.req
  w3.notion.req = async (cam, o = {}) => {
    if ((o.method || 'GET') === 'GET' && cam.startsWith('pages/') && !w3.idPagina.has(cam.slice(6))) return { object: 'page', id: cam.slice(6), parent: { data_source_id: d3.ds } }
    const r = await origSt(cam, o); return cam === `data_sources/${d3.ds}` ? { ...r, properties: { Name: r.properties.Name } } : r      // base sem coluna Status
  }
  nt3.invalidarCaches(); assert.deepEqual(await nt3.atualizarStatus('f'.repeat(32), 'Concluído'), { ok: false, motivo: 'sem_status' })
})

// ── 5. plano-informacoes.js (edições aditivas) e a correção da Secção do PlacePlan — fetch STUBADO (nada de rede), banco em memória ─────────────────────
const { env } = await import('../src/lib/env.js'); env.NOTION_TOKEN = 'token-de-teste-nao-real'
const MUNDO = { paginas: new Map(), bases: new Map(), filhos: new Map(), chamadas: [] }
const H = (pref, k) => (pref + k.toString(16)).padEnd(32, '0')
const P_OK = H('a', 1), P_ARQ = H('a', 2), D_TAREFAS = H('b', 1), D_COMO_PAGINA = H('b', 2), P_PAI = H('a', 3), P_SEMFILHOS = H('a', 4), P_SEM_INFO = H('a', 5), P_5XX = H('a', 6), I_DB = H('c', 1)
MUNDO.paginas.set(P_OK, { object: 'page', id: P_OK }); MUNDO.paginas.set(P_ARQ, { object: 'page', id: P_ARQ, archived: true }); MUNDO.paginas.set(P_PAI, { object: 'page', id: P_PAI })
MUNDO.bases.set(D_TAREFAS, { object: 'database', parent: { type: 'page_id', page_id: P_OK } }); MUNDO.bases.set(D_COMO_PAGINA, { object: 'database', parent: { type: 'page_id', page_id: P_PAI } })
MUNDO.filhos.set(P_OK, [{ type: 'paragraph', id: 'x1' }, { type: 'child_database', id: I_DB, child_database: { title: 'Informações' } }]); MUNDO.filhos.set(P_SEM_INFO, [{ type: 'paragraph', id: 'x2' }])
globalThis.fetch = async (url, init = {}) => {
  const u = String(url); assert.ok(u.startsWith('https://api.notion.com/v1/'), 'só a API do Notion (stub), nunca rede de verdade')
  const cam = u.slice('https://api.notion.com/v1/'.length).split('?')[0]; MUNDO.chamadas.push(`${init.method || 'GET'} ${cam}`)
  const r = (status, obj) => ({ ok: status < 300, status, json: async () => obj, text: async () => JSON.stringify(obj), headers: { get: () => null } })
  let m
  if ((m = cam.match(/^pages\/(.+)$/))) return MUNDO.paginas.has(m[1]) ? r(200, MUNDO.paginas.get(m[1])) : r(404, { message: 'x' })
  if ((m = cam.match(/^databases\/(.+)$/))) return MUNDO.bases.has(m[1]) ? r(200, MUNDO.bases.get(m[1])) : r(404, { message: 'x' })
  if ((m = cam.match(/^blocks\/(.+)\/children$/))) {
    if (m[1] === P_SEMFILHOS) return r(400, { message: 'Block does not support children' }); if (m[1] === P_5XX) return r(401, { message: 'x' })   // (5xx faria o notion.js esperar 31 s de backoff; qualquer status que não seja 400/404 prova o mesmo)
    return MUNDO.filhos.has(m[1]) ? r(200, { results: MUNDO.filhos.get(m[1]), has_more: false }) : r(404, { message: 'x' })
  }
  return r(500, {})
}
const { db: dbMem, getEstado, setEstado } = await import('../src/lib/db.js')
const PI = await import('../src/lib/plano-informacoes.js')
const { NotionError } = await import('../src/lib/notion.js')
const chamou = f => { MUNDO.chamadas.length = 0; return f().then(r => [r, [...MUNDO.chamadas]]) }

await ok('resolverPaginaCliente: só cacheia id VALIDADO (árvore da API ou GET pages/{id}); lixo do campo cru não é cacheado; id fora do formato nunca vira URL', async () => {
  // base de tarefas → pai (como antes)
  let [pg, ch] = await chamou(() => PI.resolverPaginaCliente({ cliente: 'C1', tarefasDbId: D_TAREFAS, tarefasModo: 'database' }))
  assert.deepEqual([pg, getEstado('pagina_cliente:C1'), ch], [P_OK, P_OK, [`GET databases/${D_TAREFAS}`]])
  ;[pg, ch] = await chamou(() => PI.resolverPaginaCliente({ cliente: 'C1', tarefasDbId: D_TAREFAS })); assert.deepEqual([pg, ch], [P_OK, []], 'cache hit: nenhuma chamada')
  // campo cru = página de verdade: valida e cacheia
  ;[pg, ch] = await chamou(() => PI.resolverPaginaCliente({ cliente: 'C2', paginaClienteId: P_OK })); assert.deepEqual([pg, getEstado('pagina_cliente:C2'), ch], [P_OK, P_OK, [`GET databases/${P_OK}`, `GET pages/${P_OK}`]])
  // campo cru = id de DATABASE (campo trocado): usa o pai
  ;[pg] = await chamou(() => PI.resolverPaginaCliente({ cliente: 'C3', paginaClienteId: D_COMO_PAGINA })); assert.deepEqual([pg, getEstado('pagina_cliente:C3')], [P_PAI, P_PAI])
  // página arquivada, inexistente e id mal formado: null e NADA cacheado
  for (const [cli, id] of [['C4', P_ARQ], ['C5', H('f', 9)], ['C6', '../databases/x?y=1'], ['C7', 'abc']]) {
    ;[pg, ch] = await chamou(() => PI.resolverPaginaCliente({ cliente: cli, paginaClienteId: id })); assert.equal(pg, null, cli); assert.ok(!getEstado(`pagina_cliente:${cli}`), `${cli}: lixo não é cacheado`)
    if (cli >= 'C6') assert.deepEqual(ch, [], 'id mal formado não gera chamada alguma')
  }
  // cache velho com formato inválido é ignorado; forcar:true ignora o cache e regrava
  setEstado('pagina_cliente:C8', 'lixo-antigo'); ;[pg, ch] = await chamou(() => PI.resolverPaginaCliente({ cliente: 'C8', paginaClienteId: P_OK })); assert.equal(pg, P_OK)
  setEstado('pagina_cliente:C9', H('f', 8)); assert.equal(await PI.resolverPaginaCliente({ cliente: 'C9', paginaClienteId: P_OK }), H('f', 8), 'sem forcar, o cache manda')
  ;[pg, ch] = await chamou(() => PI.resolverPaginaCliente({ cliente: 'C9', paginaClienteId: P_OK, forcar: true })); assert.deepEqual([pg, getEstado('pagina_cliente:C9')], [P_OK, P_OK])
  // invalidarCliente: '' conta como miss
  PI.invalidarCliente('C9', P_OK); assert.ok(!getEstado('pagina_cliente:C9')); assert.ok(!getEstado(`info:${P_OK}`))
})

await ok('acharInformacoesDb: acha e cacheia; PADRÃO ttl 0 (sempre reescaneia) e o relatório passa o cache negativo de 6 h (info_vazio), que expira; invalidarCliente zera; página sem filhos = PaginaInvalida (NotionError 400); outros erros continuam NotionError comum', async () => {
  let [id, ch] = await chamou(() => PI.acharInformacoesDb(P_OK)); assert.deepEqual([id, getEstado(`info:${P_OK}`), ch.length], [I_DB, I_DB, 1])
  ;[id, ch] = await chamou(() => PI.acharInformacoesDb(P_OK)); assert.deepEqual([id, ch], [I_DB, []], 'cache positivo')
  ;[id, ch] = await chamou(() => PI.acharInformacoesDb(P_SEM_INFO)); assert.deepEqual([id, ch.length], [null, 1]); assert.ok(getEstado(`info_vazio:${P_SEM_INFO}`), 'grava o cache negativo')
  const SEIS_H = 6 * 3600e3
  ;[id, ch] = await chamou(() => PI.acharInformacoesDb(P_SEM_INFO)); assert.equal(ch.length, 1, 'item 13: o PADRÃO é ttl 0 — PlacePlan e sincronizarPlanos reescaneiam sempre (o cache de 6 h escondia a base recém-criada)')
  ;[id, ch] = await chamou(() => PI.acharInformacoesDb(P_SEM_INFO, { ttlNegativoMs: SEIS_H })); assert.deepEqual([id, ch], [null, []], 'o relatório em lote passa o TTL: dentro de 6 h não reescaneia')
  ;[id, ch] = await chamou(() => PI.acharInformacoesDb(P_SEM_INFO, { ttlNegativoMs: 0 })); assert.equal(ch.length, 1, 'ttl 0 reescaneia')
  setEstado(`info_vazio:${P_SEM_INFO}`, new Date(Date.now() - 7 * 3600e3).toISOString()); ;[id, ch] = await chamou(() => PI.acharInformacoesDb(P_SEM_INFO, { ttlNegativoMs: SEIS_H })); assert.equal(ch.length, 1, 'passadas 6 h, reescaneia')
  setEstado(`info_vazio:${P_SEM_INFO}`, new Date().toISOString()); PI.invalidarCliente('C1', P_SEM_INFO); ;[id, ch] = await chamou(() => PI.acharInformacoesDb(P_SEM_INFO, { ttlNegativoMs: SEIS_H })); assert.equal(ch.length, 1, 'invalidarCliente zera o negativo (getEstado "" = miss)')
  const e400 = await PI.acharInformacoesDb(P_SEMFILHOS).catch(e => e); assert.ok(e400 instanceof PI.PaginaInvalida && e400 instanceof NotionError, 'PaginaInvalida é um NotionError'); assert.deepEqual([e400.name, e400.status], ['PaginaInvalida', 400])
  assert.ok(!getEstado(`info:${P_SEMFILHOS}`) && !getEstado(`info_vazio:${P_SEMFILHOS}`), 'página inválida não vira cache')
  const e404 = await PI.acharInformacoesDb(H('f', 7)).catch(e => e); assert.ok(e404 instanceof PI.PaginaInvalida); assert.equal(e404.status, 404)
  const e5 = await PI.acharInformacoesDb(P_5XX).catch(e => e); assert.ok(e5 instanceof NotionError && !(e5 instanceof PI.PaginaInvalida), 'só 400/404 viram PaginaInvalida'); assert.equal(e5.status, 401)
  assert.equal(typeof PI.parseTituloPlano, 'function'); assert.equal(PI.parseTituloPlano('Setembro/26 - Amz').anoMes, '2026-09')
})

await ok('item 13: sincronizarPlanos e o PlacePlan voltam a REESCANEAR a página mesmo com info_vazio recente (o cache negativo é só do relatório)', async () => {
  MUNDO.paginas.set(P_SEM_INFO, { object: 'page', id: P_SEM_INFO })
  setEstado(`info_vazio:${P_SEM_INFO}`, new Date().toISOString())                   // alguém acabou de ver "sem Informações" (ex.: o relatório em lote)
  const [r, ch] = await chamou(() => PI.sincronizarPlanos({ cliente: 'Cliente Sem Base', paginaClienteId: P_SEM_INFO }))
  assert.equal(r.ok, false); assert.match(r.motivo, /Informações/)
  assert.ok(ch.includes(`GET blocks/${P_SEM_INFO}/children`), `reescaneou a página (chamadas: ${ch.join(', ')})`)
  // quem passa o TTL: só o relatório (relatorio-notion.js); o PlacePlan chama sem opções
  const { readFileSync } = await import('node:fs'), fonte = arq => readFileSync(new URL(`../src/lib/${arq}`, import.meta.url), 'utf-8')
  assert.match(fonte('relatorio-notion.js'), /acharInformacoesDb\(pagina, \{ ttlNegativoMs: ttlNegativo \}\)/); assert.match(fonte('placeplan.js'), /acharInformacoesDb\(pagina\)/); assert.match(fonte('plano-informacoes.js'), /acharInformacoesDb\(pagina\)/)
})

await ok('PlacePlan (propriedadesPlacePlan): Secção do tipo select OU status é gravada com a opção que JÁ existe; Status só se for select; nunca cria opção; título na chave certa; o comportamento antigo (status) continua', async () => {
  const { propriedadesPlacePlan } = await import('../src/lib/placeplan.js')
  const titulo = 'Outubro/26 ML · PlacePlan'
  const base = (secao, ops, extra = {}) => ({ Name: { type: 'title', title: {} }, Status: { type: 'select', select: { options: [{ name: 'Pendente ' }, { name: 'Em andamento' }] } }, ...(secao ? { 'Secção ': { type: secao, [secao]: { options: ops.map(name => ({ name })) } } } : {}), ...extra })
  // bases criadas por scripts/criar-planos-informacoes.mjs (Secção = select): ANTES a categoria nunca era gravada
  let r = propriedadesPlacePlan(base('select', ['Plano de Ação', 'Outra']), titulo)
  assert.deepEqual(r.properties, { Name: { title: [{ type: 'text', text: { content: titulo } }] }, Status: { select: { name: 'Pendente ' } }, 'Secção ': { select: { name: 'Plano de Ação' } } }); assert.equal(r.tituloProp, 'Name')
  // bases de Secção = status (o caso que já funcionava)
  r = propriedadesPlacePlan(base('status', ['Plano de Ação']), titulo); assert.deepEqual(r.properties['Secção '], { status: { name: 'Plano de Ação' } })
  // só opções que já existem: sem "Plano de Ação"/"Pendente" não grava nada além do título
  r = propriedadesPlacePlan({ Name: { type: 'title' }, Status: { type: 'select', select: { options: [{ name: 'Feito' }] } }, 'Secção ': { type: 'select', select: { options: [{ name: 'Geral' }] } } }, titulo); assert.deepEqual(Object.keys(r.properties), ['Name'])
  // Status do tipo `status` nunca foi escrito pelo PlacePlan (comportamento mantido); Secção ausente = só título/Status
  r = propriedadesPlacePlan(base(null, [], { Status: { type: 'status', status: { options: [{ name: 'Pendente' }] } } }), titulo); assert.deepEqual(Object.keys(r.properties), ['Name'])
  // a categoria do RELATÓRIO não é confundida com a do plano (opção própria, não casa /pendente|plano de acao/)
  r = propriedadesPlacePlan(base('select', [CATEGORIA]), titulo); assert.ok(!('Secção ' in r.properties))
  // montarPlacePlan (puro) continua intocado
  const { montarPlacePlan } = await import('../src/lib/placeplan.js'); assert.ok(montarPlacePlan('__nao_existe__').erro)
})

// ── F4: pendências do cliente EXPLICADAS no relatório curto (contrato de blocos que muda DE PROPÓSITO quando há `alertas`/`depende.pendencias`; sem elas, a sequência de cima não muda) ──
// Pendencia = saída REAL do avaliador (fixtures/pendencias-mundo.mjs); o brief guarda a forma do cliente (pendenciaParaCliente), que é o que briefParaBlocos recebe.
const PENDENCIAS = montarPend({
  base: baseMl([itemMl({ titulo: 'Guia Unificada Adestramento Coleira', cobertura: 3, r: 2800 }), itemMl({ titulo: 'Petisco Natural', curva: 'B', cobertura: 6, r: 700 })]),
  tarefas: [tarefaDep({ processo: 'Amazon 1', tipo: 'documentos', dias: 20 }), tarefaDep({ processo: 'Shopee', tipo: 'fotos', dias: 9 }), tarefaDep({ processo: 'Shopee', dias: 31, desde_origem: 'ultima_edicao' })],
}).p.avaliar('Acme', { hoje: '2026-10-08' }).itens
const ENTRADAS = PENDENCIAS.map(pendenciaParaCliente)
const alertaDe = c => ({ rotulo: c.rotulo, canal_rotulo: c.canal_rotulo, desde: c.desde, dias: c.dias, desde_aproximado: c.desde_aproximado, resumo: c.desde ? '' : 'Leitura de estoque de 08/10: 2 dos produtos que mais vendem têm estoque para 3 a 6 dia(s).' })
const ALERTAS = ENTRADAS.filter(c => c.gravidade === 'critico').map(alertaDe)
const comPend = (extra = {}, lingua = 'padrao') => briefSintetico('Acme', { extra: { alertas: ALERTAS, depende: { itens: [{ rotulo: 'Fotos do produto: enviar as fotos do kit novo', desde: '2026-10-09', dias: 7 }, { rotulo: 'Repor estoque de 2 anúncios que mais vendem (estoque para menos de 10 dias): Guia Unificada', desde: null, dias: null }], pendencias: ENTRADAS, mais: 0, linguagem: lingua }, ...extra } })

await ok('F4 blocos: com `alertas` entra um callout VERMELHO logo após a abertura e "Depende de você" vira uma caixa âmbar por pendência (sequência nova, ≤ 60 blocos, auditor limpo)', () => {
  const base = tipos(briefParaBlocos(briefSintetico('Acme'))), bs = briefParaBlocos(comPend()), t = tipos(bs)
  const iDep = base.lastIndexOf('callout')
  assert.deepEqual(t, [...base.slice(0, 1), 'callout', ...base.slice(1, iDep), ...Array(ENTRADAS.length).fill('callout'), ...base.slice(iDep + 1)], 'abertura, VERMELHO, ...o resto igual..., N caixas em vez de uma, rodapé')
  assert.ok(bs.length <= 60 && limitesNotion(bs).length === 0)
  assert.equal(bs[0].callout.color, 'green_background'); assert.equal(bs[1].callout.color, 'red_background')
  const txt = b => b.callout.rich_text.map(r => r.text.content).join('')
  assert.equal(txt(bs[1]), 'Pontos que exigem retorno do cliente com prioridade:\n• Estoque dos produtos que mais vendem · Mercado Livre — Leitura de estoque de 08/10: 2 dos produtos que mais vendem têm estoque para 3 a 6 dia(s).\n• Documentos e validação da conta · Amazon · desde 18/09 (20 dias)', 'a sem tipo/aproximada (Retorno pendente) NÃO é alerta')
  assert.equal(bs[1].callout.rich_text[0].annotations.bold, true)
  const caixas = bs.filter(b => b.type === 'callout' && b.callout.color === 'yellow_background')
  assert.equal(caixas.length, ENTRADAS.length); assert.ok(bs.filter(b => b.type === 'heading_2').some(h => h.heading_2.rich_text[0].text.content === 'Depende de você'))
  const [est, doc, ret, mid] = caixas.map(txt)
  assert.match(est, /^Estoque dos produtos que mais vendem · Mercado Livre\nPor que importa: No Mercado Livre, o anúncio sem estoque é pausado .*\nSe atrasar: Se o estoque acabar antes da reposição, Guia Unificada Adestramento Coleira e Petisco Natural podem ficar sem vender .*\nO que precisamos: Para seguirmos no ritmo combinado, precisamos da confirmação do estoque atual .*\nImpacto possível: R\$ 2\.175 \(estimativa\)\. Premissa: receita por dia medida nos últimos 28 dias .*não promessa de resultado\.\nO que fazemos quando recebermos: .*$/s)
  assert.match(ret, /^Retorno pendente do cliente · Shopee · em aberto; data aproximada: 07\/09\nPor que importa: .*\nSe atrasar: .*\nO que precisamos: .*\nImpacto não estimado: 1 tarefa\(s\) parada\(s\)\nO que fazemos quando recebermos: .*$/s)
  assert.match(doc, /Documentos e validação da conta · Amazon · desde 18\/09 \(20 dias\)\n/); assert.match(mid, /Imagens e vídeo dos produtos · Shopee · desde 29\/09 \(9 dias\)/)
  assert.deepEqual(caixas[0].callout.rich_text.filter(r => r.annotations?.bold).map(r => r.text.content), ['Estoque dos produtos que mais vendem'], 'só o rótulo em negrito'); assert.ok(caixas[0].callout.rich_text.filter(r => r.annotations?.italic).every(r => /^\n(Por que importa|Se atrasar|O que precisamos|Impacto possível|O que fazemos quando recebermos): $/.test(r.text.content)))
  // NENHUMA duplicata: com pendências, a tarefa e o estoque de `itens` não voltam
  const t2 = todoTexto(bs)
  assert.ok(!t2.includes('enviar as fotos do kit novo') && !t2.includes('Repor estoque de 2 anúncios') && !/^•? ?Fotos do produto/m.test(t2), 'itens não se repetem'); assert.equal((t2.match(/Estoque dos produtos que mais vendem/g) || []).length, 2, 'uma no alerta e uma na caixa — nunca três')
  assert.deepEqual(auditarBlocos(bs, { nomesInternos: ['Giovanna Torres', 'Carla Souza'], permitidos: ['Acme'] }), [], 'o que o conversor gera passa no auditor')
})

await ok('F4 blocos: callout vermelho SÓ com crítica; sem pendências o "Depende de você" é o de antes (caixa única da lista); `mais` vira uma linha; linguagem muda só o rótulo das linhas', () => {
  const info = ENTRADAS.filter(c => c.gravidade === 'info'), semCritica = briefParaBlocos(comPend({ alertas: [], depende: { itens: [], pendencias: info, mais: 0, linguagem: 'padrao' } }))
  assert.ok(!semCritica.some(b => b.type === 'callout' && b.callout.color === 'red_background'), 'sem crítica, sem vermelho'); assert.equal(semCritica.filter(b => b.type === 'callout' && b.callout.color === 'yellow_background').length, 1)
  assert.ok(!briefParaBlocos(briefSintetico('Acme')).some(b => b.type === 'callout' && b.callout.color === 'red_background'), 'brief de antes: nenhum vermelho')
  for (const vazio of [{ alertas: undefined }, { alertas: null }, { alertas: [{}, null] }]) assert.equal(briefParaBlocos(briefSintetico('Acme', { extra: vazio })).filter(b => b.callout?.color === 'red_background').length, 0)
  const antes = briefParaBlocos(briefSintetico('Acme')), semLista = briefParaBlocos(briefSintetico('Acme', { extra: { depende: { itens: briefSintetico('Acme').depende.itens, pendencias: [], mais: 0, linguagem: 'padrao' } } }))
  assert.deepEqual(semLista, antes, 'pendencias vazias = bloco idêntico ao de antes')
  const mais = todoTexto(briefParaBlocos(comPend({ depende: { itens: [], pendencias: ENTRADAS, mais: 3, linguagem: 'padrao' } }))), um = todoTexto(briefParaBlocos(comPend({ depende: { itens: [], pendencias: ENTRADAS, mais: 1, linguagem: 'padrao' } })))
  assert.ok(mais.includes('Mais 3 pontos também aguardam o seu retorno.') && um.includes('Mais 1 ponto também aguarda o seu retorno.')); assert.ok(!todoTexto(briefParaBlocos(comPend())).includes('também aguard'))
  const simples = todoTexto(briefParaBlocos(comPend({}, 'simples'))), tec = todoTexto(briefParaBlocos(comPend({}, 'tecnica')))
  assert.ok(simples.includes('Por que isso importa: ') && simples.includes('O que precisamos de você: ') && simples.includes('Quanto pode impactar: R$ 2.175 (estimativa)') && simples.includes('Impacto não estimado: 1 tarefa(s)'))
  assert.ok(tec.includes('Por que importa: ') && !tec.includes('Por que isso importa') && !tec.includes('Base'), 'técnica = rótulos padrão (a premissa já traz os números)')
  assert.equal(todoTexto(briefParaBlocos(comPend({}, 'inexistente'))), todoTexto(briefParaBlocos(comPend({}, 'padrao'))), 'linguagem desconhecida cai no padrão')
})

await ok('F4 blocos: pior caso com 5 pendências, alertas e "mais" fica em ≤ 60 blocos de topo; entrada torta não vira "undefined"/"NaN"/zero', () => {
  const mx = comPend({
    atividades: { lista: true, concluido: { total: 99, grupos: Array.from({ length: 30 }, (_, i) => ({ rotulo: `a${i}`, canal: 'ML', quando: '03/10', n: 1 })) }, andamento: { total: 30, itens: Array.from({ length: 30 }, (_, i) => ({ rotulo: `b${i}` })), promocoes: Array.from({ length: 30 }, (_, i) => ({ rotulo: `p${i}`, ate: '2026-10-20' })) } },
    desenvolvimento: { resultados: Array.from({ length: 30 }, (_, i) => ({ rotulo: `r${i}`, selo: 'medido', metrica: { rotulo: 'm', texto: 't' } })), mudancas: Array.from({ length: 30 }, (_, i) => ({ quando: '03/10', texto: `m${i}` })) },
    proximos: { itens: Array.from({ length: 30 }, (_, i) => ({ quando: '2026-10-21', rotulo: `i${i}` })), radar: Array.from({ length: 30 }, (_, i) => ({ quando: '2026-11-02', rotulo: `r${i}` })), agenda: { p7: 1, p8_14: 1 } },
    alertas: Array.from({ length: 9 }, (_, i) => ({ ...ALERTAS[i % ALERTAS.length], rotulo: `Crítico ${i}` })), depende: { itens: [], pendencias: Array.from({ length: 9 }, (_, i) => ({ ...ENTRADAS[i % ENTRADAS.length], rotulo: `Pendência ${i}` })), mais: 4, linguagem: 'padrao' }, rodape: Array.from({ length: 30 }, (_, i) => `rodapé ${i}`) })
  const bs = briefParaBlocos(mx)
  assert.ok(bs.length <= 60, `pior caso com ${bs.length} blocos`); assert.deepEqual(limitesNotion(bs), [])
  assert.equal(bs.filter(b => b.type === 'callout' && b.callout.color === 'yellow_background').length, 5, 'teto de 5 caixas'); assert.equal(todoTexto(bs).match(/• Crítico \d/g).length, 5, 'teto de 5 linhas de alerta')
  const torto = briefParaBlocos(briefSintetico('A', { extra: { alertas: [{ rotulo: 'X', canal_rotulo: undefined, desde: 'não-é-data', dias: NaN, resumo: null }, null],
    depende: { itens: [], pendencias: [{ rotulo: 'Y', canal_rotulo: null, desde: undefined, dias: undefined, gravidade: 'critico', por_que_importa: undefined, efeito_se_atrasar: null, o_que_precisamos: 'precisa', impacto_texto: undefined, impacto_tipo: undefined }, null, {}], mais: NaN } } }))
  const j = JSON.stringify(torto); assert.ok(!/\bundefined\b|\bNaN\b|\[object|\bnull\b/.test(j.replace(/"color":/g, '')), 'sem lixo'); assert.deepEqual(limitesNotion(torto), [])
  assert.ok(!/R\$ ?0\b/.test(todoTexto(torto)))
})

await ok('política de tom: com data aproximada nada leva contagem de dias (quando, alerta, caixa, lista de antes, fato); com data real segue "desde dd/mm (N dias)"', () => {
  assert.equal(quandoDe({ desde: '2026-06-02', dias: 128, desde_aproximado: true }), 'em aberto; data aproximada: 02/06')
  assert.deepEqual([quandoDe({ desde: '2026-06-02', dias: 128 }), quandoDe({ desde: '2026-06-02', dias: 1 }), quandoDe({ desde: '2026-06-02' }), quandoDe({ desde: null, dias: 3, desde_aproximado: true }), quandoDe(null)], ['desde 02/06 (128 dias)', 'desde 02/06 (1 dia)', 'desde 02/06', '', ''])
  assert.equal(fatoAproximado(4, '2026-06-02'), '4 tarefas aguardam o retorno do cliente (em aberto; data aproximada: 02/06).'); assert.equal(fatoAproximado(1, null), '1 tarefa aguarda o retorno do cliente (em aberto).'); assert.equal(fatoAproximado(0, null), 'Há pontos aguardando o retorno do cliente (em aberto).')
  const interna = { desde_aproximado: true, tarefas: 2, desde: '2026-06-02', evidencia: '2 tarefas aguardam o retorno do cliente; a mais antiga desde 02/06/2026 (128 dia(s); data aproximada pela última atualização da tarefa).' }
  assert.equal(fatoParaCliente(interna), '2 tarefas aguardam o retorno do cliente (em aberto; data aproximada: 02/06).', 'aproximada: sempre reconstruído, nunca o texto interno')
  assert.equal(fatoParaCliente({ ...interna, desde_aproximado: false }), interna.evidencia, 'data real: a evidência do avaliador'); assert.equal(fatoParaCliente(null), '')
  const c = pendenciaParaCliente({ ...ENTRADAS[0], desde: '2026-06-02', dias: 128, desde_aproximado: true, impacto: { tipo: 'sem_estimativa', valor_brl: null, rotulo: 'Impacto não estimado: 2 tarefa(s) parada(s)', premissa: null } })
  assert.deepEqual([c.dias, c.desde_aproximado, c.desde], [null, true, '2026-06-02'], 'a forma do cliente não carrega a contagem')
  const bs = briefParaBlocos(briefSintetico('Acme', { extra: { alertas: [{ rotulo: 'Retorno pendente do cliente', canal_rotulo: 'Magalu', desde: '2026-06-02', dias: null, desde_aproximado: true, resumo: '' }],
    depende: { itens: [{ rotulo: 'Cadastro do kit — aguardamos um retorno seu sobre esta tarefa', desde: '2026-10-01', dias: null, desde_aproximado: true }, { rotulo: 'Fotos do produto', desde: '2026-10-02', dias: 6 }], pendencias: [], mais: 0, linguagem: 'padrao' } } }))
  const t = todoTexto(bs)
  assert.ok(t.includes('• Retorno pendente do cliente · Magalu · em aberto; data aproximada: 02/06') && t.includes('• Cadastro do kit — aguardamos um retorno seu sobre esta tarefa · em aberto; data aproximada: 01/10') && t.includes('• Fotos do produto · desde 02/10 (6 dias)'))
  assert.ok(!/\d+ dias?\)?[^•\n]*aproximada|aproximada[^•\n]*\d+ dias?/.test(t))
})

console.log(`\n${n} verificações do plumbing Notion ok.`)
