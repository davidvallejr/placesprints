// Autoteste da Jornada do cliente (src/lib/jornada.js, puro; 04/11/2026). Sem banco, sem rede: contexto fixo no molde de progresso-real.contextoCliente.
//  (1) cliente novo (nada preenchido): todos os passos pendentes com motivo, próximo passo = 1º da etapa 1, resumo honesto; ML sem canal = nao_se_aplica;
//  (2) cliente completo: passos feitos; chave de envios desligada = desligado (nunca atrasado); carência = aguardando; etapa atrasada pinta o passo pendente de atrasado;
//  (3) todo passo tem id único, etapa 1–10, quem do catálogo, destrava, ação e ir que aponta para /cliente?…&aba= ou rota absoluta; prova nunca lança (ctx vazio).
// Rodar: node scripts/teste-jornada.mjs
const assert = (await import('node:assert/strict')).default
const { montarJornada, PASSOS, QUEM, ESTADOS_PASSO } = await import('../src/lib/jornada.js')
const { progressoCliente, ETAPAS } = await import('../src/lib/progresso-cliente.js')

let n = 0, falhou = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log(`✓ ${nome}`) } catch (e) { falhou++; console.log(`✗ ${nome}\n  ${e.message}`) } }
const AGORA = '2026-11-04T12:00:00.000Z'
const vazio = { cliente: 'Acme', agora: AGORA, hoje: '2026-11-04', hora: '09:00', ativo: true, quadro: false, cs: '', conhecido_desde: '', cadastro: { canais: [], tier: '', nicho: '', consultor_ml: '' },
  ml: { conectado: false, erro: '', conectado_em: '', atualizado_em: '', canal: false }, coleta: { em: '', sync_em: '', lacunas: null }, empresa: { custo_pct: null, custo_motivo: '', lead_time: false, catalogo: null, metas_mes: false, promocoes_coleta: null },
  plano: { diagnostico: 'sem_ml', diagnostico_motivo: 'sem_conexao_ml', gerado_em: '', propostas: 0 }, decisao: { p01_sem_decisao: 0, p01_dias_uteis_max: 0, p01_atrasadas: 0, aprovadas: 0, total: 0 },
  distribuicao: { aprovadas_nao_distribuidas: 0, aprovadas_paradas: 0, aprovadas_dias_max: 0, distribuidas: 0, cards_ps: 0, tarefas: 0 },
  execucao: { cards_ps: 0, cards_abertos: 0, cards_parados: 0, cards_dias_max: 0, ordens: 0, ordens_conferidas: 0, ordens_divergentes: 0, pendencias: 0, pendencias_14: 0, pendencias_30: 0, pendencias_dias_max: 0, chaveiro_ligado: false },
  medicao: { medidas: 0, medicao_em: '', sem_medida: 0, sem_medida_dias_max: 0 },
  comunicacao: { chave_ligada: false, inicio_envios: '', elegivel: false, motivo_inelegivel: 'sem_conexao_ml', liberado: false, recibo_semana: '', relatorio: null, resposta_14d: false, canais_ligados: [] } }

await ok('cliente novo: tudo pendente com motivo, próximo = quadro do Notion, resumo honesto', () => {
  const j = montarJornada({ etapas: progressoCliente(vazio).etapas, ctx: vazio })
  assert.equal(j.etapas.length, 10); assert.equal(j.cliente, 'Acme')
  const todos = j.etapas.flatMap(e => e.passos)
  assert.equal(todos.length, PASSOS.length)
  assert.ok(todos.filter(p => p.estado === 'feito').length === 0, 'nada feito')
  assert.ok(todos.filter(p => p.estado === 'pendente' || p.estado === 'atrasado').every(p => p.motivo), 'pendente sempre com motivo')
  assert.equal(j.proximo.id, 'quadro_notion'); assert.equal(j.proximo.etapa, 1)
  assert.equal(j.resumo.feitos, 0); assert.ok(j.resumo.desligados >= 1, 'chave de envios desligada conta como desligado')
  assert.match(j.etapas[0].passos[1].ir, /^\/cliente\?cliente=Acme&aba=configurar&sec=cad-sec$/)
})

await ok('sem canal ML na central: conexão = não se aplica; etapa atrasada pinta o passo pendente', () => {
  const semMl = { ...vazio, cadastro: { ...vazio.cadastro, canais: ['Shopee'] } }
  const j = montarJornada({ etapas: progressoCliente(semMl).etapas, ctx: semMl })
  assert.equal(j.etapas[1].passos.find(p => p.id === 'ml_conexao').estado, 'nao_se_aplica')
  assert.equal(j.etapas[1].total, 1, 'não se aplica sai da contagem')
  const et = progressoCliente(vazio).etapas.map(e => (e.n === 1 ? { ...e, estado: 'atrasado' } : e))
  const j2 = montarJornada({ etapas: et, ctx: vazio })
  assert.ok(j2.etapas[0].passos.every(p => p.estado === 'atrasado'), 'etapa atrasada → passos pendentes atrasados')
  assert.equal(j2.proximo.estado, 'atrasado')
})

