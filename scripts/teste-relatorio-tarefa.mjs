// Autoteste PURO do plano B (relatorio-tarefa.js): mapa de propriedades do quadro (o mesmo de distribuir-notion), Pamela (ausente/duplicada → aviso),
// resumo da Descrição (≤ limite, auditado), propriedades da tarefa (select cria opção; status só a existente; data; people), título e fábrica com stub mínimo.
// Rodar: node scripts/teste-relatorio-tarefa.mjs
import assert from 'node:assert/strict'
import { mapearPropsQuadro, opcaoExistente, acharResponsavel, resumoDoBrief, montarTarefa, tituloTarefaOk, criarRelatorioTarefa, normQuadro, lerMapeamento } from '../src/lib/relatorio-tarefa.js'
import { lerConfig } from '../src/lib/relatorio-envio.js'
import { CATEGORIA } from '../src/lib/relatorio-seguro.js'
import { briefSintetico, propsQuadro, USUARIOS, PAMELA_ID } from './fixtures/relatorio-mundo.mjs'

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const CFG = lerConfig().fallback_tarefa, MAP = lerMapeamento().propriedades
const B = briefSintetico('Acme')
const quadro = o => { const props = propsQuadro(o); return { props, pm: mapearPropsQuadro(props, MAP), mapeamento: MAP } }

await ok('mapa do quadro: título/Canal/Demandas/Responsável/Descrição/Data pelo config/mapeamento.json; opção existente sem acento/caixa; status também conta na busca de opção', () => {
  const pm = mapearPropsQuadro(propsQuadro(), MAP)
  assert.deepEqual([pm.titulo, pm.data, pm.canal.nome, pm.demanda.nome, pm.resp.nome, pm.desc.nome, pm.tag], ['Tarefas', 'Data', 'Canal', 'Demandas', 'Responsável', 'Descrição', null])
  assert.equal(mapearPropsQuadro(propsQuadro({ canal: 'status' }), MAP).canal, null, 'Canal do tipo status não é select: o mapa (de distribuir-notion) não o pega')
  assert.equal(opcaoExistente(pm.canal, 'geral'), 'Geral'); assert.equal(opcaoExistente(pm.canal, 'Relatório'), null); assert.equal(opcaoExistente(null, 'x'), null)
  assert.equal(opcaoExistente({ nome: 'S', def: { type: 'status', status: { options: [{ name: 'Em Andamento' }] } } }, 'em andamento'), 'Em Andamento')
  assert.equal(normQuadro('Pâmela  Vitória-Silva'), 'pamela vitoria silva')
})

await ok('Pamela: nome inteiro ou primeiro nome, id válido; nenhuma → aviso; duas → aviso; config/equipe.json tem prioridade por ser o primeiro da lista', () => {
  assert.deepEqual(acharResponsavel(USUARIOS, 'Pamela'), { id: PAMELA_ID, nome: 'Pamela Vitoria Barros', aviso: '' })
  assert.deepEqual(acharResponsavel(USUARIOS, 'pâmela'), { id: PAMELA_ID, nome: 'Pamela Vitoria Barros', aviso: '' })
  assert.equal(acharResponsavel(USUARIOS, 'Pamela Vitoria Barros').id, PAMELA_ID)
  const r0 = acharResponsavel([{ id: PAMELA_ID, nome: 'Carla' }], 'Pamela'); assert.equal(r0.id, ''); assert.match(r0.aviso, /«Pamela» sem usuário do Notion/)
  const r2 = acharResponsavel([...USUARIOS, { id: '0a1b2c3d-0000-4000-8000-00000000c0d9', nome: 'Pamela Souza' }], 'Pamela'); assert.equal(r2.id, ''); assert.match(r2.aviso, /Há 2 usuários do Notion chamados «Pamela»/)
  assert.equal(acharResponsavel([{ id: PAMELA_ID, nome: 'Pamela' }, { id: PAMELA_ID, nome: 'Pamela V.' }], 'Pamela').id, PAMELA_ID, 'o mesmo id duas vezes não é duplicata')
  assert.equal(acharResponsavel([{ id: 'não-é-id', nome: 'Pamela' }], 'Pamela').id, '', 'id fora do padrão não entra num people')
  assert.deepEqual(acharResponsavel(USUARIOS, ''), { id: '', aviso: '' })
})

