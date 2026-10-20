// Autoteste do MOTOR para o Place Sprint 90 (fase F1, teste 3 do desenho — a parte "vou fazer"/"fiz" é da F2):
//  (1) montarAcoes com semConsultor nunca devolve as regras de config/algoritmo.json → foco.regras_exigem_consultor, conta omitidas.exige_consultor e as
//      vagas da semana (fila 'esta_semana') continuam cheias com o que o cliente executa ou aplica — o corte é do próprio motor, nunca re-selecionado fora dele;
//  (2) sem a flag o plano é idêntico (mesmos ids, notas, filas); gerarPlanoConta liga a flag só para chave S90;
//  (3) isolamento: tarefa fonte='s90' nunca entra em calcularKpis/listarTarefas/opcoesFiltros, analistaDaConta nem em /api/estado.
// Banco em memória, sem rede. Rodar: node scripts/teste-sprint90-motor.mjs
process.env.PS_DB_MEMORIA = '1'           // ANTES dos imports: db.js abre :memory:
process.env.PS_OFERTAS_MEMORIA = '1'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const { db } = await import('../src/lib/db.js')
const { montarAcoes } = await import('../src/lib/plano-anuncios.js')
const { classificarCurvas, benchmarkConversao, algoritmo } = await import('../src/lib/diagnostico-conta.js')
const { calcularKpis, listarTarefas, opcoesFiltros } = await import('../src/lib/metricas.js')
const { analistaDaConta } = await import('../src/lib/placeplan.js')

const RAIZ = new URL('..', import.meta.url).pathname
const HOJE = '2026-10-05', CHAVE = '[S90] Loja Motor · 0a1b2c3d'
const EXIGE = algoritmo.foco.regras_exigem_consultor
assert.deepEqual(EXIGE, ['duplicacao_estrategica', 'urgencia_oculta', 'concentracao_receita'], 'lista declarada em config/algoritmo.json → foco')
assert.equal(algoritmo.versao, '1.6.0', 'a versão do algoritmo NÃO muda por causa do Sprint 90 (1.6.0 = ponto de reposição com segurança + lead time informado)')
for (const id of EXIGE) assert.ok(algoritmo.regras.some(r => r.id === id), `regra existe: ${id}`)

// fixture no molde de teste-plano-anuncios (diagnóstico sintético)
const item = o => ({ id: 'MLB1', titulo: 'Produto de teste', permalink: 'https://produto.mercadolivre.com.br/MLB-1-x-_JM', thumb: '', preco: 50, estoque: 400, fotos: 8, frete_gratis: true, catalogo: false,
  u: 20, r: 1000, v: 300, u0: 20, r0: 1000, v0: 300, visOk: true, conv: 6.7, vel_dia: 0.71, cobertura: 560, ads: null, ads_ant: null, buy_box: null, logistica: '', avaliacoes: null, ptw: null, ...o })
function diagDe(itens) {
  classificarCurvas(itens, null); const b = benchmarkConversao(itens); classificarCurvas(itens, b?.conv)
  const gmv = itens.reduce((t, i) => t + i.r, 0)
  return { disponivel: true, cliente: CHAVE, hoje: HOJE, periodo: { de: '2026-09-07', ate: '2026-10-04', anterior: { de: '2026-08-10', ate: '2026-09-06' } },
    resumo: { gmv, gmv_anterior: gmv, delta_pct: 0, conversao_conta: b?.conv, velocidade_dia: gmv / 28, baseline_28d: gmv, anuncios_ativos: itens.length, curvas: { A: 1, B: 0, C: 0 } },
    benchmark: b, ads: { custo: 0, receita: 0, roas: null, acos: null, ctr: null, tacos: null, clicks: 0, prints: 0, anterior: { roas: null } }, economia: null, custos_informados: false, itens, janelas: [], pendencias: [], algoritmo_versao: algoritmo.versao, vendas_dia_sem_mudanca: {} }
}
// um campeão com 60% do GMV em queda (duplicação G4 + concentração de receita) e vários anúncios com problemas que o cliente resolve (frete, fotos, conversão)
const itens = () => [
  item({ id: 'MLB900', r: 30000, r0: 48000, u: 300, u0: 480, v: 2400, v0: 4200, conv: 12.5 }),
  ...Array.from({ length: 10 }, (_, k) => item({ id: 'MLB9' + (10 + k), r: 2000 - k * 50, u: 40, v: 900, conv: 4.4, frete_gratis: false, fotos: 2 })),
]
const regra = a => a.regra.replace(/^anuncio_/, '')
const semana = a => a.filter(x => x.dados.fila === 'esta_semana')

