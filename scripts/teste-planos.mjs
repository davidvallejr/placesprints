// Autoteste do plano de ação (sem rede, sem escrever no Notion). Rode: node scripts/teste-planos.mjs
import assert from 'node:assert/strict'
import { db } from '../src/lib/db.js'
import { normNome, criarResolvedor, resolverEscopo, clientesElegiveis, lideresEConsultores } from '../src/lib/equipe.js'
import { gerarPlanoCliente, salvarPlano, marcarStatus, lerAcoes, playbook } from '../src/lib/plano-cliente.js'

// nomes: acento/caixa/pontuação; alias explícito; prefixo ≥ 2 palavras; ambíguo NÃO casa
assert.equal(normNome('  Sophia  Custódio '), 'sophia custodio')
const canon = criarResolvedor(['Adriano Lucas', 'Adriano L.', 'Ana Paula', 'Ana Paula Souza', 'Ana Paula Lima', 'Pedro'])
assert.equal(canon('Adriano Lucas'), 'Adriano L.')            // alias do config/equipe.json
assert.notEqual(canon('Pedro'), canon('Ana Paula'))            // 1 palavra nunca vira prefixo
assert.ok(['Ana Paula', 'Ana Paula Souza', 'Ana Paula Lima'].includes(canon('Ana Paula')))

// escopos: total ⊇ squad/consultor; seleção inexistente = erro; nada vaza entre escopos
const total = resolverEscopo({ tipo: 'total' })
assert.ok(total.clientes.length > 0 && total.erro === '')
const { elegiveis } = clientesElegiveis()
assert.equal(total.clientes.length, elegiveis.length)
const um = total.clientes[0]
assert.deepEqual(resolverEscopo({ tipo: 'selecao', clientes: [um] }).clientes, [um])
assert.ok(resolverEscopo({ tipo: 'selecao', clientes: ['__nao_existe__'] }).erro)
const sq = elegiveis.flatMap(c => c.squads)[0]
const dentro = resolverEscopo({ tipo: 'squad', squad: sq }).clientes
assert.ok(dentro.length && dentro.every(c => total.clientes.includes(c)))
assert.equal(resolverEscopo({ tipo: 'squad', squad: '__nenhum__' }).clientes.length, 0)