await ok('resumo da Descrição: abertura + Resultados + Concluído + Próximos passos; ≤ limite com corte em espaço e reticências; vazios honestos (nunca zero)', () => {
  const s = resumoDoBrief(B, 1900)
  assert.deepEqual(s.split('\n').map(l => l.split(':')[0]), ['Conta em crescimento. Faturamento +12,4% nos últimos 14 dias (R$ 31.200,00 contra R$ 27.760,00).', 'Resultados', 'Concluído', 'Próximos passos'])
  assert.match(s, /Resultados: Faturamento R\$ 14\.920,00 \(▲ 11,3%\); Pedidos pagos 115 \(▼ 4,2%\); Pedidos cancelados —\./)
  assert.match(s, /Concluído: Novas fotos do kit de jardinagem; Revisão de títulos\./); assert.match(s, /Próximos passos: 21\/10 Novas fotos do kit de jardinagem\./)
  const curto = resumoDoBrief(B, 200); assert.ok(curto.length <= 200 && curto.endsWith('…'), curto)
  const vazio = resumoDoBrief({ abertura: {}, resultados: { disponivel: false, motivo: 'Conta ainda não conectada.' }, atividades: { concluido: { total: 0 } }, proximos: { itens: [] } }, 1900)
  assert.equal(vazio, 'Resultados: Conta ainda não conectada.\nConcluído: nenhuma ação concluída neste período.\nPróximos passos: sem datas futuras confirmadas.')
  assert.equal(resumoDoBrief({ atividades: { concluido: { total: 3 } } }, 1900).split('\n')[1], 'Concluído: 3 ações concluídas.')
  assert.equal(resumoDoBrief(null, 1900).includes('undefined'), false)
})

await ok('montarTarefa: título «Relatório · {título do brief}», Canal/Demanda select (cria a opção), people da Pamela, Descrição auditada, Data = hoje; sem violações', () => {
  const t = montarTarefa({ brief: B, quadro: quadro(), cfg: CFG, usuarios: USUARIOS, hoje: '2026-10-16', nomesInternos: ['Giovanna Torres'], cliente: 'Acme' })
  assert.equal(t.titulo, `Relatório · ${CATEGORIA} · 09/10 a 15/10/2026`); assert.ok(tituloTarefaOk(t.titulo, 'Relatório'))
  assert.deepEqual(t.avisos, []); assert.deepEqual(t.violacoes, [])
  assert.deepEqual(Object.keys(t.propriedades).sort(), ['Canal', 'Data', 'Demandas', 'Descrição', 'Responsável', 'Tarefas'])
  assert.deepEqual(t.propriedades.Canal, { select: { name: 'Geral' } }); assert.deepEqual(t.propriedades.Demandas, { select: { name: 'Relatório' } })
  assert.deepEqual(t.propriedades['Responsável'], { people: [{ id: PAMELA_ID }] }); assert.deepEqual(t.propriedades.Data, { date: { start: '2026-10-16' } })
  assert.equal(t.propriedades['Descrição'].rich_text.map(x => x.text.content).join(''), t.descricao); assert.ok(t.descricao.length <= CFG.descricao_max)
  assert.deepEqual([t.canal, t.demanda, t.responsavel], ['Geral', 'Relatório', 'Pamela Vitoria Barros'])
  const semData = montarTarefa({ brief: B, quadro: quadro(), cfg: CFG, usuarios: USUARIOS, hoje: '', cliente: 'Acme' }); assert.ok(!('Data' in semData.propriedades))
})

await ok('montarTarefa: Canal status sem «Geral» → vazio + aviso (nunca cria opção de status); sem Responsável/Descrição → aviso; Pamela ausente → aviso; nome interno na abertura → violação (bloqueia)', () => {
  const t = montarTarefa({ brief: B, quadro: quadro({ canal: 'status', semResp: true, semDesc: true }), cfg: CFG, usuarios: [], hoje: '2026-10-16', cliente: 'Acme' })
  assert.deepEqual(Object.keys(t.propriedades).sort(), ['Data', 'Demandas', 'Tarefas'])
  assert.deepEqual(t.avisos, ['A coluna «Canal» é do tipo Status e não tem a opção «Geral»: a tarefa nasce sem ela.', 'Responsável «Pamela» sem usuário do Notion identificado: a tarefa nasce sem responsável.', 'O quadro não tem a coluna Responsável (pessoas): a tarefa nasce sem responsável.'])
  const comStatus = montarTarefa({ brief: B, quadro: quadro({ canal: 'status' }), cfg: { ...CFG, canal: 'Mercado Livre' }, usuarios: USUARIOS, hoje: '', cliente: 'Acme' })
  assert.deepEqual(comStatus.propriedades.Canal, { status: { name: 'Mercado Livre' } }, 'status: só a opção que já existe')
  const v = montarTarefa({ brief: { ...B, abertura: { ...B.abertura, frase: 'Giovanna Torres ajustou os preços.' } }, quadro: quadro(), cfg: CFG, usuarios: USUARIOS, hoje: '', nomesInternos: ['Giovanna Torres'], cliente: 'Acme' })
  assert.ok(v.violacoes.some(x => x.codigo === 'analista'), JSON.stringify(v.violacoes))
  const lim = montarTarefa({ brief: B, quadro: quadro(), cfg: { ...CFG, descricao_max: 300 }, usuarios: USUARIOS, hoje: '', cliente: 'Acme' }); assert.ok(lim.descricao.length <= 300 && lim.descricao.endsWith('…'))
  assert.equal(tituloTarefaOk('Relatório · x\ny', 'Relatório'), false); assert.equal(tituloTarefaOk('Outro · x', 'Relatório'), false); assert.equal(tituloTarefaOk('Relatório · ' + 'x'.repeat(200), 'Relatório'), false)
})