// (1) com semConsultor
const normal = montarAcoes(CHAVE, diagDe(itens()), { hoje: HOJE })
const s90 = montarAcoes(CHAVE, diagDe(itens()), { hoje: HOJE, semConsultor: true })
assert.ok(normal.some(a => EXIGE.includes(regra(a))), 'fixture: sem a flag o motor gera regras que exigem consultor')
assert.ok(semana(normal).some(a => EXIGE.includes(regra(a))), 'fixture: sem a flag elas ocupam vaga da semana')
assert.ok(!s90.some(a => EXIGE.includes(regra(a))), 'com semConsultor nenhuma regra que exige consultor nasce')
assert.ok(s90.omitidas.exige_consultor >= 2, 'o que saiu é contado em omitidas.exige_consultor')
assert.equal(normal.omitidas.exige_consultor, undefined, 'sem a flag nada é omitido por consultor')
assert.equal(semana(s90).length, algoritmo.foco.max_acoes_por_cliente_semana, 'as 5 vagas da semana continuam cheias (o motor enche com o que o cliente faz)')
assert.ok(semana(s90).every(a => !a.dados.duplicacao && !a.dados.exige_pesquisa_consultor), 'nada da semana pede briefing ou pesquisa de consultor')
assert.deepEqual(s90.map(a => a.dados.posicao), s90.map((_, k) => k + 1), 'a ordem é a do motor (posição contínua)')

// (2) sem a flag = plano de hoje; gerarPlanoConta liga a flag só para chave S90
const outra = montarAcoes(CHAVE, diagDe(itens()), { hoje: HOJE, semConsultor: false })
assert.deepEqual(outra.map(a => [a.id, a.score, a.dados.fila]), normal.map(a => [a.id, a.score, a.dados.fila]), 'semConsultor:false = plano idêntico')
const fonte = readFileSync(RAIZ + 'src/lib/plano-anuncios.js', 'utf8')
assert.match(fonte, /montarAcoes\(cliente, diag, \{ hoje, retro, semConsultor: ehChaveS90\(cliente\) \}\)/, 'gerarPlanoConta passa semConsultor só para a chave S90')
assert.ok(fonte.indexOf('exigeConsultor.has(s.regra)') < fonte.indexOf('acoes.sort((a, b) => b.score - a.score)'), 'o filtro roda ANTES do corte de foco')

