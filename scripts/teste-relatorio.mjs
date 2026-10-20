process.env.PS_DB_MEMORIA = '1'            // banco em memória: nunca toca data/db.sqlite
process.env.ANTHROPIC_API_KEY = ''         // resumo determinístico: nenhuma chamada à IA (env.js não sobrescreve o que já está em process.env)
// Autoteste do relatório de sprint com a classe "Dependência do cliente": stat neutro (01), seção 06 à parte (motivo do registro + "desde",
// recuperação do consultor, tag por status), seção 07 (decisões do cliente = dependências do próximo sprint), resumo com frase própria,
// barra do plano e texto da barra no Notion com "N aguardando o cliente". Rodar: node scripts/teste-relatorio.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const { db } = await import('../src/lib/db.js')
const { montarRelatorio } = await import('../src/lib/relatorio.js')
const { renderRelatorio } = await import('../src/lib/render-relatorio.js')
const { barraPlano } = await import('../src/lib/estilo-editorial.js')

let n = 0
const ok = msg => { n++; console.log('✔', msg) }
const C = 'Cliente Teste', AGORA = new Date().toISOString()
const tarefa = (id, sprint, status, o = {}) => db.prepare(`INSERT INTO tarefas (id, fonte, cliente, sprint, titulo, status_raw, status, data_inicio, prazo, data_conclusao, last_edited, bloqueio, responsavel, impacto, url)
  VALUES (@id, 'ds', @cliente, @sprint, @titulo, @status_raw, @status, @data_inicio, @prazo, @data_conclusao, @last_edited, @bloqueio, @responsavel, @impacto, @url)`)
  .run({ id, cliente: C, sprint, titulo: id, status_raw: status, status, data_inicio: sprint === 'Sprint 2026-10' ? '2026-10-01' : '2026-11-01', prazo: null, data_conclusao: null, last_edited: AGORA, bloqueio: '', responsavel: 'Ana', impacto: '', url: `https://notion.so/${id}`, ...o })
const registro = (id, tipo, detalhe, em) => db.prepare('INSERT INTO tarefa_dependencia (tarefa_id, cliente, tipo, detalhe, por, em, notion_ok) VALUES (?,?,?,?,?,?,1)').run(id, C, tipo, detalhe, 'Lia', em)

tarefa('Andamento', 'Sprint 2026-10', 'andamento', { prazo: '2099-01-01' })
tarefa('Bloqueada ERP', 'Sprint 2026-10', 'bloqueada', { prazo: '2026-09-30', bloqueio: 'Falta acesso ao ERP' })          // bloqueada E atrasada: uma linha só
tarefa('Fotos Pet', 'Sprint 2026-10', 'dependencia_cliente', { status_raw: 'Aguardando Devolutiva do Cliente', prazo: '2026-09-25', last_edited: '2026-09-01T10:00:00.000Z' })   // prazo vencido NÃO vira atraso
registro('Fotos Pet', 'fotos', '12 SKUs da linha Pet', '2026-09-20T12:00:00.000Z')
tarefa('Sem registro', 'Sprint 2026-10', 'dependencia_cliente', { status_raw: 'Aguardando Devolutiva do Cliente' })        // marcada direto no Notion: sem motivo, desde = última edição (hoje)
tarefa('Entregue', 'Sprint 2026-10', 'concluida', { data_conclusao: '2026-10-03', impacto: 'Título novo no ar' })
tarefa('Planilha', 'Sprint 2026-11', 'dependencia_cliente', { status_raw: 'Aguardando Devolutiva do Cliente' })
registro('Planilha', 'custos', 'planilha de custos por SKU', '2026-10-05T12:00:00.000Z')
tarefa('Próxima', 'Sprint 2026-11', 'nao_iniciada', { prazo: '2026-11-10' })

const r = await montarRelatorio({ cliente: C, sprint: 'Sprint 2026-10' })
const k = r.kpis
assert.equal(k.planejadas, 3); assert.equal(k.concluidas, 1); assert.equal(k.bloqueadas, 1); assert.equal(k.atrasadas, 1)   // a dependência não é planejada nem atrasada
assert.equal(k.dependencia_cliente, 2); assert.equal(k.dependencia_14d, 1); assert.equal(k.dependencia_14d_exata, 0, 'a data de "Fotos Pet" vem da última edição: aproximada, não sustenta "há 14+ dias" ao cliente')                                                    // só "Fotos Pet" (última edição em 01/09)
ok('KPIs: dependência fora de planejadas/atrasadas; dependencia_cliente=2, 1 há 14+ dias')

assert.deepEqual(r.pendencias.map(p => [p.titulo, p.classe, p.status]), [['Bloqueada ERP', 'bloqueada', 'Bloqueada'], ['Fotos Pet', 'dependencia_cliente', 'Dependência do cliente'], ['Sem registro', 'dependencia_cliente', 'Dependência do cliente']])
const [blo, dep, semReg] = r.pendencias
assert.equal(blo.motivo, 'Falta acesso ao ERP'); assert.equal(blo.recuperacao, '—'); assert.equal(blo.prazo, '2026-09-30')
assert.equal(dep.motivo, 'Fotos do produto: 12 SKUs da linha Pet (em aberto; data aproximada: 01/09)')                                        // o mais antigo vence: última edição (01/09) < registro (20/09) — o mesmo "desde" do stat 01
assert.equal(dep.recuperacao, 'Envio pelo cliente — cobrança do consultor'); assert.equal(dep.prazo, '—'); assert.equal(dep.url, 'https://notion.so/Fotos Pet')
assert.match(semReg.motivo, /^sem motivo registrado — registre pela tela Painel executivo \((?:desde \d\d\/\d\d\/\d{4}|em aberto; data aproximada: \d\d\/\d\d)\)$/)
ok('seção 06: bloqueada uma vez só; dependência com motivo do registro + "desde", recuperação do consultor, prazo "—"; sem registro = motivo honesto')