// motor: ID estável ENTRE MESES (regras de condição), decisão humana sobrevive à virada, sem duplicar
const cli = { cliente: '__teste_plano__', status: 'Ativo', tier: '', nicho: '', canais: ['ML'], consultores: { ML: 'Fulano Teste' }, lideres: { ML: 'Líder Teste' }, principal: 'Fulano Teste', squads: ['Squad Líder Teste'], squadPrincipal: 'Squad Líder Teste', squadDoCanal: () => 'Squad Líder Teste', responsavelDoCanal: () => 'Fulano Teste' }
const limpar = () => { db.prepare("DELETE FROM acoes_plano WHERE cliente = ?").run(cli.cliente); db.prepare('DELETE FROM planos_cliente WHERE cliente = ?').run(cli.cliente); db.prepare('DELETE FROM alinhamento WHERE cliente = ?').run(cli.cliente) }
// descartar exige quem (líder/consultor da central) + motivo da lista (10/10/2026: o descarte vira alinhamento com revisão)
const DESC = { por: lideresEConsultores()[0], motivo_tipo: 'intencional' }
limpar()
try {
  const g1 = gerarPlanoCliente(cli, { hoje: '2026-10-02' }), g2 = gerarPlanoCliente(cli, { hoje: '2026-10-02' })
  assert.deepEqual(g1.acoes.map(a => a.id), g2.acoes.map(a => a.id))
  assert.ok(g1.acoes.every(a => /^PS-[0-9a-f]{10}$/.test(a.id)))
  assert.equal(new Set(g1.acoes.map(a => a.id)).size, g1.acoes.length)
  assert.ok(g1.acoes.every(a => a.dados.evidencia && a.dados.criterio_aceite && ['fato', 'hipotese', 'projecao', 'pendente'].includes(a.dados.evidencia_tipo)))
  assert.ok(g1.acoes.some(a => a.regra === 'calendario'), 'Black Friday/Natal entram na janela de 90 dias')

  // regeneração no MESMO mês: nada duplica, descarte preservado
  const r1 = salvarPlano(g1.plano, g1.acoes)
  assert.equal(r1.novas, g1.acoes.length)
  const alvo = g1.acoes[0].id
  marcarStatus([alvo], 'descartada', DESC)
  const r2 = salvarPlano(g2.plano, g2.acoes)
  assert.equal(r2.novas, 0)
  assert.equal(lerAcoes({ clientes: [cli.cliente] }).length, g1.acoes.length)
  assert.equal(lerAcoes({ clientes: [cli.cliente] }).find(a => a.id === alvo).status, 'descartada')
  marcarStatus([alvo], 'proposta', { por: DESC.por })                     // limpa p/ o teste da virada (reabrir descartada exige quem decide)

  // VIRADA DE MÊS: regra de condição mantém o ID (não duplica no Notion); só a regra mensal troca
  const nov = gerarPlanoCliente(cli, { hoje: '2026-11-02' })
  const idsNov = new Set(nov.acoes.map(a => a.id))
  const bf = g1.acoes.find(a => a.regra === 'calendario' && a.titulo.includes('Black Friday'))
  const natal = g1.acoes.find(a => a.regra === 'calendario' && a.titulo.includes('Natal'))
  const planoOut = g1.acoes.find(a => a.regra === 'sem_plano_mes')
  assert.ok(bf && natal && planoOut)
  assert.ok(idsNov.has(bf.id) && idsNov.has(natal.id), 'calendário mantém o ID entre meses')
  assert.ok(!idsNov.has(planoOut.id), 'plano do mês é por mês (alvo = mês)')
  marcarStatus([bf.id], 'aprovada'); marcarStatus([natal.id], 'descartada', DESC)
  salvarPlano(nov.plano, nov.acoes)                                       // virada
  const st = id => lerAcoes({ clientes: [cli.cliente], status: null }).find(a => a.id === id)?.status
  assert.equal(st(bf.id), 'aprovada', 'aprovada sobrevive à virada com o mesmo ID')
  assert.equal(st(natal.id), 'descartada', 'descartada sobrevive à virada')
  assert.equal(st(planoOut.id), 'obsoleta', 'plano de outubro vira obsoleto quando chega novembro')
  console.log(`✔ plano-cliente: ${g1.acoes.length} ação(ões) sintéticas, IDs estáveis entre meses, decisões preservadas na virada, ${total.clientes.length} clientes no escopo total`)

  // fase 6: conversão SEM limiar universal — referência = benchmark A/B da própria conta; queda = relativa ao período anterior
  const J = playbook.limiares.ml
  assert.equal(J.conversao_minima_pct, undefined); assert.equal(J.queda_conversao_pontos, undefined); assert.ok(J.$premissa && J.conversao_abaixo_benchmark_pct === 25 && J.queda_conversao_rel_pct === 25)
  const per = { faturamento: 10000, vendas: 100, visitas: 5000, parcial: false, vendas_canceladas: 0, valor_cancelado: 0, disponivel: true }
  const mlDe = (convAtual, convAnterior, benchmark) => ({ atual: { ...per, conversao: convAtual }, anterior: { ...per, conversao: convAnterior }, janela_atual: { de: '2026-09-04', ate: '2026-10-01' }, janela_anterior: { de: '2026-08-07', ate: '2026-09-03' }, benchmark })
  const regrasDe = ml => gerarPlanoCliente(cli, { hoje: '2026-10-02', ml }).acoes.map(a => a.regra)
  const semBench = gerarPlanoCliente(cli, { hoje: '2026-10-02', ml: mlDe(0.8, 0.8, null) })
  assert.ok(!semBench.acoes.some(a => a.regra === 'ml_conversao_baixa'), 'sem benchmark da conta a regra não dispara (0,8% não é "baixo" por número universal)')
  assert.ok(semBench.plano.pendencias.some(p => /Referência de conversão da conta \(benchmark A\/B\) ainda não disponível/.test(p.item)))
  const bench = { conv: 2, n: 4, regra: 'taxa agregada dos 4 anúncios curva A/B com ≥ 100 visitas' }
  const comBench = gerarPlanoCliente(cli, { hoje: '2026-10-02', ml: mlDe(1.2, 1.2, bench) })
  const baixa = comBench.acoes.find(a => a.regra === 'ml_conversao_baixa')
  assert.ok(baixa, '1,2% < 2% × 0,75 = 1,5% dispara'); assert.match(baixa.titulo, /própria conta \(1.5%\)/); assert.match(baixa.dados.evidencia, /benchmark 2% da própria conta/); assert.ok(!comBench.plano.pendencias.some(p => /benchmark A\/B/.test(p.item)))
  assert.ok(!regrasDe(mlDe(1.6, 1.6, bench)).includes('ml_conversao_baixa'), '1,6% ≥ 1,5% não dispara')
  assert.ok(!regrasDe(mlDe(0.8, 0.8, null)).includes('ml_queda_conversao'))
  const queda = gerarPlanoCliente(cli, { hoje: '2026-10-02', ml: mlDe(1.4, 2.0, bench) }).acoes.find(a => a.regra === 'ml_queda_conversao')
  assert.ok(queda, 'queda relativa de 30% dispara'); assert.match(queda.titulo, /caiu 30% em 28 dias/); assert.match(queda.dados.evidencia, /-30% relativo/)
  assert.ok(!regrasDe(mlDe(1.7, 2.0, bench)).includes('ml_queda_conversao'), 'queda de 15% (0,3 p.p.) não dispara: nada de p.p. absoluto')
  assert.ok(!regrasDe(mlDe(0.6, 0.9, null)).includes('ml_conversao_baixa') && regrasDe(mlDe(0.6, 0.9, null)).includes('ml_queda_conversao'), 'queda relativa não depende do benchmark; a baixa sim')
  console.log('✔ plano-cliente: conversão baixa só contra o benchmark da própria conta (pendência sem ele); queda relativa ≥ 25%, nunca p.p.')

  // textos de origem (revisão 08/10): plano do mês sem nome interno nos 3 ramos da consulta e sem ecoar o erro bruto dela.
  // backlog_parado e alavanca_* precisam de tarefas semeadas: ficam no teste em memória (scripts/teste-diagnostico-conta-rev.mjs), nunca no banco real
  const INTERNO = /notion|merov[ií]ngio|backlog|\bnull\b/i
  for (const planoStatus of [{ ok: true }, { ok: false, motivo: 'Notion 401: token inválido' }, null]) {
    const a = gerarPlanoCliente(cli, { hoje: '2026-10-02', planoStatus }).acoes.find(x => x.regra === 'sem_plano_mes')
    for (const t of [a.titulo, a.dados.problema, a.dados.acao, a.dados.evidencia]) assert.doesNotMatch(t, INTERNO, t)
    assert.doesNotMatch(a.dados.evidencia, /401|token/)
  }
  console.log('✔ plano-cliente: plano do mês sem nome interno nos 3 ramos da consulta, sem ecoar o erro bruto')
} finally { limpar() }