await ok('cliente completo: feitos, desligado ≠ atrasado, aguardando na carência', () => {
  const cheio = { ...vazio, quadro: true, cs: 'Ana', conhecido_desde: '2026-10-01', cadastro: { canais: ['ML', 'Shopee'], tier: 'Performance', nicho: 'Pet', consultor_ml: 'Giovanna' },
    ml: { conectado: true, erro: '', conectado_em: '2026-10-02T10:00:00Z', atualizado_em: AGORA, canal: true }, coleta: { em: '2026-11-04T07:00:00Z', sync_em: '2026-11-04T07:30:00Z', lacunas: 0 },
    empresa: { custo_pct: 92, custo_motivo: '', lead_time: true, catalogo: true, metas_mes: true, promocoes_coleta: true },
    plano: { diagnostico: 'disponivel', diagnostico_motivo: '', gerado_em: '2026-11-04T07:10:00Z', propostas: 5 }, decisao: { p01_sem_decisao: 0, p01_dias_uteis_max: 0, p01_atrasadas: 0, aprovadas: 4, total: 9 },
    distribuicao: { aprovadas_nao_distribuidas: 0, aprovadas_paradas: 0, aprovadas_dias_max: 0, distribuidas: 4, cards_ps: 4, tarefas: 40 },
    execucao: { cards_ps: 4, cards_abertos: 2, cards_parados: 0, cards_dias_max: 0, ordens: 0, ordens_conferidas: 0, ordens_divergentes: 0, pendencias: 1, pendencias_14: 0, pendencias_30: 0, pendencias_dias_max: 3, chaveiro_ligado: false },
    medicao: { medidas: 0, medicao_em: '2026-11-04T09:00:00Z', sem_medida: 0, sem_medida_dias_max: 0 },
    comunicacao: { chave_ligada: false, inicio_envios: '', elegivel: true, motivo_inelegivel: '', liberado: true, recibo_semana: '', relatorio: { situacao: 'ok', situacao_rotulo: 'programado', frequencia: 'semanal' }, resposta_14d: false, canais_ligados: ['whatsapp'] } }
  const j = montarJornada({ etapas: progressoCliente(cheio).etapas, ctx: cheio })
  const por = Object.fromEntries(j.etapas.flatMap(e => e.passos).map(p => [p.id, p]))
  for (const id of ['quadro_notion', 'cs_responsavel', 'consultor_ml', 'canais', 'produto', 'ml_conexao', 'ml_sem_erro', 'coleta_hoje', 'coleta_28d', 'notion_sync', 'custos', 'lead_time', 'metas', 'catalogo', 'promocoes', 'diagnostico', 'plano_gerado', 'p01', 'aprovadas', 'distribuir', 'cards_ps', 'cards_andando', 'destinos', 'relatorio'])
    assert.equal(por[id].estado, 'feito', `${id} feito`)
  assert.equal(por.chaveiro.estado, 'desligado'); assert.equal(por.chave_envios.estado, 'desligado'); assert.equal(por.recibo.estado, 'desligado')
  assert.equal(por.pendencias_cliente.estado, 'aguardando'); assert.equal(por.medidas.estado, 'aguardando'); assert.equal(por.resposta.estado, 'aguardando')
  assert.equal(j.resumo.pendentes, 0, 'nada pendente: desligado e aguardando não pedem ação'); assert.equal(j.proximo, null)
  assert.equal(por.custos.numero, '92 % do faturamento')
})

await ok('catálogo de passos: ids únicos, etapas 1–10, quem do catálogo, ir válido, prova nunca lança', () => {
  const ids = PASSOS.map(p => p.id); assert.equal(new Set(ids).size, ids.length)
  for (const p of PASSOS) {
    assert.ok(p.etapa >= 1 && p.etapa <= 10 && ETAPAS[p.etapa - 1], p.id); assert.ok(QUEM[p.quem], `quem ${p.quem}`); assert.ok(p.destrava && p.acao && p.nome, p.id)
    assert.ok(p.rota ? p.rota.startsWith('/') : !!p.aba, `ir de ${p.id}`)
    const r = p.prova({}, { agoraMs: Date.parse(AGORA) }); assert.ok(ESTADOS_PASSO.includes(r.estado), `${p.id}: ${r.estado}`)
  }
  for (const e of ETAPAS) assert.ok(PASSOS.some(p => p.etapa === e.n), `etapa ${e.n} tem passo`)
})

console.log(`\n${n} ok, ${falhou} falha(s)`)
process.exit(falhou ? 1 : 0)