assert.equal(r.proximo.sprint, 'Sprint 2026-11')
assert.deepEqual(r.proximo.decisoes_cliente, ['Planilha: Custos e preços: planilha de custos por SKU'])
ok('seção 07: decisões necessárias do cliente = dependências do próximo sprint, pelo registro')

assert.equal(r.resumo.origem, 'deterministico')
assert.match(r.resumo.texto, /Pontos de atenção: 1 bloqueada\(s\) e 1 atrasada\(s\)/); assert.match(r.resumo.texto, /2 tarefa\(s\) aguardam retorno do cliente\./)
assert.ok(!/Pontos de atenção:[^.]*cliente/.test(r.resumo.texto), 'a dependência não entra em "Pontos de atenção"')
ok('resumo determinístico: frase própria para a dependência, fora dos pontos de atenção')

assert.equal(r.plano.total, 3); assert.equal(r.plano.dependencia_cliente, 2); assert.equal(r.plano.bloqueadas, 1)
assert.ok(barraPlano(r.plano).includes('<span>2 aguardando o cliente</span>') && !barraPlano({ ...r.plano, dependencia_cliente: 0 }).includes('aguardando o cliente'), 'barra do plano: contagem neutra só quando > 0')
assert.match(readFileSync(new URL('../src/lib/notion-publicar.js', import.meta.url), 'utf-8'), /plano\.dependencia_cliente \? ` · \$\{plano\.dependencia_cliente\} aguardando o cliente` : ''/)
ok('barra do plano (HTML e Notion): "N aguardando o cliente", sem cor de risco')

const h = renderRelatorio(r)
assert.ok(/<div class="num ">2<\/div><div class="lbl">Depende do cliente<\/div>(?!<div class="sub">[^<]*14\+)/.test(h) && !h.includes('há 14+ dias'), 'stat 01 neutro; SEM "M há 14+ dias": a única espera de 14+ dias tem data aproximada (última edição) e o cliente não lê dias dela')
assert.ok(h.includes('<span class="tag t-bloqueada">Bloqueada</span>') && h.includes('<span class="tag t-dependencia_cliente">Dependência do cliente</span>'), 'tag por status, não ternário')
assert.ok(h.includes('Dependências do cliente não contam como atraso da equipe.') && h.includes('Envio pelo cliente — cobrança do consultor') && h.includes('(em aberto; data aproximada: 01/09)') && !h.includes('(desde 01/09/2026)'))
assert.ok(h.includes('Decisões necessárias do cliente</span> &nbsp;Planilha: Custos e preços: planilha de custos por SKU'))
assert.ok(!/undefined|NaN|\[object/.test(h), 'sem lixo de template')
ok('render: stat, tags, subtítulo da seção 06 e decisões do cliente na 07')

// motor-res A7 (08/10/2026): o resumo executivo vai ao CLIENTE → determinístico até revisão da IA; só IA_RESUMO_SPRINT=1 liga a IA. Com chave falsa e fetch stub, sem a env a rede nunca é tocada.
{
  const { resumoExecutivo } = await import('../src/lib/ia.js')
  const { env } = await import('../src/lib/env.js')
  const fetchOrig = globalThis.fetch, chaveOrig = env.ANTHROPIC_API_KEY, logOrig = console.error
  let chamadas = 0
  globalThis.fetch = async () => { chamadas++; throw new Error('rede bloqueada no teste') }
  env.ANTHROPIC_API_KEY = 'sk-falsa-so-para-o-teste'; delete process.env.IA_RESUMO_SPRINT; console.error = () => {}
  try {
    const payload = { contexto: { cliente: C, projeto: 'todos', sprint: 'Sprint 2026-10' }, kpis: r.kpis, entregas: [], riscos: [], proximos: [] }
    const off = await resumoExecutivo({ cliente: C, sprint: 'Sprint 2026-10' }, payload)
    assert.equal(chamadas, 0, 'sem IA_RESUMO_SPRINT a IA nunca é chamada, mesmo com ANTHROPIC_API_KEY')
    assert.equal(off.origem, 'deterministico'); assert.equal(off.motivo, 'ia_ao_cliente_desligada'); assert.match(off.texto, /planejadas 3 tarefas e concluídas 1/)
    assert.equal((await montarRelatorio({ cliente: C, sprint: 'Sprint 2026-10' })).resumo.motivo, 'ia_ao_cliente_desligada', 'o relatório inteiro segue o mesmo caminho'); assert.equal(chamadas, 0)
    process.env.IA_RESUMO_SPRINT = '1'
    const on = await resumoExecutivo({ cliente: C, sprint: 'Sprint 2026-10' }, payload)
    assert.equal(chamadas, 1, 'com o opt-in explícito a IA é tentada'); assert.equal(on.origem, 'deterministico'); assert.match(on.motivo, /IA indisponível/)
  } finally { globalThis.fetch = fetchOrig; env.ANTHROPIC_API_KEY = chaveOrig; delete process.env.IA_RESUMO_SPRINT; console.error = logOrig }
  ok('resumo executivo ao cliente: IA só com IA_RESUMO_SPRINT=1; sem a env, template com motivo ia_ao_cliente_desligada e nenhuma chamada de rede')
}

console.log(`\n${n} grupos de verificação passaram.`)