await ok('fábrica: quadroDe acha o quadro pela fonte (data_source ou database → data_sources[0]); 404/403 = null; 5xx sobe; sem coluna de título = null; cache 10 min; acharPorTitulo; criar em lotes de 100 com retry5xx:false', async () => {
  const chamadas = [], falhas = []
  const req = async (caminho, o = {}) => {
    chamadas.push({ caminho, method: o.method || 'GET', body: o.body, retry5xx: o.retry5xx })
    const f = falhas.shift(); if (f) throw Object.assign(new Error('Notion ' + f + ' {"message":"SEGREDO"}'), { status: f })
    if (caminho === 'data_sources/' + 'a'.repeat(32)) return { properties: propsQuadro(), url: 'https://www.notion.so/aaa' }
    if (caminho === 'databases/' + 'b'.repeat(32)) return { data_sources: [{ id: 'c'.repeat(32) }] }
    if (caminho === 'data_sources/' + 'c'.repeat(32)) return { properties: propsQuadro() }
    if (caminho === 'data_sources/' + 'd'.repeat(32)) return { properties: { Nome: { type: 'rich_text' } } }
    if (caminho.endsWith('/query')) return { results: [{ id: 'e'.repeat(32), url: 'https://www.notion.so/e', created_time: '2026-10-01', archived: false }, { id: 'f'.repeat(32), created_time: '2026-10-02', archived: true }] }
    if (caminho === 'pages') return { id: '9'.repeat(32), url: 'https://www.notion.so/9' }
    if (caminho.startsWith('blocks/')) return {}
    throw Object.assign(new Error('404'), { status: 404 })
  }
  let t = Date.parse('2026-10-16T20:00:00Z')
  const fontes = async () => [{ cliente: 'A', dbId: 'a'.repeat(32), modo: 'data_source' }, { cliente: 'B', dbId: 'b'.repeat(32), modo: null }, { cliente: 'D', dbId: 'd'.repeat(32), modo: 'data_source' }, { cliente: 'X', dbId: 'x', modo: 'data_source' }]
  const tf = criarRelatorioTarefa({ notion: { req }, fontes, agora: () => new Date(t).toISOString() })
  const qa = await tf.quadroDe('A'); assert.deepEqual([qa.rota, qa.modoDS, qa.id, qa.pm.titulo, qa.url], ['data_sources/' + 'a'.repeat(32), true, 'a'.repeat(32), 'Tarefas', 'https://www.notion.so/aaa'])
  const qb = await tf.quadroDe('B'); assert.equal(qb.rota, 'data_sources/' + 'c'.repeat(32), 'database legado → primeiro data source')
  assert.equal(await tf.quadroDe('D'), null, 'sem coluna de título'); assert.equal(await tf.quadroDe('X'), null, 'dbId inválido'); assert.equal(await tf.quadroDe('Z'), null, 'sem fonte')
  const antes = chamadas.length; await tf.quadroDe('A'); assert.equal(chamadas.length, antes, 'cache'); t += 11 * 60_000; await tf.quadroDe('A'); assert.equal(chamadas.length, antes + 1, 'expirou')
  falhas.push(404); tf.invalidarCaches(); assert.equal(await tf.quadroDe('A'), null); falhas.push(403); tf.invalidarCaches(); assert.equal(await tf.quadroDe('A'), null)
  falhas.push(502); tf.invalidarCaches(); await assert.rejects(() => tf.quadroDe('A'), e => e.status === 502)
  tf.invalidarCaches(); const q = await tf.quadroDe('A')
  const ach = await tf.acharPorTitulo(q, 'Relatório · x'); assert.deepEqual(ach, [{ id: 'e'.repeat(32), url: 'https://www.notion.so/e', created_time: '2026-10-01' }])
  assert.deepEqual(chamadas.at(-1).body, { filter: { property: 'Tarefas', title: { equals: 'Relatório · x' } }, page_size: 10 })
  const blocos = Array.from({ length: 130 }, (_, i) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'b' + i } }] } }))
  const pg = await tf.criar({ quadro: q, tarefa: { titulo: 'Relatório · x', propriedades: { Tarefas: { title: [] } } }, blocos })
  assert.deepEqual(pg, { id: '9'.repeat(32), url: 'https://www.notion.so/9', aviso: '' })
  const post = chamadas.find(c => c.caminho === 'pages'); assert.equal(post.retry5xx, false); assert.equal(post.body.children.length, 100); assert.deepEqual(post.body.parent, { data_source_id: 'a'.repeat(32) })
  const patch = chamadas.find(c => c.caminho.startsWith('blocks/')); assert.deepEqual([patch.caminho, patch.retry5xx, patch.body.children.length], ['blocks/' + '9'.repeat(32) + '/children', false, 30])
  falhas.push(0, 500); const pg2 = await tf.criar({ quadro: q, tarefa: { titulo: 'Relatório · x', propriedades: {} }, blocos }); assert.match(pg2.aviso, /parte do relatório não foi anexada/)
  await assert.rejects(() => tf.criar({ quadro: q, tarefa: { titulo: 'a\nb', propriedades: {} }, blocos: [] }), e => e.codigo === 'titulo_invalido')
})

console.log(`\n${n} verificações do plano B (tarefa) ok.`)