// (3) isolamento das tarefas fonte='s90' (o "fiz" da F2) nos números do time
const ins = db.prepare('INSERT INTO tarefas (id, fonte, cliente, titulo, responsavel, status, prazo, data_conclusao, last_edited) VALUES (?,?,?,?,?,?,?,?,?)')
ins.run('t-time-1', 'ds-A', 'Cliente Time', 'Tarefa do time', 'Ana Oficial', 'concluida', '2026-10-01', '2026-10-01', '2026-10-01T10:00:00.000Z')
ins.run('s90-PS-0a1b2c3d4e', 's90', CHAVE, 'Feito pelo cliente · PS-0a1b2c3d4e', '', 'concluida', '2026-10-02', '2026-10-02', '2026-10-02T10:00:00.000Z')
ins.run('s90-PS-0a1b2c3d4f', 's90', CHAVE, 'Feito pelo cliente', 'Ana Oficial', 'concluida', '2026-10-02', '2026-10-02', '2026-10-02T10:00:00.000Z')
assert.deepEqual(listarTarefas({}).map(t => t.id), ['t-time-1'], 'listarTarefas ignora fonte s90')
assert.equal(listarTarefas({ cliente: CHAVE }).length, 0)
const k = calcularKpis({}); assert.equal(k.sem_responsavel, 0, 'KPI do time não conta o "fiz" sem responsável'); assert.deepEqual([k.planejadas, k.concluidas], [1, 1], 'só a tarefa do time entra em planejadas/concluídas')
assert.ok(!opcoesFiltros().clientes.includes(CHAVE), 'o filtro de clientes do painel executivo não lista a chave S90')
db.prepare("INSERT INTO analistas_oficiais (nome, nome_norm, cargo, atualizado_em) VALUES ('Ana Oficial', 'ana oficial', 'Analista', ?)").run(new Date().toISOString())
assert.equal(analistaDaConta(CHAVE, { hoje: HOJE }).geral, null, 'analista da conta ignora tarefa s90')
ins.run('t-time-2', 'ds-A', CHAVE, 'Tarefa real', 'Ana Oficial', 'concluida', '2026-10-01', '2026-10-01', '2026-10-01T10:00:00.000Z')
assert.equal(analistaDaConta(CHAVE, { hoje: HOJE }).geral?.oficial, 'Ana Oficial', 'controle: a mesma pessoa numa tarefa do time conta')
assert.match(readFileSync(RAIZ + 'src/server.js', 'utf8'), /SELECT COUNT\(\*\) AS n FROM tarefas WHERE arquivada = 0 AND fonte != 's90'/, '/api/estado não conta tarefa s90')
assert.equal(db.prepare('SELECT COUNT(*) n FROM clientes_central WHERE cliente LIKE ?').get('[S90]%').n, 0)
console.log(`✔ sprint90-motor: semConsultor tira ${EXIGE.join('/')} NA GERAÇÃO (${s90.omitidas.exige_consultor} omitida(s), 5 vagas cheias), sem a flag o plano é idêntico, gerarPlanoConta liga só para S90; tarefa s90 fora de KPIs, filtros, analista da conta e /api/estado`)

// A11 (revisão de segurança de 08/10): ações da conta S90 ficam fora dos indicadores internos da liderança
{
  const { padroesDaBase } = await import('../src/lib/merovingio.js')
  const { padroesGlobais } = await import('../src/lib/impacto-tarefas.js')
  const insA = db.prepare(`INSERT INTO acoes_plano (id, cliente, regra, mes, titulo, horizonte, prazo, dados_json, status, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
  insA.run('PS-a11-central', 'Cliente Central A11', 'sem_responsavel', '2026-10', 't', '7d', '2026-10-15', '{}', 'proposta', '2026-10-08', '2026-10-08')
  insA.run('PS-a11-s90', CHAVE, 'sem_responsavel', '2026-10', 't', '7d', '2026-10-15', '{}', 'proposta', '2026-10-08', '2026-10-08')
  const base = padroesDaBase({ hoje: HOJE })
  assert.equal(base.clientes_com_acoes, 1, 'padroesDaBase não conta a conta S90')
  db.prepare("INSERT OR IGNORE INTO meli_serie_item (cliente, item_id, dia) VALUES (?,?,?)").run(CHAVE, 'MLB-a11', '2026-10-01')
  assert.ok(!padroesGlobais({}).clientes.some(c => c.startsWith('[S90]')), 'padroesGlobais ignora a conta S90')
  db.prepare("DELETE FROM acoes_plano WHERE id LIKE 'PS-a11-%'").run()
  console.log('✔ sprint90-motor A11: conta S90 fora de padroesDaBase e padroesGlobais')
}
