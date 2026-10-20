// Autoteste do Merovíngio. O estado agora é lido AO VIVO do banco (revisão adversarial out/2026),
// então o teste SEMEIA tarefas sintéticas em `tarefas` (cliente __merov_teste__, fonte 'teste')
// e limpa no finally — nada toca dados reais nem o Notion.
import assert from 'node:assert/strict'
import { db } from '../src/lib/db.js'
import { lerCliente, padroesDaBase, ESTAGIOS } from '../src/lib/merovingio.js'

const HOJE = '2026-10-05'
const CLI = '__merov_teste__'
const dia = n => { const d = new Date(HOJE + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const reg = (extra = {}) => ({ cliente: CLI, principal: 'Fulano Teste', vencimentos: {}, ...extra })
const plano = () => ({ _gerado_em: HOJE + 'T08:00:00', operacao: {}, fontes: [], ml: null })
const acao = (regra, extra = {}) => ({ id: 'PS-x' + regra, regra, titulo: regra, status: 'proposta', horizonte: '7d', prazo: dia(7), responsavel: '', dados: { impacto: 3, urgencia: 3, confianca: 5, esforco: 2, evidencia_tipo: 'fato' }, ...extra })

const limpar = () => db.prepare('DELETE FROM tarefas WHERE cliente = ?').run(CLI)
let seq = 0
const tarefa = ({ status = 'nao_iniciada', concluidaEm = null, editadaEm = 0, responsavel = 'Fulano Teste' } = {}) =>
  db.prepare(`INSERT INTO tarefas (id, fonte, cliente, titulo, status, responsavel, data_conclusao, last_edited)
    VALUES (?, 'teste', ?, ?, ?, ?, ?, ?)`).run(`merov-${++seq}`, CLI, `tarefa ${seq}`, status, responsavel, concluidaEm || null, dia(editadaEm) + 'T12:00:00.000Z')

limpar()
try {
  // 0) SEM PLANO → sem leitura declarada (nunca "consolidar" sobre zeros) — achado crítico da revisão
  tarefa({})
  let r = lerCliente({ reg: reg(), plano: null, acoes: [], hoje: HOJE })
  assert.equal(r.sem_leitura, true)
  assert.ok(r.motivo.includes('plano'))
  limpar()
  r = lerCliente({ reg: reg(), plano: null, acoes: [], hoje: HOJE })
  assert.ok(r.sem_leitura && r.motivo.includes('base'), 'sem base sincronizada → motivo correto')

  // 1) bloqueio INTERNO domina → DESTRAVAR (dependência do cliente junto não muda a leitura nem infla "bloqueadas");
  //    cadência que SUBIU vira elo de PROJEÇÃO com texto de projeção
  limpar()
  for (let i = 0; i < 6; i++) tarefa({ status: 'bloqueada', editadaEm: -2 })
  for (let i = 0; i < 2; i++) tarefa({ status: 'dependencia_cliente', editadaEm: -20 })
  for (let i = 0; i < 4; i++) tarefa({ status: 'andamento', editadaEm: -1 })
  for (let i = 0; i < 8; i++) tarefa({ status: 'concluida', concluidaEm: dia(-3) })   // c28=8
  for (let i = 0; i < 5; i++) tarefa({ status: 'concluida', concluidaEm: dia(-40) })  // p28=5 (subiu!)
  r = lerCliente({ reg: reg(), plano: plano(), acoes: [acao('bloqueio_interno'), acao('alavanca_ads')], hoje: HOJE })
  assert.equal(r.arquetipo.k, 'destravar')
  assert.equal(r.caminho.jogadas[0].estagio, 'operacao')
  assert.equal(r.cadeia_causal[0].elo, '6 tarefa(s) com impedimento interno', 'dependência do cliente não conta como bloqueada')
  assert.ok(r.arquetipo.tese.startsWith('6 de 10 tarefa(s)'), 'dependência do cliente não conta como aberta')
  assert.ok(r.falsificador.includes('Problemas na tarefa'))
  const eloCad = r.cadeia_causal.find(e => e.elo.includes('cadência'))
  assert.equal(eloCad.tipo, 'projecao')
  assert.ok(eloCad.elo.includes('tende a cair'), 'cadência que subiu não pode ser afirmada como queda')
  assert.ok(r.cadeia_causal.every(e => ['fato', 'hipotese', 'projecao'].includes(e.tipo)))
  assert.ok(r.critica.plano_gerado_em === HOJE, 'idade do plano declarada')

  // 1b) 5 dependências vencidas (14+ dias) e 0 bloqueadas → COBRAR O CLIENTE: a equipe não está travada, a jogada é do consultor
  limpar()
  for (let i = 0; i < 5; i++) tarefa({ status: 'dependencia_cliente', editadaEm: -20 })   // sem registro: "desde" = última edição (20 dias)
  for (let i = 0; i < 4; i++) tarefa({ status: 'andamento', editadaEm: -1 })
  for (let i = 0; i < 3; i++) tarefa({ status: 'concluida', concluidaEm: dia(-3) })
  r = lerCliente({ reg: reg(), plano: plano(), acoes: [acao('bloqueio_cliente')], hoje: HOJE })
  assert.equal(r.arquetipo.k, 'cobrar_cliente')
  assert.ok(r.arquetipo.tese.includes('5 tarefa(s) aguardam retorno do cliente (5 há 14+ dias)'), r.arquetipo.tese)
  assert.equal(r.cadeia_causal[0].tipo, 'fato')
  assert.ok(r.cadeia_causal.some(e => e.elo.includes('playbook §05')))
  assert.ok(r.falsificador.includes('reabrir a tarefa no Notion'))
  assert.equal(r.caminho.jogadas[0].estagio, 'operacao')
  // dependência recente (5 dias) NÃO vence: com 1 vencida só, nenhum padrão casa
  limpar()
  for (let i = 0; i < 2; i++) tarefa({ status: 'dependencia_cliente', editadaEm: -5 })
  for (let i = 0; i < 6; i++) tarefa({ status: 'andamento', editadaEm: -1 })
  for (let i = 0; i < 3; i++) tarefa({ status: 'concluida', concluidaEm: dia(-3) })
  r = lerCliente({ reg: reg(), plano: plano(), acoes: [], hoje: HOJE })
  assert.notEqual(r.arquetipo.k, 'cobrar_cliente')
  assert.notEqual(r.arquetipo.k, 'destravar')

  // 2) sem entrega há 20+ dias → RETOMAR O RITMO (estado lido do banco, não do snapshot)
  limpar()
  for (let i = 0; i < 5; i++) tarefa({ status: 'andamento', editadaEm: -1 })
  tarefa({ status: 'concluida', concluidaEm: dia(-20) })
  r = lerCliente({ reg: reg(), plano: plano(), acoes: [], hoje: HOJE })
  assert.equal(r.arquetipo.k, 'retomar_ritmo')

  // 3) sem consultor → ESTRUTURAR
  limpar()
  for (let i = 0; i < 3; i++) tarefa({ status: 'andamento', editadaEm: -1 })
  tarefa({ status: 'concluida', concluidaEm: dia(-2) })
  r = lerCliente({ reg: reg({ principal: '' }), plano: plano(), acoes: [], hoje: HOJE })
  assert.equal(r.arquetipo.k, 'estruturar')

  // 4) operação sã + 2 alavancas paradas → ACELERAR; Layout SEMPRE antes de Aceleração
  limpar()
  for (let i = 0; i < 3; i++) tarefa({ status: 'andamento', editadaEm: -1 })
  for (let i = 0; i < 6; i++) tarefa({ status: 'concluida', concluidaEm: dia(-i * 4 - 1) })
  r = lerCliente({ reg: reg(), plano: plano(), acoes: [acao('alavanca_ads'), acao('alavanca_otimizacao'), acao('alavanca_ofertas')], hoje: HOJE })
  assert.equal(r.arquetipo.k, 'acelerar')
  const ordem = r.caminho.jogadas.map(j => j.estagio)
  assert.ok(ordem.indexOf('L') < ordem.indexOf('A'), `Layout antes de Aceleração — veio ${ordem}`)

  // 5) tudo são → CONSOLIDAR com tese HONESTA (declara "nenhum padrão crítico casou", não "operação em dia")
  r = lerCliente({ reg: reg(), plano: plano(), acoes: [], hoje: HOJE })
  assert.equal(r.arquetipo.k, 'consolidar')
  assert.ok(r.arquetipo.tese.includes('Nenhum padrão crítico'))
  assert.ok(r.arquetipo.tese.includes('0 bloqueada(s), 0 aguardando o cliente'), 'consolidar declara bloqueadas e aguardando o cliente separados')
  assert.ok(r.falsificador.includes('OPERAÇÃO'))

  // 6) renovação no relógio
  r = lerCliente({ reg: reg({ vencimentos: { ML: dia(15) } }), plano: plano(), acoes: [], hoje: HOJE })
  assert.ok(r.renovacao_no_relogio && r.renovacao_no_relogio.includes('15 dia'))

  // 7) sinal misto NÃO dispara sem base (p28=0) — achado da revisão
  limpar()
  for (let i = 0; i < 4; i++) tarefa({ status: 'concluida', concluidaEm: dia(-10 - i) })  // tudo no mês, nada na semana
  r = lerCliente({ reg: reg(), plano: plano(), acoes: [], hoje: HOJE })
  assert.ok(!r.critica.sinais_mistos.some(a => a.includes('estável') && a.includes('×0')), 'sem base de 28d anteriores não há "mês estável"')

  // 8) jogadas: no máx. 3, cada uma com o porquê; o excedente declarado
  limpar()
  for (let i = 0; i < 6; i++) tarefa({ status: 'bloqueada', editadaEm: -2 })
  for (let i = 0; i < 4; i++) tarefa({ status: 'andamento', editadaEm: -1, responsavel: '' })
  r = lerCliente({ reg: reg({ principal: '' }), plano: plano(),
    acoes: [acao('bloqueio_interno'), acao('bloqueio_cliente'), acao('sem_responsavel'), acao('renovacao'), acao('alavanca_precificacao'), acao('alavanca_otimizacao'), acao('alavanca_ads'), acao('alavanca_acompanhamento')], hoje: HOJE })
  assert.equal(r.caminho.jogadas[0].estagio, 'operacao')
  assert.ok(r.caminho.jogadas[0].acoes.some(a => a.id === 'PS-xbloqueio_interno'), 'bloqueio_interno entra no estágio operação')
  assert.ok(r.caminho.jogadas.length <= 3)
  assert.ok(r.caminho.jogadas.every(j => j.porque_antes.length > 20))
  assert.ok(r.caminho.jogadas_futuras.length >= 1)

  // 8b) ações do plano por ANÚNCIO (anuncio_*) entram na escada pelo TIPO da regra (v1.4.0): Ads = Aceleração, ímã/otimização = Layout, ruptura = Pesquisa e preço —
  //     antes toda anuncio_* caía em Coleta; regra de conta desconhecida continua em 'C'
  r = lerCliente({ reg: reg({ principal: '' }), plano: plano(), acoes: [acao('anuncio_ads_escalar'), acao('anuncio_ima_conversao'), acao('anuncio_estoque_ruptura')], hoje: HOJE })
  const estagioDe = id => r.caminho.jogadas.find(j => j.acoes.some(a => a.id === id))?.estagio
  assert.equal(estagioDe('PS-xanuncio_ads_escalar'), 'A'); assert.equal(estagioDe('PS-xanuncio_ima_conversao'), 'L'); assert.equal(estagioDe('PS-xanuncio_estoque_ruptura'), 'P')
  r = lerCliente({ reg: reg({ principal: '' }), plano: plano(), acoes: [acao('regra_de_conta_inexistente')], hoje: HOJE })
  assert.equal(r.caminho.jogadas[0].estagio, 'C', 'regra de conta não mapeada segue em Coleta')

  // 9) padrões da base: calendario NÃO entra nos sistêmicos (coordenação sazonal, não falha de processo)
  const p = padroesDaBase({ hoje: HOJE })
  assert.ok(p.clientes_com_acoes > 0 && Array.isArray(p.padroes_sistemicos))
  assert.ok(!p.padroes_sistemicos.some(x => x.regra === 'calendario'), 'calendario não é padrão de falha')
  assert.ok(p.sazonalidade && p.sazonalidade.clientes > 0)
  assert.ok(ESTAGIOS.length >= 5)

  // 10) ordem dentro do estágio: o score gravado pelo plano (com o fator do Merovíngio) manda sobre prioridadeAcao; ação sem score usa o fallback
  r = lerCliente({ reg: reg({ principal: '' }), plano: plano(), acoes: [
    acao('anuncio_ads_escalar', { id: 'PS-A', score: 40, dados: { impacto: 5, urgencia: 5, confianca: 5, esforco: 1, prioridade: { p: 'P2' } } }),   // prioridadeAcao = 100, score 40
    acao('anuncio_ads_escalar', { id: 'PS-B', score: 80, dados: { impacto: 1, urgencia: 1, confianca: 1, esforco: 5, prioridade: { p: 'P0' } } }),    // prioridadeAcao = 20, score 80
    acao('anuncio_ads_escalar', { id: 'PS-C' }),                                                                                                        // sem score → fallback (nota 73)
  ], hoje: HOJE })
  const ads = r.caminho.jogadas.find(j => j.estagio === 'A').acoes
  assert.deepEqual(ads.map(a => a.id), ['PS-B', 'PS-C', 'PS-A'], 'score do plano manda; sem score cai no fallback')
  assert.equal(ads[0].p, 'P0'); assert.equal(ads[0].nota, 80); assert.equal(ads[1].nota, 73)

  console.log(`✔ merovingio: sem plano = sem leitura; estado ao vivo; destravar só interno; cobrar_cliente com 5 vencidas; textos honestos (projeção ≠ fato); escada L→A; calendário fora dos sistêmicos; base: ${p.clientes_com_acoes} clientes, ${p.padroes_sistemicos.length} sistêmico(s) reais`)
  console.log('  sistêmicos:', p.padroes_sistemicos.map(s => `${s.regra} ${s.pct}%`).join(' · ') || 'nenhum', '| renovações no relógio:', p.renovacoes_no_relogio.length)
} finally { limpar() }
