// Autoteste do alerta de pendência CRÍTICA ao cliente (src/lib/alerta-cliente.js + config/alerta-cliente.json): schema, config, gatilho e assinatura, aviso interno com som (nível erro,
// dedupe, agregado acima do limite), CADA salvaguarda isolada (interruptor, liberação, Ativo, já recebeu relatório, destino compartilhado, janela, cooldown, tetos, reconferência),
// envio automático (corpo exato, uma chamada, retry5xx:false), idempotência por título e 5xx ambíguo, falhas do Notion (401 interrompe, 403/404/400 bloqueiam, 5xx não pausa nada),
// resolução, todos os templates do catálogo pelo auditor, auditor barrando = bloqueado sem escrita, o envio manual (prévia → confirmar), o relógio no fuso de São Paulo e o isolamento
// em relação ao relatório. Banco em memória + stub do Notion + relógio falso: nada de rede, de Notion real ou de data/db.sqlite.
// Rodar: node scripts/teste-alerta-cliente.mjs   (e, por fora: TZ=Pacific/Auckland node scripts/teste-alerta-cliente.mjs)
process.env.PS_DB_MEMORIA = '1'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { SCHEMA_ALERTA, validarConfig, lerConfig, assinaturaDe, idsDe, alertaParaBlocos, criarReconferencia } from '../src/lib/alerta-cliente.js'
import { auditarBlocos, auditarTexto, CATEGORIA } from '../src/lib/relatorio-seguro.js'
import { tituloAlertaOk, PREFIXO_ALERTA } from '../src/lib/relatorio-notion.js'
import { SCHEMA_PENDENCIAS } from '../src/lib/pendencias-cliente.js'
import { montarAlerta, QUEM, SEGREDO } from './fixtures/alerta-mundo.mjs'

let n = 0
// SO=cooldown node scripts/teste-alerta-cliente.mjs → roda só os blocos cujo nome contém o texto
const ok = async (nome, fn) => { if (process.env.SO && !nome.includes(process.env.SO)) return; try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const falha = async (fn, rx, status = 400) => { let e; try { await fn() } catch (x) { e = x } assert.ok(e, 'devia ter falhado'); assert.match(e.message, rx); assert.equal(e.status, status); return e }
const posts = m => m.w.chamadasDe('POST', 'pages')
const patches = m => m.w.chamadasDe('PATCH')
const escritas = m => m.w.chamadas.filter(c => c.method !== 'GET' && !c.caminho.endsWith('/query'))
const por = 'Giovanna Torres'
const uma = m => { const l = m.linhas(); assert.equal(l.length, 1, `esperava 1 alerta, há ${l.length}`); return l[0] }
// cliente pronto para o envio automático: estoque crítico (curva A, 3 dias), liberado, com relatório anterior e interruptor ligado
const mundoPronto = (o = {}) => { const m = montarAlerta(o); for (const [c] of o.clientes || [['Acme', {}]]) { m.estoque(c); m.pronto(c) } m.ligar(); return m }
const confirmarManual = async (m, id, extra = {}) => { const p = await m.e.enviar({ id }); assert.equal(p.ok, true, JSON.stringify(p)); return m.e.enviar({ id, confirmar: true, por, previa_id: p.previa_id, ...extra }) }

// o relógio é lido no fuso da config (Intl), NUNCA no fuso do processo: o teste se reexecuta em outros TZ e o resultado tem de ser idêntico
const CASOS_FUSO = [['2026-10-14', '07:59'], ['2026-10-14', '08:00'], ['2026-10-14', '19:59'], ['2026-10-14', '20:00'], ['2026-10-14', '23:30'], ['2026-10-17', '10:00'], ['2026-10-18', '10:00'], ['2026-10-19', '08:00']]
const ESPERADO_FUSO = ['2026-10-14 07:59 fora', '2026-10-14 08:00 enviou', '2026-10-14 19:59 enviou', '2026-10-14 20:00 fora', '2026-10-14 23:30 fora', '2026-10-17 10:00 fora', '2026-10-18 10:00 fora', '2026-10-19 08:00 enviou']
async function rodarFuso() {
  const out = []
  for (const [d, hr] of CASOS_FUSO) {
    const m = montarAlerta({ hoje: d, hora: hr, semRelogioInjetado: true }); m.estoque('Acme'); m.pronto('Acme'); m.ligar()
    const r = await m.e.varrer(); out.push(`${d} ${hr} ${r.enviados ? 'enviou' : 'fora'}`)
  }
  const m = montarAlerta({ hoje: '2026-10-14', hora: '22:30', semRelogioInjetado: true }); m.estoque('Acme'); m.pronto('Acme')      // 22:30 em São Paulo já é dia 15 em UTC
  await m.e.varrer(); const r = await confirmarManual(m, 1); out.push(`manual ${r.estado} ${m.linhas()[0].titulo.slice(-10)}`)
  return out
}
if (process.argv.includes('--fuso')) { process.stdout.write((await rodarFuso()).join('\n') + '\n', () => process.exit(0)); await new Promise(() => {}) }

// ═══ BANCO E CONFIG ══════════════════════════════════════════════════════════════════════════════════════════════════
await ok('SCHEMA_ALERTA: tabela + 3 índices, idempotente; um alerta ABERTO por (cliente, item, canal, assinatura) — resolvido não impede o seguinte', () => {
  const h = new Database(':memory:'); h.exec(SCHEMA_ALERTA); h.exec(SCHEMA_ALERTA)
  assert.deepEqual(h.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%alerta%' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r => r.name), ['alerta_cliente', 'ix_alerta_cli', 'ix_alerta_item', 'ux_alerta_aberto'])
  assert.deepEqual(h.prepare('SELECT * FROM alerta_cliente').columns().map(c => c.name), ['id', 'cliente', 'item', 'canal', 'rotulo', 'canal_rotulo', 'fonte', 'gravidade', 'assinatura', 'ids', 'estado', 'motivo', 'titulo', 'page_id', 'page_url', 'origem', 'por', 'hash',
    'tentativas', 'tentar_apos', 'incerto', 'concluir_pendente', 'criado_em', 'atualizado_em', 'enviado_em', 'resolvido_em'])
  const ins = (estado, sig = 'a') => h.prepare("INSERT INTO alerta_cliente (cliente, item, canal, assinatura, estado, criado_em, atualizado_em) VALUES ('A', 'estoque_curva_a', 'ml', ?, ?, 'x', 'x')").run(sig, estado)
  ins('pendente'); assert.throws(() => ins('enviado'), /UNIQUE/); ins('pendente', 'b'); ins('resolvido'); ins('resolvido')
  h.prepare("UPDATE alerta_cliente SET estado = 'resolvido'").run(); ins('pendente')
})

await ok('config: carga real validada (08:00–20:00, 7 dias, teto 3 por semana e 20 por dia, 5 avisos, DESLIGADO) e erros de digitação derrubam a carga; só a opção de categoria que já existe', () => {
  const c = lerConfig()
  assert.deepEqual([c.fuso, c.hora_inicio, c.hora_fim, c.dias_uteis_apenas, c.cooldown_dias, c.teto_semanal_por_cliente, c.teto_diario_paginas, c.max_avisos_por_varredura, c.automatico_ligado, c.categoria, c.status_final, c.avisar_resolucao],
    ['America/Sao_Paulo', '08:00', '20:00', true, 7, 3, 20, 5, false, CATEGORIA, 'Concluído', true])
  assert.deepEqual([...c.status_elegiveis], ['Ativo']); assert.deepEqual([...c.status_aberto], ['pendente', 'em andamento']); assert.deepEqual([...c.gatilhos.gravidades], ['critico']); assert.deepEqual([...c.gatilhos.excluir_itens], ['retorno_pendente']); assert.ok(Object.isFrozen(c))
  for (const [campo, valor] of [['fuso', 'Marte/Olimpo'], ['hora_inicio', '25:00'], ['hora_fim', '07:00'], ['cooldown_dias', 0], ['teto_semanal_por_cliente', 0], ['teto_diario_paginas', 1.5], ['max_avisos_por_varredura', -1], ['automatico_ligado', 'sim'],
    ['categoria', 'Alerta novo'], ['icone', ''], ['status_aberto', []], ['status_final', ''], ['status_elegiveis', []], ['gatilhos', { gravidades: ['grave'], excluir_itens: [] }], ['gatilhos', { gravidades: ['critico'], excluir_itens: 'x' }], ['previa_ttl_min', 0]])
    assert.throws(() => validarConfig({ ...c, [campo]: valor }), /config\/alerta-cliente\.json/, campo)
  assert.throws(() => validarConfig(null)); assert.throws(() => validarConfig([]))
})

await ok('assinatura e ids: hash de item+canal+ids ORDENADOS+gravidade (a ordem dos ids não muda; item, canal, gravidade e ids mudam); ids por fonte', () => {
  const p = { item: 'estoque_curva_a', canal: 'ml', gravidade: 'critico' }
  assert.match(assinaturaDe(p, ['b', 'a']), /^[0-9a-f]{16}$/); assert.equal(assinaturaDe(p, ['b', 'a']), assinaturaDe(p, ['a', 'b']))
  for (const outro of [{ ...p, item: 'preco_custo' }, { ...p, canal: 'shopee' }, { ...p, gravidade: 'atencao' }]) assert.notEqual(assinaturaDe(outro, ['a']), assinaturaDe(p, ['a']))
  assert.notEqual(assinaturaDe(p, ['a', 'c']), assinaturaDe(p, ['a', 'b']))
  assert.deepEqual(idsDe({ fonte: 'registro', registro_id: 7 }), ['r7']); assert.deepEqual(idsDe({ fonte: 'medido', item: 'acesso_conta' }), [])
  assert.deepEqual(idsDe({ fonte: 'medido', anuncios: [{ id: 'MLB2' }, { id: 'MLB1' }] }), ['MLB2', 'MLB1'], 'estoque: ordem de relevância (receita)')
  const ts = [{ id: 't1', item: 'x', canal: 'ml', dias: 20 }, { id: 't2', item: 'x', canal: 'ml', dias: 40 }, { id: 't3', item: 'y', canal: 'ml', dias: 90 }, { id: 't4', item: 'x', canal: 'amazon', dias: 99 }]
  assert.deepEqual(idsDe({ fonte: 'tarefa', item: 'x', canal: 'ml' }, ts), ['t2', 't1'], 'tarefas do mesmo assunto, a mais antiga primeiro')
})

// ═══ GATILHO, ASSINATURA E AVISO INTERNO ═════════════════════════════════════════════════════════════════════════════
await ok('gatilho: só pendência CRÍTICA do avaliador (estoque curva A < 5 dias com leitura fresca; tarefa 30+ dias com tipo; registro crítico; conta com erro); atenção, leitura velha e tarefa SEM tipo não alertam', async () => {
  const m = montarAlerta({ clientes: [['Acme', {}], ['Beta', {}], ['Gama', {}], ['Delta', {}]] })
  m.estoque('Acme'); m.tarefa({ cliente: 'Acme' }); m.mundo.contas.set('Acme', { erro: 'invalid_grant', atualizado_em: m.iso() })
  m.pend.registrar({ cliente: 'Acme', item: 'verba_ads', canal: 'shopee', detalhe: 'conta sem saldo desde segunda', gravidade: 'critico', por, confirmar: true })
  m.estoque('Beta', [{ cobertura: 6, estoque: 6 }])                                                  // curva A com 6 dias: atenção
  m.estoque('Gama', [{ cobertura: 1, estoque: 1, atualizado_em: m.iso(-60 * 40) }], { atualizado_em: m.iso(-60 * 40) })    // leitura de 40 h: nunca crítico
  m.tarefa({ cliente: 'Delta', tipo: '', processo: 'Shopee', dias: 60, desde: '2026-08-15' })       // 60 dias SEM tipo registrado = retorno_pendente (excluído)
  m.tarefa({ cliente: 'Delta', tipo: 'fotos', processo: 'Shopee', dias: 20, desde: '2026-09-24', faixa: 'cobrar' })   // 20 dias, tipo não crítico: atenção
  const r = await m.e.varrer()
  assert.deepEqual([r.avaliados, r.novos, r.avisos, r.falhas_avaliacao], [4, 4, 4, 0])
  const porItem = (a, b) => a[1].localeCompare(b[1])
  assert.deepEqual(m.linhas().map(l => [l.cliente, l.item, l.canal, l.fonte, l.estado, l.motivo]).sort(porItem), [
    ['Acme', 'acesso_conta', 'ml', 'medido', 'pendente', 'interruptor_desligado'], ['Acme', 'documentos_conta', 'amazon', 'tarefa', 'pendente', 'interruptor_desligado'],
    ['Acme', 'estoque_curva_a', 'ml', 'medido', 'pendente', 'interruptor_desligado'], ['Acme', 'verba_ads', 'shopee', 'registro', 'pendente', 'interruptor_desligado']])
  assert.equal(m.w.chamadas.length, 0, 'sem o interruptor nenhuma chamada ao Notion')
  assert.deepEqual(m.notifs.map(x => x.tipo).sort(), ['alerta_acesso', 'alerta_dependencia', 'alerta_estoque', 'alerta_pendencia'])
})

await ok('política de tom: tarefa SEM tipo registrado ou com data APROXIMADA (última edição do card) nunca gera alerta, aviso vermelho nem linha; com tipo + data real continua alertando', async () => {
  const m = montarAlerta({ clientes: [['Acme', {}], ['Damar', {}], ['Real', {}]] })
  m.tarefa({ cliente: 'Damar', tipo: '', processo: 'Magazine Luiza', dias: 128, desde: '2026-06-02', desde_origem: 'ultima_edicao', faixa: 'revisar' })                 // o caso do Damar: sem tipo e data aproximada
  m.tarefa({ cliente: 'Damar', tipo: '', processo: 'Amazon', dias: 71, desde: '2026-07-29', desde_origem: 'historico', faixa: 'revisar' })                          // sem tipo, até com data real: não afirma gravidade
  m.tarefa({ cliente: 'Damar', tipo: 'documentos', processo: 'Amazon', dias: 60, desde: '2026-08-15', desde_origem: 'ultima_edicao', faixa: 'revisar' })               // tipo registrado, mas data aproximada
  m.tarefa({ cliente: 'Real', tipo: 'documentos', processo: 'Amazon', dias: 35, desde: '2026-09-09', desde_origem: 'registro', faixa: 'revisar' })                    // tipo registrado + data real
  const av = m.pend.avaliar('Damar'); assert.deepEqual([av.resumo.criticas, av.itens.map(p => p.gravidade)], [0, ['atencao', 'atencao', 'atencao']])
  const r = await m.e.varrer()
  assert.deepEqual(m.linhas().map(l => [l.cliente, l.item]), [['Real', 'documentos_conta']], 'só a de tipo registrado + data real vira alerta'); assert.equal(r.novos, 1)
  assert.deepEqual(m.notifs.map(x => [x.tipo, x.cliente]), [['alerta_dependencia', 'Real']], 'nenhum aviso vermelho para o Damar'); assert.ok(!m.notifs.some(x => x.nivel === 'erro' && x.cliente === 'Damar'))
})

await ok('texto do alerta com data aproximada: nunca "N dias" nem "última atualização"; o fato é reconstruído (mesmo se vier a evidência interna)', () => {
  const m = montarAlerta(), cat = m.pend.cat
  const p = { id: 'documentos_conta|amazon|x', item: 'documentos_conta', rotulo: cat.itens.documentos_conta.rotulo, canal: 'amazon', canal_rotulo: 'Amazon', tipo: 'documentos', fonte: 'tarefa', gravidade: 'critico', desde: '2026-06-02', dias: 128, desde_aproximado: true, tarefas: 4,
    evidencia: '4 tarefas aguardam o retorno do cliente; a mais antiga desde 02/06/2026 (128 dia(s); data aproximada pela última atualização da tarefa).',
    impacto: { tipo: 'sem_estimativa', valor_brl: null, rotulo: 'Impacto não estimado: 4 tarefa(s) parada(s) há 128 dia(s)', premissa: null } }
  const t = JSON.stringify(alertaParaBlocos(p, { texto: m.pend.explicar(p), hoje: '2026-10-14', hora: '10:00' }))
  assert.ok(t.includes('4 tarefas aguardam o retorno do cliente (em aberto; data aproximada: 02/06).'), 'fato sem dias')
  assert.ok(!/128|última atualização|\bcard\b|dia\(s\)/.test(t), t.match(/.{30}(128|última atualização|card|dia\(s\)).{30}/)?.[0])
  const real = JSON.stringify(alertaParaBlocos({ ...p, desde_aproximado: false }, { texto: m.pend.explicar(p), hoje: '2026-10-14', hora: '10:00' }))
  assert.ok(real.includes('desde 02/06/2026 (128 dia(s); data aproximada pela última'), 'data real: o fato do avaliador segue como veio')
})

await ok('aviso interno: nível ERRO (som próprio), texto com mais detalhe, link da ficha, dedupe de 24 h; mesma assinatura não repete; nada vai ao Notion sem o interruptor', async () => {
  const m = montarAlerta(); m.estoque('Acme'); m.pend.registrar({ cliente: 'Acme', item: 'verba_ads', canal: 'ml', detalhe: 'cartão recusado na quarta', gravidade: 'critico', por, confirmar: true })
  await m.e.varrer()
  const est = m.notifs.find(x => x.tipo === 'alerta_estoque'), reg = m.notifs.find(x => x.tipo === 'alerta_pendencia')
  for (const a of [est, reg]) assert.deepEqual([a.nivel, a.cliente, a.link, a.dedupeMin, a.titulo], ['erro', 'Acme', '/cliente?cliente=Acme&aba=resumo', 1440, 'Pendência crítica do cliente: Acme'])
  assert.match(est.corpo, /Estoque dos produtos que mais vendem \(Mercado Livre\): Leitura de estoque de 14\/10/); assert.match(est.corpo, /Envio automático desligado: revise e envie pela ficha do cliente/)
  assert.match(reg.corpo, /Detalhe interno: cartão recusado na quarta/, 'o texto INTERNO leva o detalhe do registro')
  const antes = m.notifs.length
  await m.e.varrer(); await m.e.varrer(); assert.equal(m.notifs.length, antes, 'mesma assinatura: nenhum aviso novo'); assert.equal(m.linhas().length, 2)
  m.e.agendador({ ligado: true, por }); m.notifs.length = 0
  m.mundo.bases.clear(); m.estoque('Acme', [{}, { cobertura: 2 }]); await m.e.varrer()
  assert.match(m.notifs.find(x => x.tipo === 'alerta_estoque').corpo, /será criada no Notion do cliente na janela de envio/, 'com o interruptor ligado o aviso diz que a página sai na janela')
  // notificar que lança não derruba a varredura
  const m2 = montarAlerta({ notificar: () => { throw new Error('disco cheio') } }); m2.estoque('Acme')
  const r = await m2.e.varrer(); assert.equal(r.novos, 1); assert.ok(m2.logs.some(l => /o aviso «alerta_estoque» não foi gravado/.test(l)))
})

await ok('assinatura NOVA × IGUAL: mesma = nada; mais itens = aviso e atualização no lugar (ainda não enviado); depois de enviado vira OUTRO alerta (suprimido pelo cooldown); encolher sem piorar é silencioso', async () => {
  const m = montarAlerta(); m.estoque('Acme', [{ id: 'MLB101' }]); await m.e.varrer()
  const a1 = uma(m); assert.equal(m.notifs.length, 1)
  await m.e.varrer(); assert.equal(m.notifs.length, 1); assert.equal(uma(m).assinatura, a1.assinatura)
  m.estoque('Acme', [{ id: 'MLB101' }, { id: 'MLB102', cobertura: 2 }]); await m.e.varrer()                      // mais um produto: assinatura nova, linha pendente é atualizada no lugar
  const a2 = uma(m); assert.equal(m.notifs.length, 2); assert.notEqual(a2.assinatura, a1.assinatura); assert.equal(a2.id, a1.id); assert.deepEqual(JSON.parse(a2.ids), ['MLB101', 'MLB102'])
  // com a página já enviada: produto novo = alerta novo, suprimido pelo cooldown (entra no próximo relatório)
  m.pronto('Acme'); m.ligar(); await m.e.varrer(); assert.equal(uma(m).estado, 'enviado'); assert.equal(posts(m).length, 1)
  m.estoque('Acme', [{ id: 'MLB101' }, { id: 'MLB102', cobertura: 2 }, { id: 'MLB103', cobertura: 2 }]); m.notifs.length = 0; await m.e.varrer()
  assert.deepEqual(m.linhas().map(l => [l.estado, l.motivo]), [['enviado', ''], ['suprimido', 'cooldown']]); assert.equal(m.notifs.length, 1, 'a primeira detecção da assinatura nova avisa'); assert.equal(posts(m).length, 1)
  // um produto sai da lista (subconjunto, sem piorar): nenhum aviso, nenhuma linha nova, a assinatura da linha mais recente acompanha
  m.estoque('Acme', [{ id: 'MLB101' }, { id: 'MLB102', cobertura: 2 }]); m.notifs.length = 0; await m.e.varrer()
  assert.equal(m.notifs.length, 0); assert.equal(m.linhas().length, 2)
})

await ok('tarefas: encerrar UMA das tarefas paradas não é alerta novo (subconjunto, sem aviso); uma tarefa a mais é; resolver todas resolve o alerta', async () => {
  const m = montarAlerta(); const t1 = m.tarefa({}), t2 = m.tarefa({ dias: 40, desde: '2026-09-04' }); await m.e.varrer()
  const a = uma(m); assert.deepEqual(JSON.parse(a.ids), [t1.id, t2.id].sort()); assert.equal(m.notifs.length, 1); assert.match(m.notifs[0].corpo, /2 tarefas aguardam o retorno do cliente; a mais antiga desde 04\/09\/2026 \(40 dia\(s\)\)/)
  m.mundo.tarefas.splice(0, 1); m.notifs.length = 0; await m.e.varrer(); assert.deepEqual([m.linhas().length, m.notifs.length, JSON.parse(uma(m).ids)], [1, 0, [t2.id]])
  const t3 = m.tarefa({ dias: 50, desde: '2026-08-25' }); await m.e.varrer(); assert.deepEqual([m.linhas().length, m.notifs.length], [1, 1])
  assert.deepEqual(JSON.parse(uma(m).ids), [t2.id, t3.id].sort(), 'tarefa a mais: assinatura nova, linha atualizada no lugar')
  m.mundo.tarefas.length = 0; await m.e.varrer(); assert.equal(uma(m).estado, 'resolvido')
})

// ═══ SALVAGUARDAS — cada uma isolada (alerta fica PENDENTE com o motivo; zero escrita) ═══════════════════════════════
await ok('salvaguarda: interruptor «alerta_auto» (nasce DESLIGADO) — pendente com motivo, zero chamada; ligar libera o que ficou esperando', async () => {
  const m = montarAlerta(); m.estoque('Acme'); m.pronto('Acme')
  assert.deepEqual(m.e.agendadorEstado(), { ligado: false })
  const r = await m.e.varrer(); assert.deepEqual([r.pendentes, r.enviados], [1, 0]); const l = uma(m); assert.deepEqual([l.estado, l.motivo], ['pendente', 'interruptor_desligado']); assert.equal(m.w.chamadas.length, 0)
  m.ligar(); const r2 = await m.e.varrer(); assert.equal(r2.enviados, 1); assert.equal(uma(m).estado, 'enviado'); assert.equal(posts(m).length, 1)
  m.e.agendador({ ligado: false, por }); m.estoque('Acme', [{ id: 'MLB77', cobertura: 2 }]); m.mundo.bases.clear(); m.estoque('Acme', [{ id: 'MLB77', cobertura: 2 }])
  await m.e.varrer(); assert.equal(posts(m).length, 1, 'desligar é freio de emergência: nada novo sai')
})

await ok('salvaguarda: liberação do relatório (ativado_por) e programação sem pausa — sem isso o alerta espera', async () => {
  const m = montarAlerta(); m.estoque('Acme'); m.relatorioEnviado('Acme'); m.ligar()
  await m.e.varrer(); assert.deepEqual([uma(m).estado, uma(m).motivo], ['pendente', 'nao_liberado'])
  m.liberar('Acme', { ativado_por: '' }); await m.e.varrer(); assert.equal(uma(m).motivo, 'nao_liberado', 'linha de programação sem liberação')
  m.liberar('Acme', { pausado_motivo: 'sem_base' }); await m.e.varrer(); assert.equal(uma(m).motivo, 'programacao_pausada')
  assert.equal(m.w.chamadas.length, 0)
  m.liberar('Acme'); await m.e.varrer(); assert.equal(uma(m).estado, 'enviado')
})

await ok('salvaguarda: cliente ATIVO explícito — Congelado, em desligamento, status vazio ou ausente nem é avaliado; o manual também recusa', async () => {
  for (const status of ['Congelado', 'Processo de Desligamento', '', undefined, null, 'ativo?']) {
    const m = montarAlerta({ elegiveis: () => [{ cliente: 'Acme', status }, { cliente: '[Comercial] Empresa', status: 'Ativo' }] }); m.estoque('Acme'); m.pronto('Acme'); m.ligar()
    const r = await m.e.varrer(); assert.deepEqual([r.avaliados, r.novos, m.linhas().length, m.notifs.length, m.w.chamadas.length], [0, 0, 0, 0, 0], String(status))
  }
  const ativo = [{ cliente: 'Acme', status: 'Ativo' }]; let lista = ativo
  const m = montarAlerta({ elegiveis: () => lista }); m.estoque('Acme'); m.pronto('Acme'); await m.e.varrer()                       // interruptor desligado: a linha fica pendente
  lista = [{ cliente: 'Acme', status: 'Congelado' }]
  const p = await m.e.enviar({ id: 1 }); assert.deepEqual([p.ok, p.estado], [false, 'cliente_inelegivel']); assert.match(p.mensagem, /Só clientes Ativos recebem alertas/)
  const c = await m.e.enviar({ id: 1, confirmar: true, por, previa_id: 'pv-x', confirmar_destino: true }).catch(e => e); assert.equal(c.status, 409, 'sem prévia válida nada passa — e a prévia nem existe para inelegível')
  lista = ativo; const pv = await m.e.enviar({ id: 1 }); assert.equal(pv.ok, true); lista = [{ cliente: 'Acme', status: 'Congelado' }]            // o cliente é congelado ENTRE a prévia e o confirmar
  const x = await m.e.enviar({ id: 1, confirmar: true, por, previa_id: pv.previa_id, confirmar_destino: true }); assert.deepEqual([x.ok, x.estado], [false, 'cliente_inelegivel'])
  assert.equal(posts(m).length, 0); assert.equal(escritas(m).length, 0)
})

await ok('salvaguarda: o cliente JÁ recebeu pelo menos um relatório (enviado/adotado) — o primeiro contato nunca é um alerta', async () => {
  const m = montarAlerta(); m.estoque('Acme'); m.liberar('Acme'); m.ligar()
  await m.e.varrer(); assert.deepEqual([uma(m).estado, uma(m).motivo], ['pendente', 'sem_relatorio_anterior'])
  for (const estado of ['falhou', 'bloqueado', 'arquivado']) m.h.prepare("INSERT INTO relatorio_envio (cliente, de, ate, origem, estado, por, em) VALUES ('Acme', '2026-10-02', '2026-10-08', 'manual', ?, 'x', 'y')").run(estado)
  await m.e.varrer(); assert.equal(uma(m).motivo, 'sem_relatorio_anterior', 'só enviado/adotado conta')
  m.h.prepare("INSERT INTO relatorio_envio (cliente, de, ate, origem, estado, por, em) VALUES ('Acme', '2026-10-09', '2026-10-15', 'manual', 'adotado', 'x', 'y')").run()
  await m.e.varrer(); assert.equal(uma(m).estado, 'enviado'); assert.equal(m.w.chamadas.some(c => c.method === 'POST' && c.caminho === 'pages'), true)
})

await ok('salvaguarda: destino pronto e NÃO compartilhado — sem base, página compartilhada e coluna sem a categoria existente ficam pendentes (nunca cria opção nova)', async () => {
  const m = montarAlerta({ clientes: [['Par A', {}], ['Par B', {}], ['SemBase', { base: false }], ['SelectSem', { opcaoCategoria: false }], ['StatusSem', { secao: 'status', opcaoCategoria: false }], ['SemSecao', { secao: null }]] })
  const A = m.w.cfgCli.get('Par A'); m.estado.set('pagina_cliente:Par A', A.pagina_id); m.estado.set('pagina_cliente:Par B', A.pagina_id)
  for (const [c] of [['Par A'], ['SemBase'], ['SelectSem'], ['StatusSem'], ['SemSecao']]) { m.estoque(c); m.pronto(c) }
  m.ligar(); const r = await m.e.varrer()
  assert.deepEqual(m.linhas().map(l => [l.cliente, l.estado, l.motivo]), [['Par A', 'pendente', 'destino_compartilhado'], ['SelectSem', 'pendente', 'categoria_ausente'], ['SemBase', 'pendente', 'sem_base'], ['SemSecao', 'pendente', 'categoria_ausente'], ['StatusSem', 'pendente', 'categoria_ausente']])   // ordem alfabética da varredura
  assert.equal(r.pendentes, 5); assert.equal(posts(m).length, 0); assert.equal(escritas(m).length, 0, 'nenhuma escrita (nem opção de categoria nova)')
})

await ok('salvaguarda: janela própria 08:00–20:00, dias úteis — fora dela fica pendente SEM tocar no Notion e sai na abertura; 08:00 exato abre, 20:00 exato fecha', async () => {
  const casos = [['2026-10-14', '07:59', false], ['2026-10-14', '08:00', true], ['2026-10-14', '19:59', true], ['2026-10-14', '20:00', false], ['2026-10-14', '03:00', false], ['2026-10-17', '10:00', false], ['2026-10-18', '10:00', false]]
  for (const [d, hr, abre] of casos) {
    const m = montarAlerta({ hoje: d, hora: hr }); m.estoque('Acme'); m.pronto('Acme'); m.ligar(); await m.e.varrer()
    assert.equal(uma(m).estado, abre ? 'enviado' : 'pendente', `${d} ${hr}`); if (!abre) { assert.equal(uma(m).motivo, 'fora_da_janela'); assert.equal(m.w.chamadas.length, 0, 'fora da janela não lê nem o Notion'); assert.equal(m.reconf.chamadas.length, 0) }
  }
  const m = montarAlerta({ hoje: '2026-10-14', hora: '03:00' }); m.estoque('Acme'); m.pronto('Acme'); m.ligar(); await m.e.varrer(); assert.equal(m.notifs.length, 1, 'o aviso interno sai na hora, de madrugada')
  m.relogio.ir('2026-10-14', '08:05'); m.mundo.bases.clear(); m.estoque('Acme'); await m.e.varrer(); assert.equal(uma(m).estado, 'enviado', 'na abertura o pendente sai'); assert.equal(m.notifs.length, 1, 'e não avisa de novo')
  const dom = montarAlerta({ hoje: '2026-10-17', hora: '10:00', cfg: { dias_uteis_apenas: false } }); dom.estoque('Acme'); dom.pronto('Acme'); dom.ligar(); await dom.e.varrer(); assert.equal(uma(dom).estado, 'enviado', 'dias_uteis_apenas:false abre no sábado')
})

await ok('salvaguarda: cooldown de 7 dias por (cliente, item) — assinatura nova dentro dele fica SUPRIMIDA (não enviada, não descartada em silêncio); depois dele um novo episódio sai', async () => {
  const m = mundoPronto(); await m.e.varrer(); assert.equal(uma(m).estado, 'enviado')
  m.mundo.bases.clear(); await m.e.varrer(); assert.equal(uma(m).estado, 'resolvido')                       // o estoque voltou ao normal
  m.relogio.avancarMin(5 * 24 * 60); m.estoque('Acme', [{ id: 'MLB555' }]); m.notifs.length = 0; await m.e.varrer()            // 5 dias depois (segunda 19/10), de novo crítico
  assert.deepEqual(m.linhas().map(l => [l.estado, l.motivo]), [['resolvido', ''], ['suprimido', 'cooldown']]); assert.equal(posts(m).length, 1); assert.equal(m.notifs.length, 1, 'aviso interno mesmo suprimido')
  m.mundo.bases.clear(); await m.e.varrer(); m.relogio.avancarMin(3 * 24 * 60); m.estoque('Acme', [{ id: 'MLB556' }]); await m.e.varrer()       // 8 dias depois do envio (quinta 22/10)
  assert.equal(m.linhas().at(-1).estado, 'enviado'); assert.equal(posts(m).length, 2)
  // outro item do MESMO cliente não é barrado pelo cooldown do estoque
  const m2 = mundoPronto(); m2.tarefa({ cliente: 'Acme' }); await m2.e.varrer(); assert.deepEqual(m2.linhas().map(l => [l.item, l.estado]), [['estoque_curva_a', 'enviado'], ['documentos_conta', 'enviado']])
})

await ok('salvaguarda: teto semanal por cliente (3) e teto diário de páginas (20) — o excedente fica pendente com o motivo e sai quando abre espaço', async () => {
  const m = mundoPronto(); m.tarefa({ cliente: 'Acme' }); m.mundo.contas.set('Acme', { erro: 'x', atualizado_em: m.iso() })
  m.pend.registrar({ cliente: 'Acme', item: 'verba_ads', canal: 'ml', detalhe: 'sem saldo', gravidade: 'critico', por, confirmar: true })
  const r = await m.e.varrer(); assert.deepEqual([r.enviados, r.pendentes], [3, 1])
  assert.deepEqual(m.linhas().map(l => l.estado).sort(), ['enviado', 'enviado', 'enviado', 'pendente']); const espera = m.linhas().find(l => l.estado === 'pendente'); assert.equal(espera.motivo, 'teto_semanal')
  assert.equal(posts(m).length, 3)
  m.relogio.avancarMin(8 * 24 * 60); m.mundo.bases.clear(); m.estoque('Acme'); m.mundo.contas.set('Acme', { erro: 'x', atualizado_em: m.iso() }); m.mundo.tarefas.length = 0; m.tarefa({ cliente: 'Acme' })
  await m.e.varrer(); assert.equal(m.linhas().find(l => l.id === espera.id).estado, 'enviado', 'oito dias depois a vaga abre')
  // teto diário global
  const d = mundoPronto({ clientes: [['A1', {}], ['A2', {}], ['A3', {}]], cfg: { teto_diario_paginas: 2 } }); const rd = await d.e.varrer()
  assert.deepEqual([rd.enviados, rd.pendentes], [2, 1]); assert.equal(d.linhas().find(l => l.estado === 'pendente').motivo, 'teto_diario')
  d.relogio.avancarMin(24 * 60); for (const c of ['A1', 'A2', 'A3']) d.mundo.bases.delete(c); for (const c of ['A1', 'A2', 'A3']) d.estoque(c); d.mundo.bases.delete('A1'); d.mundo.bases.delete('A2')
  await d.e.varrer(); assert.equal(d.linhas().find(l => l.cliente === 'A3').estado, 'enviado', 'no dia seguinte sai')
})

await ok('salvaguarda: reconferência AO VIVO — negativa = suprimido (motivo), indisponível = pendente com backoff (não descarta), confirmada = envia; recebe os ids citados', async () => {
  const m = mundoPronto(); m.reconf.estado = 'negativo'; await m.e.varrer()
  assert.deepEqual([uma(m).estado, uma(m).motivo], ['suprimido', 'reconferencia_negativa']); assert.equal(posts(m).length, 0); assert.equal(m.reconf.chamadas.length, 1); assert.equal(m.reconf.chamadas[0].item, 'estoque_curva_a'); assert.equal(m.reconf.chamadas[0].ids.length, 1)
  const i = montarAlerta(); i.estoque('Acme'); i.pronto('Acme'); i.ligar(); i.reconf.lancar = new Error('ML fora do ar'); await i.e.varrer()
  const l = uma(i); assert.deepEqual([l.estado, l.motivo, l.tentativas], ['pendente', 'reconferencia_indisponivel', 1]); assert.ok(l.tentar_apos > i.relogio.agora()); assert.equal(posts(i).length, 0)
  const chamadas = i.reconf.chamadas.length; await i.e.varrer(); assert.equal(i.reconf.chamadas.length, chamadas, 'antes do backoff não tenta de novo')
  i.reconf.lancar = null; i.relogio.avancarMin(31); i.mundo.bases.clear(); i.estoque('Acme'); await i.e.varrer(); assert.equal(uma(i).estado, 'enviado'); assert.equal(posts(i).length, 1)
  const b = montarAlerta(); b.estoque('Acme'); b.pronto('Acme'); b.ligar(); b.e.agendador({ ligado: true, por }); const bo = b.reconf; bo.estado = 'indisponivel'; await b.e.varrer(); assert.equal(uma(b).motivo, 'reconferencia_indisponivel')
})

await ok('salvaguarda: bases não verificadas — enquanto algum cliente elegível tem a página sem cache, o automático espera (não dá para descartar página compartilhada)', async () => {
  const m = montarAlerta({ clientes: [['Acme', {}], ['Beta', {}]] }); m.estoque('Acme'); m.pronto('Acme'); m.ligar(); m.estado.set('pagina_cliente:Beta', '')
  await m.e.varrer(); assert.deepEqual([uma(m).estado, uma(m).motivo], ['pendente', 'bases_nao_verificadas']); assert.equal(m.w.chamadas.length, 0)
  m.estado.set('pagina_cliente:Beta', m.w.cfgCli.get('Beta').pagina_id); await m.e.varrer(); assert.equal(uma(m).estado, 'enviado')
})

// ═══ ENVIO AUTOMÁTICO ════════════════════════════════════════════════════════════════════════════════════════════════
await ok('envio automático: UMA chamada de criação (retry5xx:false), título «Alerta Place2u · tema · dd/mm/aaaa», ícone ⚠️, categoria existente, Status «Pendente», corpo = alertaParaBlocos; linha enviada completa', async () => {
  const m = mundoPronto(); const r = await m.e.varrer(); assert.deepEqual([r.enviados, r.avisos], [1, 1])
  assert.equal(posts(m).length, 1); const post = posts(m)[0]
  assert.equal(post.retry5xx, false)
  const titulo = `${PREFIXO_ALERTA}Estoque dos produtos que mais vendem (Mercado Livre) · 14/10/2026`
  assert.deepEqual(post.body.properties, { Name: { title: [{ type: 'text', text: { content: titulo } }] }, 'Secção ': { select: { name: CATEGORIA } }, Status: { select: { name: 'Pendente' } } })
  assert.deepEqual(post.body.icon, { type: 'emoji', emoji: '⚠️' }); assert.equal(post.body.parent.data_source_id, m.w.cfgCli.get('Acme').ds_id)
  const p = m.pend.avaliar('Acme').itens.find(x => x.item === 'estoque_curva_a')
  assert.deepEqual(post.body.children, alertaParaBlocos(p, { texto: m.pend.explicar(p), hoje: '2026-10-14', hora: '10:00' }))
  const tipos = post.body.children.map(b => b.type); assert.deepEqual(tipos, ['callout', 'heading_3', 'paragraph', 'heading_3', 'paragraph', 'heading_3', 'paragraph', 'heading_3', 'paragraph', 'paragraph', 'heading_3', 'paragraph', 'heading_3', 'paragraph', 'divider', 'paragraph'])
  const l = uma(m); assert.deepEqual([l.estado, l.motivo, l.titulo, l.origem, l.por, l.incerto, l.tentativas, l.enviado_em], ['enviado', '', titulo, 'automatico', 'sistema', 0, 0, m.relogio.agora()])
  assert.match(l.page_url, /^https:\/\/www\.notion\.so\/[0-9a-f]{32}$/); assert.match(l.hash, /^[0-9a-f]{16}$/); assert.equal(l.page_id.length, 32)
  const texto = JSON.stringify(post.body)
  assert.ok(!/MLB|Giovanna|Carla|PS-|Sprint|garant(?!ia)/.test(texto.replace(CATEGORIA, '')), 'sem ID, responsável, nome interno'); assert.match(texto, /Informação factual datada em 14\/10 às 10:00; a leitura de impacto é uma estimativa, não uma garantia\./)
  assert.deepEqual(auditarBlocos(post.body.children, { nomesInternos: QUEM, permitidos: ['Acme'] }), [])
  assert.ok(m.logs.some(x => /alertas Acme: enviado \(automatico\)/.test(x)))
})

await ok('Status: «Pendente» quando existe; sem a opção a página nasce sem Status (nunca cria opção); tarefa/registro/conta geram página com o canal no título', async () => {
  const m = mundoPronto(); const orig = m.w.notion.req
  m.w.notion.req = async (c, o = {}) => { const r = await orig(c, o); if (/^data_sources\/[0-9a-f]{32}$/.test(c) && (!o.method || o.method === 'GET')) r.properties.Status.select.options = [{ name: 'Concluído' }]; return r }
  await m.e.varrer(); assert.deepEqual(Object.keys(posts(m)[0].body.properties).sort(), ['Name', 'Secção '], 'sem Pendente/Em andamento: sem Status')
  const t = mundoPronto(); t.mundo.bases.clear(); t.tarefa({ cliente: 'Acme', processo: 'Shopee' }); t.pend.registrar({ cliente: 'Acme', item: 'verba_ads', canal: 'amazon', detalhe: 'sem saldo', gravidade: 'critico', por, confirmar: true })
  await t.e.varrer(); assert.deepEqual(t.linhas().map(l => l.titulo.replace(/ · \d\d\/\d\d\/\d{4}$/, '')), [`${PREFIXO_ALERTA}Documentos e validação da conta (Shopee)`, `${PREFIXO_ALERTA}Verba de anúncios pagos (Amazon)`])
})

await ok('NÃO toca o relatório: relatorio_programacao e relatorio_envio ficam idênticos (a sexta não avança) depois de detectar, enviar, suprimir e resolver', async () => {
  const m = mundoPronto(); m.tarefa({ cliente: 'Acme' }); const antes = m.snapshotRelatorio()
  await m.e.varrer(); m.mundo.bases.clear(); m.mundo.tarefas.length = 0; await m.e.varrer(); await m.e.varrer()
  assert.deepEqual(m.linhas().map(l => l.estado), ['resolvido', 'resolvido']); assert.equal(m.snapshotRelatorio(), antes)
  assert.equal(m.h.prepare("SELECT proximo_envio FROM relatorio_programacao WHERE cliente = 'Acme'").get().proximo_envio, '2026-10-16')
  const mm = mundoPronto(); mm.estoque('Acme'); await mm.e.varrer(); const a = await mm.e.enviar({ id: 1 }); assert.equal(a.ok, false)
})

// ═══ IDEMPOTÊNCIA E FALHAS DO NOTION ═════════════════════════════════════════════════════════════════════════════════
await ok('idempotência por título: página com o mesmo título já existe → ADOTA (zero criação); 5xx que criou a página → consulta por título e adota (incerto); 5xx que não criou → falhou + backoff, depois cria UMA vez', async () => {
  const a = mundoPronto(), ds = a.w.cfgCli.get('Acme').ds_id
  a.w.paginasDs.get(ds).push({ id: 'f'.repeat(32), url: 'https://www.notion.so/' + 'f'.repeat(32), titulo: `${PREFIXO_ALERTA}Estoque dos produtos que mais vendem (Mercado Livre) · 14/10/2026`, created_time: '2026-10-14T12:00:00.000Z', archived: false })
  await a.e.varrer(); assert.equal(posts(a).length, 0); assert.deepEqual([uma(a).estado, uma(a).motivo, uma(a).page_id], ['enviado', 'adotado', 'f'.repeat(32)])
  // 502 DEPOIS de criar
  const b = mundoPronto(); b.w.falhas.criar.push({ status: 502, cria: true }); await b.e.varrer()
  assert.equal(posts(b).length, 1); assert.deepEqual([uma(b).estado, uma(b).incerto, uma(b).motivo], ['enviado', 1, 'adotado']); assert.equal(b.w.paginasVivas(b.w.cfgCli.get('Acme').ds_id).length, 1)
  // 503 SEM criar
  const c = mundoPronto(); c.w.falhas.criar.push({ status: 503 }); const r = await c.e.varrer()
  assert.deepEqual([r.falhou, uma(c).estado, uma(c).motivo, uma(c).tentativas], [1, 'falhou', 'notion_503', 1]); const t1 = uma(c).tentar_apos; assert.ok(t1 > c.relogio.agora())
  await c.e.varrer(); assert.equal(posts(c).length, 1, 'antes do backoff nada é reenviado')
  c.relogio.avancarMin(31); c.mundo.bases.clear(); c.estoque('Acme'); await c.e.varrer()
  assert.equal(posts(c).length, 2); assert.equal(uma(c).estado, 'enviado'); assert.equal(c.w.paginasVivas(c.w.cfgCli.get('Acme').ds_id).length, 1, 'uma página só')
  assert.ok(posts(c).every(p => p.retry5xx === false))
  // a consulta por título que falha também é falha retentável (nada é criado às cegas)
  const d = mundoPronto(); d.w.falhas.query.push({ status: 500 }); await d.e.varrer(); assert.deepEqual([uma(d).estado, uma(d).motivo, posts(d).length], ['falhou', 'notion_500', 0])
})

await ok('falhas do Notion: 401 INTERROMPE a varredura (os demais ficam como estão, um aviso de erro); 403/404/400 = bloqueado com motivo fixo; segredo do corpo nunca vai a log, banco ou aviso', async () => {
  const clientes = [['A1', {}], ['A2', {}], ['A3', {}]]
  const u = mundoPronto({ clientes }); u.w.falhas.criar.push({ status: 401 }); const r = await u.e.varrer()
  assert.deepEqual([r.interrompido, r.pendentes, u.linhas().map(l => l.estado), u.linhas().map(l => l.motivo)], ['credencial', 1, ['pendente', 'pendente', 'pendente'], ['notion_401', '', '']]); assert.equal(posts(u).length, 1)
  assert.deepEqual(u.notifs.filter(x => x.tipo.startsWith('alerta_falhou')).map(x => [x.tipo, x.nivel]), [['alerta_falhou:notion_401', 'erro']]); assert.match(u.notifs.at(-1).corpo, /token do Notion/)
  for (const [status, motivo] of [[403, 'notion_403'], [404, 'notion_404'], [400, 'notion_400']]) {
    const m = mundoPronto(); m.w.falhas.criar.push({ status }); const x = await m.e.varrer(); const l = uma(m)
    assert.deepEqual([x.bloqueados, l.estado, l.motivo], [1, 'bloqueado', motivo], String(status))
    assert.ok(!JSON.stringify([m.logs, m.notifs, l]).includes(SEGREDO), 'o corpo do Notion não vai a log, aviso nem banco')
    await m.e.varrer(); assert.equal(posts(m).length, 1, 'bloqueado não é reenviado sozinho')
  }
  const rede = mundoPronto(); const orig = rede.w.notion.req; rede.w.notion.req = async (c, o) => { if (c.startsWith('pages/')) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }); return orig(c, o) }
  await rede.e.varrer(); assert.deepEqual([uma(rede).estado, uma(rede).motivo], ['falhou', 'notion_rede'])
})

await ok('Notion fora do ar (5xx): NÃO pausa nada — a programação do relatório fica intacta; 3 falhas seguidas acionam o disjuntor com UM aviso; o resto espera o próximo ciclo', async () => {
  const clientes = [['A1', {}], ['A2', {}], ['A3', {}], ['A4', {}]]
  const m = mundoPronto({ clientes }); for (let i = 0; i < 4; i++) m.w.falhas.criar.push({ status: 503 })
  const antes = m.snapshotRelatorio(); const r = await m.e.varrer()
  assert.deepEqual([r.interrompido, r.falhou], ['disjuntor', 3]); assert.deepEqual(m.linhas().map(l => l.estado), ['falhou', 'falhou', 'falhou', 'pendente'])
  assert.deepEqual(m.notifs.filter(x => x.tipo === 'alerta_falhou:disjuntor').map(x => x.nivel), ['alerta']); assert.equal(m.snapshotRelatorio(), antes, 'nenhum cliente foi pausado')
  assert.ok(m.linhas().every(l => l.estado !== 'bloqueado'))
})

// ═══ RESOLUÇÃO ═══════════════════════════════════════════════════════════════════════════════════════════════════════
await ok('resolução: a pendência some do avaliador → resolvido, Status da página vira «Concluído» (PATCH), aviso de sucesso; ainda presente porém menos grave NÃO resolve', async () => {
  const m = mundoPronto(); await m.e.varrer(); const id = uma(m).page_id; m.notifs.length = 0
  m.mundo.bases.clear(); m.estoque('Acme', [{ cobertura: 7, estoque: 7 }]); await m.e.varrer()                                  // 7 dias: ainda é pendência (atenção), só deixou de ser crítica
  assert.deepEqual([uma(m).estado, patches(m).length], ['enviado', 0], 'presente = não resolve')
  m.mundo.bases.clear(); m.estoque('Acme', [{ cobertura: 40, estoque: 40, u: 28 }]); const r = await m.e.varrer()
  const l = uma(m); assert.deepEqual([r.resolvidos, r.concluidos, l.estado, l.concluir_pendente, l.resolvido_em], [1, 1, 'resolvido', 0, m.relogio.agora()])
  assert.equal(patches(m).length, 1); assert.deepEqual(patches(m)[0].body, { properties: { Status: { select: { name: 'Concluído' } } } }); assert.equal(patches(m)[0].caminho, `pages/${id}`)
  assert.deepEqual(m.notifs.map(x => [x.tipo, x.nivel]), [['alerta_resolvido', 'sucesso']])
  await m.e.varrer(); assert.equal(patches(m).length, 1, 'uma vez só')
})

await ok('resolução: interruptor desligado adia o PATCH (concluir_pendente) e ligar conclui; página sem a opção Concluído não gera erro; alerta que nunca saiu resolve calado', async () => {
  const m = mundoPronto(); await m.e.varrer(); m.e.agendador({ ligado: false, por }); m.mundo.bases.clear()
  await m.e.varrer(); assert.deepEqual([uma(m).estado, uma(m).concluir_pendente, patches(m).length], ['resolvido', 1, 0])
  m.ligar(); await m.e.varrer(); assert.deepEqual([uma(m).concluir_pendente, patches(m).length], [0, 1])
  const s = mundoPronto(); await s.e.varrer(); const orig = s.w.notion.req
  s.w.notion.req = async (c, o = {}) => { const r = await orig(c, o); if (/^data_sources\/[0-9a-f]{32}$/.test(c) && (!o.method || o.method === 'GET')) r.properties.Status.select.options = [{ name: 'Pendente' }]; return r }
  s.mundo.bases.clear(); await s.e.varrer(); assert.deepEqual([uma(s).estado, uma(s).concluir_pendente, patches(s).length], ['resolvido', 0, 0], 'sem a opção: nada a fazer, sem erro')
  const p = montarAlerta(); p.estoque('Acme'); await p.e.varrer(); p.notifs.length = 0; p.mundo.bases.clear(); await p.e.varrer()
  assert.deepEqual([uma(p).estado, uma(p).concluir_pendente, p.notifs.length, p.w.chamadas.length], ['resolvido', 0, 0, 0])
  const f = mundoPronto(); await f.e.varrer(); f.mundo.bases.clear(); f.w.falhas.arquivar.push({ status: 503 }); await f.e.varrer(); assert.equal(uma(f).concluir_pendente, 1, 'Notion fora do ar: tenta de novo depois')
  await f.e.varrer(); assert.equal(uma(f).concluir_pendente, 0)
})

await ok('alinhamento com o cliente (predicado REAL composto com o avaliador): pendência enviada que passa a ser coberta fica suprimido/alinhado — sem «Concluído» no Notion nem aviso de resolução; acabado o alinhamento, a mesma linha volta a enviado', async () => {
  const { criarAlinhamentos, SCHEMA_ALINHAMENTO } = await import('../src/lib/alinhamentos.js')
  let A
  const m = montarAlerta({ alinhado: (c, dia) => A.predicado(c, { hoje: dia }), idAcao: (c, r, alvo) => `PS-${r}-${alvo}` })
  m.h.exec(SCHEMA_ALINHAMENTO)
  A = criarAlinhamentos({ handle: m.h, hoje: m.relogio.hoje, agora: m.relogio.agora, nomesInternos: () => QUEM, validarPor: x => QUEM.includes(x) ? x : '' })
  m.estoque('Acme'); m.pronto('Acme'); m.ligar()
  await m.e.varrer(); const l0 = uma(m); assert.equal(l0.estado, 'enviado'); m.notifs.length = 0
  const al = A.registrar({ cliente: 'Acme', escopo: 'anuncio', chave: 'MLB900', tipo: 'ja_informado', por: QUEM[0], confirmar: true })   // "o consultor já falou com o seller"
  const r = await m.e.varrer(), l1 = uma(m)
  assert.deepEqual([l1.estado, l1.motivo, l1.concluir_pendente, r.resolvidos, patches(m).length], ['suprimido', 'alinhado', 0, 0, 0], 'estoque ainda crítico: não é resolução')
  assert.ok(!m.notifs.some(x => x.tipo === 'alerta_resolvido'), 'nenhum aviso de «Pendência resolvida»')
  assert.match(m.e.listarCliente('Acme').itens[0].motivo, /alinhamento com o cliente/, 'a tela diz por que não sai')
  A.encerrar({ cliente: 'Acme', id: al.id, por: QUEM[0] })
  await m.e.varrer(); const l2 = uma(m)
  assert.deepEqual([l2.estado, l2.page_id, posts(m).length, patches(m).length], ['enviado', l0.page_id, 1, 0], 'a mesma linha reabre como enviada (a página já existe), sem página nova')
})

// ═══ AVISOS EM LOTE ══════════════════════════════════════════════════════════════════════════════════════════════════
await ok('proteção contra tempestade: no máximo 5 avisos individuais por varredura e UM agregado com os demais; todos nível erro', async () => {
  const clientes = Array.from({ length: 8 }, (_, i) => [`Cli ${i}`, {}]), m = montarAlerta({ clientes }); for (const [c] of clientes) m.estoque(c)
  const r = await m.e.varrer(); assert.deepEqual([r.novos, r.avisos], [8, 6])
  assert.equal(m.notifs.filter(x => x.cliente).length, 5); const ag = m.notifs.find(x => !x.cliente)
  assert.deepEqual([ag.tipo, ag.nivel, ag.titulo, ag.link], ['alerta_pendencia', 'erro', '3 clientes com pendência crítica', '/planos']); assert.match(ag.corpo, /Cli 5, Cli 6, Cli 7/)
  assert.ok(m.notifs.every(x => x.nivel === 'erro'))
  const um = montarAlerta({ clientes, cfg: { max_avisos_por_varredura: 7 } }); for (const [c] of clientes) um.estoque(c); await um.e.varrer(); assert.equal(um.notifs.find(x => !x.cliente).titulo, '1 cliente com pendência crítica')
  const zero = montarAlerta({ clientes, cfg: { max_avisos_por_varredura: 0 } }); for (const [c] of clientes) zero.estoque(c); await zero.e.varrer(); assert.equal(zero.notifs.length, 1, 'só o agregado')
})

// ═══ TEXTO AO CLIENTE ════════════════════════════════════════════════════════════════════════════════════════════════
await ok('TODOS os templates do catálogo (14 itens × canais) viram página que passa no auditor: título válido, tipos de bloco permitidos, ≤ 60 blocos, sem ID, nome, prazo, promessa ou culpa', () => {
  const m = montarAlerta(), cat = m.pend.cat; let paginas = 0
  const impactos = [{ tipo: 'sem_estimativa', valor_brl: null, rotulo: 'Impacto não estimado (parado: o cálculo de margem)', premissa: null },
    { tipo: 'previsto', valor_brl: 2060, rotulo: 'Receita possivelmente em risco: R$ 2.060 (estimativa)', premissa: 'Estimativa: receita por dia medida nos últimos 28 dias (R$ 120 por dia nestes produtos) × dias sem estoque até a reposição, com prazo de reposição de 21 dias (referência da Place2u, ajustável ao fornecedor). Hipótese de cenário base, não promessa de resultado.' }]
  for (const [id, it] of Object.entries(cat.itens)) for (const canal of it.canais) for (const imp of impactos) for (const aprox of [false, true]) {
    const rotuloCanal = cat.canais.find(c => c.id === canal).rotulo
    const p = { id: `${id}|${canal}|x`, item: id, rotulo: it.rotulo, canal, canal_rotulo: rotuloCanal, tipo: it.tipo, fonte: 'tarefa', gravidade: 'critico', desde: '2026-09-09', dias: 35, desde_aproximado: aprox,
      evidencia: `2 tarefas aguardam o retorno do cliente; a mais antiga desde 09/09/2026 (35 dia(s)${aprox ? '; data aproximada pela última atualização da tarefa' : ''}).`, impacto: imp, tarefas: 2, produtos: ['Produto A', 'Produto B'] }
    const blocos = alertaParaBlocos(p, { texto: m.pend.explicar(p), hoje: '2026-10-14', hora: '10:00' })
    const titulo = `${PREFIXO_ALERTA}${it.rotulo} (${rotuloCanal}) · 14/10/2026`
    assert.deepEqual(auditarBlocos(blocos, { nomesInternos: QUEM, permitidos: ['Acme'] }), [], `${id}/${canal}`); assert.deepEqual(auditarTexto(titulo, { nomesInternos: QUEM, permitidos: ['Acme'] }), [], `título ${id}/${canal}`)
    assert.ok(tituloAlertaOk(titulo)); assert.ok(blocos.length <= 60); paginas++
    const txt = JSON.stringify(blocos).replace(imp.premissa || '@@', ''); assert.ok(!/responsável|prazo (?:máximo|limite|final|de resposta|de retorno)|culpa|você deixou|falha sua|sob pena/i.test(txt), `${id}/${canal}`)   // a premissa do estoque fala do prazo de REPOSIÇÃO do fornecedor, não de prazo para o cliente
    assert.equal(blocos.filter(b => b.type === 'callout').length, 1); assert.equal(blocos[0].callout.color, 'red_background')
  }
  assert.ok(paginas > 100, `páginas auditadas: ${paginas}`)
  const aten = alertaParaBlocos({ item: 'preco_custo', rotulo: 'Preço', canal: 'geral', canal_rotulo: 'Todos os canais', gravidade: 'atencao', evidencia: 'x', impacto: impactos[0] }, { texto: { por_que_importa: 'a', efeito_se_atrasar: 'b', o_que_precisamos: 'c', o_que_fazemos: 'd' }, hoje: '2026-10-14', hora: '10:00' })
  assert.equal(aten[0].callout.color, 'orange_background'); assert.ok(!JSON.stringify(aten[0]).includes('Todos os canais'), 'canal «geral» não aparece no cabeçalho')
})

await ok('auditor barra antes de escrever: promessa no texto ou nome de analista → «bloqueado» (conteudo:<códigos>), ZERO chamada ao Notion, o trecho ofensivo nunca vai a log, banco ou aviso', async () => {
  const ruim = (extra = {}) => p => ({ rotulo: p.rotulo, canal_rotulo: p.canal_rotulo, por_que_importa: 'Resultado garantido e ranking alto no canal.', efeito_se_atrasar: 'Atraso.', o_que_precisamos: 'Preciso de algo.', o_que_fazemos: 'Fazemos.', ...extra })
  const m = montarAlerta({ explicar: ruim() }); m.estoque('Acme'); m.pronto('Acme'); m.ligar(); const r = await m.e.varrer()
  const l = uma(m); assert.deepEqual([r.bloqueados, l.estado, l.motivo], [1, 'bloqueado', 'conteudo:promessa']); assert.equal(escritas(m).length, 0); assert.equal(posts(m).length, 0)
  assert.ok(!/garantido|ranking/i.test(JSON.stringify([m.logs, l, m.notifs])), 'o trecho ofensivo não vai a log, banco nem aviso'); assert.ok(m.logs.some(x => /bloqueado conteudo promessa/.test(x)))
  await m.e.varrer(); assert.equal(m.linhas().length, 1, 'bloqueado não é reenviado sozinho')
  const a = montarAlerta({ explicar: ruim({ por_que_importa: 'Combinado com Giovanna Torres na semana passada.' }) }); a.estoque('Acme'); a.pronto('Acme'); a.ligar(); await a.e.varrer(); assert.equal(uma(a).motivo, 'conteudo:analista')
  assert.ok(!JSON.stringify([a.logs, uma(a)]).includes('Giovanna'))
})

// ═══ ENVIO MANUAL ════════════════════════════════════════════════════════════════════════════════════════════════════
await ok('manual: PRÉVIA lê o destino e mostra o texto, mas não grava nem escreve; confirmar é ESTRITO (=== true), exige por (líder/consultor), previa_id e a mesma pendência', async () => {
  const m = montarAlerta(); m.estoque('Acme'); m.pronto('Acme'); await m.e.varrer()                       // interruptor DESLIGADO: o manual funciona do mesmo jeito
  const antes = JSON.stringify(m.linhas()); m.w.limpar()
  const p = await m.e.enviar({ id: 1 })
  assert.deepEqual([p.ok, p.previa, p.acao, p.bloqueio, p.violacoes, p.avisos], [true, true, 'criar', null, [], []]); assert.match(p.previa_id, /^pv-[0-9a-f]{16}$/)
  assert.equal(p.titulo, `${PREFIXO_ALERTA}Estoque dos produtos que mais vendem (Mercado Livre) · 14/10/2026`); assert.deepEqual([p.destino.estado, p.destino.pagina_titulo], ['ok', 'Página de Acme']); assert.ok(p.destino.informacoes_url.startsWith('https://www.notion.so/'))
  assert.ok(p.linhas.includes('O que está pendente') && p.linhas.some(l => /^Receita possivelmente em risco/.test(l))); assert.equal(p.expira_em, new Date(m.relogio.ms + 15 * 60_000).toISOString())
  assert.equal(escritas(m).length, 0); assert.equal(JSON.stringify(m.linhas()), antes, 'a prévia não grava')
  for (const nao of ['true', 1, 'sim', {}, [], null, undefined]) { const x = await m.e.enviar({ id: 1, confirmar: nao, por, previa_id: p.previa_id }); assert.equal(x.previa, true, `confirmar=${JSON.stringify(nao)} é prévia`) }
  await falha(() => m.e.enviar({ id: 1, confirmar: true, previa_id: p.previa_id }), /informe "por"/)
  await falha(() => m.e.enviar({ id: 1, confirmar: true, por: 'Dani Nunes', previa_id: p.previa_id }), /somente líder ou consultor/, 403)
  await falha(() => m.e.enviar({ id: 1, confirmar: true, por }), /informe "previa_id"/)
  await falha(() => m.e.enviar({ id: 1, confirmar: true, por, previa_id: 'pv-inexistente' }), /prévia expirada — gere de novo/, 409)
  assert.equal(escritas(m).length, 0)
  const p2 = await m.e.enviar({ id: 1 }); await falha(() => m.e.enviar({ id: 1, confirmar: true, por, previa_id: p.previa_id }), /prévia expirada/, 409)        // a nova prévia substitui a anterior
  const r = await m.e.enviar({ id: 1, confirmar: true, por, previa_id: p2.previa_id })
  assert.deepEqual([r.ok, r.previa, r.estado], [true, false, 'enviado']); assert.match(r.url, /^https:\/\/www\.notion\.so\//); assert.equal(posts(m).length, 1)
  const l = uma(m); assert.deepEqual([l.estado, l.origem, l.por, l.titulo], ['enviado', 'manual', por, p.titulo])
  const dnv = await m.e.enviar({ id: 1 }); assert.deepEqual([dnv.ok, dnv.estado], [false, 'enviado']); assert.equal(dnv.url, r.url)
  assert.deepEqual(m.w.chamadasDe('POST', 'pages')[0].body.children.map(b => b.type).slice(0, 3), ['callout', 'heading_3', 'paragraph'])
})

await ok('manual: prévia expira em 15 min, o dia não pode ter mudado e a pendência não pode ter mudado; dois confirmar simultâneos → um passa, o outro 409', async () => {
  const m = montarAlerta({ cfg: { previa_ttl_min: 1200 } }); m.estoque('Acme', [{ id: 'MLB1' }]); m.pronto('Acme'); await m.e.varrer()
  const p = await m.e.enviar({ id: 1 }); m.relogio.avancarMin(14 * 60); m.mundo.bases.clear(); m.estoque('Acme', [{ id: 'MLB1' }])
  await falha(() => m.e.enviar({ id: 1, confirmar: true, por, previa_id: p.previa_id }), /o dia mudou desde a prévia/, 409)
  m.relogio.ir('2026-10-14', '10:00'); m.mundo.bases.clear(); m.estoque('Acme', [{ id: 'MLB1' }]); const p2 = await m.e.enviar({ id: 1 })
  m.mundo.bases.clear(); m.estoque('Acme', [{ id: 'MLB1' }, { id: 'MLB2', cobertura: 2 }])
  await falha(() => m.e.enviar({ id: 1, confirmar: true, por, previa_id: p2.previa_id }), /a pendência mudou desde a prévia/, 409)
  assert.equal(posts(m).length, 0)
  const t = montarAlerta(); t.estoque('Acme'); t.pronto('Acme'); await t.e.varrer(); const pt = await t.e.enviar({ id: 1 }); t.relogio.avancarMin(16); t.mundo.bases.clear(); t.estoque('Acme')
  await falha(() => t.e.enviar({ id: 1, confirmar: true, por, previa_id: pt.previa_id }), /prévia expirada/, 409)
  const c = montarAlerta(); c.estoque('Acme'); c.pronto('Acme'); await c.e.varrer(); const pc = await c.e.enviar({ id: 1 }); const orig = c.w.notion.req
  c.w.notion.req = async (cam, o) => { if (o?.method === 'POST' && cam === 'pages') await new Promise(r => setTimeout(r, 40)); return orig(cam, o) }
  const args = { id: 1, confirmar: true, por, previa_id: pc.previa_id }
  const [a, b] = await Promise.allSettled([c.e.enviar(args), c.e.enviar(args)])
  assert.equal([a, b].filter(x => x.status === 'fulfilled' && x.value.ok).length, 1); assert.equal([a, b].filter(x => x.status === 'rejected' && x.reason.status === 409).length, 1); assert.equal(posts(c).length, 1)
})

await ok('manual: o líder decide — ignora interruptor desligado, janela fechada e falta de liberação; NÃO ignora Ativo, relatório anterior, destino compartilhado, cooldown, teto e reconferência', async () => {
  const m = montarAlerta({ hoje: '2026-10-17', hora: '03:00' }); m.estoque('Acme'); m.relatorioEnviado('Acme'); await m.e.varrer()        // sábado 03:00, sem liberação, interruptor desligado
  assert.deepEqual([uma(m).estado, uma(m).motivo], ['pendente', 'interruptor_desligado']); const r = await confirmarManual(m, 1); assert.deepEqual([r.ok, r.estado], [true, 'enviado'])
  assert.match(uma(m).titulo, /· 17\/10\/2026$/)
  // sem relatório anterior
  const s = montarAlerta(); s.estoque('Acme'); s.liberar('Acme'); await s.e.varrer(); const ps = await s.e.enviar({ id: 1 }); assert.deepEqual([ps.ok, ps.estado], [false, 'sem_relatorio_anterior']); assert.match(ps.mensagem, /primeiro contato nunca é um alerta/)
  // destino compartilhado: o manual exige confirmar_destino:true e o título leva o cliente ao final
  const d = montarAlerta({ clientes: [['Par A', {}], ['Par B', {}]] }); const A = d.w.cfgCli.get('Par A'); d.estado.set('pagina_cliente:Par A', A.pagina_id); d.estado.set('pagina_cliente:Par B', A.pagina_id)
  d.estoque('Par A'); d.pronto('Par A'); await d.e.varrer(); const pd = await d.e.enviar({ id: 1 }); assert.deepEqual([pd.ok, pd.estado], [false, 'destino_compartilhado'])
  const pd2 = await d.e.enviar({ id: 1, confirmar_destino: true }); assert.equal(pd2.ok, true); assert.match(pd2.titulo, /· 14\/10\/2026 \(Par A\)$/); assert.ok(pd2.avisos.some(x => /compartilhada com outro cliente/.test(x)))
  assert.equal((await d.e.enviar({ id: 1, confirmar_destino: 'true' })).estado, 'destino_compartilhado', 'confirmar_destino também é estrito')
  const rd = await d.e.enviar({ id: 1, confirmar: true, por, previa_id: pd2.previa_id, confirmar_destino: true }); assert.equal(rd.estado, 'enviado'); assert.match(d.linhas()[0].titulo, /\(Par A\)$/)
  const v = await d.e.varrer(); assert.equal(v.enviados, 0, 'o automático nunca envia para destino compartilhado')
  // cooldown e reconferência continuam valendo no manual
  const c = mundoPronto(); await c.e.varrer(); c.mundo.bases.clear(); await c.e.varrer(); c.relogio.avancarMin(24 * 60); c.estoque('Acme', [{ id: 'MLB88' }]); await c.e.varrer()
  assert.equal(c.linhas().at(-1).estado, 'suprimido'); const pc = await c.e.enviar({ id: c.linhas().at(-1).id }); assert.deepEqual([pc.ok, pc.estado], [false, 'cooldown']); assert.match(pc.mensagem, /nos últimos 7 dias/)
  const rn = mundoPronto(); rn.e.agendador({ ligado: false, por }); await rn.e.varrer(); const pn = await rn.e.enviar({ id: 1 }); rn.reconf.estado = 'negativo'
  const x = await rn.e.enviar({ id: 1, confirmar: true, por, previa_id: pn.previa_id }); assert.deepEqual([x.ok, x.estado], [false, 'reconferencia_negativa']); assert.equal(uma(rn).estado, 'suprimido'); assert.equal(posts(rn).length, 0)
})

await ok('manual: página com o mesmo título → prévia «adotar» e confirmar «adotado» (zero criação); o teto semanal vale no manual; o sistema nunca cria a página duas vezes para o mesmo alerta', async () => {
  const m = mundoPronto(); m.e.agendador({ ligado: false, por }); await m.e.varrer(); const ds = m.w.cfgCli.get('Acme').ds_id
  m.w.paginasDs.get(ds).push({ id: 'a'.repeat(32), url: 'https://www.notion.so/' + 'a'.repeat(32), titulo: `${PREFIXO_ALERTA}Estoque dos produtos que mais vendem (Mercado Livre) · 14/10/2026`, created_time: '2026-10-14T12:00:00.000Z', archived: false })
  const p = await m.e.enviar({ id: 1 }); assert.deepEqual([p.acao], ['adotar']); const r = await m.e.enviar({ id: 1, confirmar: true, por, previa_id: p.previa_id })
  assert.deepEqual([r.ok, r.estado, r.url], [true, 'adotado', 'https://www.notion.so/' + 'a'.repeat(32)]); assert.equal(posts(m).length, 0); assert.deepEqual([uma(m).estado, uma(m).motivo], ['enviado', 'adotado'])
  // teto semanal: 3 páginas na semana → a 4ª espera, também no manual
  const t = mundoPronto(); t.e.agendador({ ligado: false, por }); t.tarefa({ cliente: 'Acme' }); t.mundo.contas.set('Acme', { erro: 'x', atualizado_em: t.iso() })
  t.pend.registrar({ cliente: 'Acme', item: 'verba_ads', canal: 'ml', detalhe: 'sem saldo', gravidade: 'critico', por, confirmar: true }); await t.e.varrer()
  for (const l of t.linhas().slice(0, 3)) assert.equal((await confirmarManual(t, l.id)).ok, true)
  const q = await t.e.enviar({ id: t.linhas()[3].id }); assert.deepEqual([q.ok, q.estado], [false, 'teto_semanal']); assert.equal(posts(t).length, 3)
})

await ok('manual: alerta resolvido/desconhecido/id inválido; violação do auditor aparece na prévia (com trecho) e o confirmar recusa sem escrever; sem eco do que foi enviado', async () => {
  const m = mundoPronto(); await m.e.varrer(); m.mundo.bases.clear(); await m.e.varrer()
  const rs = await m.e.enviar({ id: 1 }); assert.deepEqual([rs.ok, rs.estado], [false, 'resolvido'])
  for (const ruim of [undefined, 0, -1, 'abc', '1.5', 1.5, {}, [], null, '99999999999']) await falha(() => m.e.enviar({ id: ruim }), /informe "id" \(número do alerta\)/)
  const e = await falha(() => m.e.enviar({ id: 9999 }), /alerta não encontrado/, 404); assert.ok(!e.message.includes('9999'))
  const a = montarAlerta({ explicar: p => ({ rotulo: p.rotulo, canal_rotulo: p.canal_rotulo, por_que_importa: 'Combinado com Giovanna Torres e resultado garantido.', efeito_se_atrasar: 'Atraso.', o_que_precisamos: 'Algo.', o_que_fazemos: 'Fazemos.' }) })
  a.estoque('Acme'); a.pronto('Acme'); await a.e.varrer()
  const p = await a.e.enviar({ id: 1 }); assert.deepEqual([p.ok, p.acao, p.bloqueio.estado], [true, 'bloqueado', 'bloqueado']); assert.deepEqual(p.violacoes.map(v => v.codigo).sort(), ['analista', 'promessa']); assert.ok(p.violacoes.find(v => v.codigo === 'analista').trecho.includes('Giovanna'))
  const r = await a.e.enviar({ id: 1, confirmar: true, por, previa_id: p.previa_id }); assert.deepEqual([r.ok, r.estado, r.motivo], [false, 'bloqueado', 'conteudo']); assert.equal(escritas(a).length, 0); assert.ok(!JSON.stringify([r, a.logs]).includes('Giovanna'))
})

await ok('interruptor «alerta_auto»: nasce desligado (config só vale enquanto a chave nunca foi gravada); ligar/desligar exige boolean e por líder/consultor; fica em sync_estado; o aviso interno não depende dele', async () => {
  const m = montarAlerta(); assert.deepEqual(m.e.agendadorEstado(), { ligado: false })
  await falha(() => m.e.agendador({ ligado: 'true', por }), /informe "ligado"/); await falha(() => m.e.agendador({ por }), /informe "ligado"/)
  await falha(() => m.e.agendador({ ligado: true }), /informe "por"/); await falha(() => m.e.agendador({ ligado: true, por: 'Fulano' }), /somente líder ou consultor/, 403)
  assert.deepEqual(m.e.agendador({ ligado: true, por: '  giovanna TORRES ' }), { ok: true, ligado: true }); assert.equal(m.estado.get('alerta_auto'), 'ligado'); assert.match(m.estado.get('alerta_auto_por'), /^Giovanna Torres · 2026-10-14T/)
  assert.deepEqual(m.e.agendadorEstado(), { ligado: true }); m.e.agendador({ ligado: false, por }); assert.deepEqual(m.e.agendadorEstado(), { ligado: false })
  const c = montarAlerta({ cfg: { automatico_ligado: true } }); assert.equal(c.e.agendadorEstado().ligado, true, 'config vale enquanto a chave nunca foi gravada'); c.e.agendador({ ligado: false, por }); assert.equal(c.e.agendadorEstado().ligado, false)
  const d = montarAlerta(); d.estoque('Acme'); d.pronto('Acme'); await d.e.varrer(); assert.equal(d.notifs.length, 1, 'desligado, o aviso interno sai igual')
})

// ═══ LISTAGENS, ISOLAMENTO E ROBUSTEZ ════════════════════════════════════════════════════════════════════════════════
await ok('listagens: itens com o contrato (estado, motivo em texto fixo + código), isolamento por cliente, prospect/desconhecido = 404 sem eco, resumo de pendentes/enviados/bloqueados', async () => {
  const m = montarAlerta({ clientes: [['Acme', {}], ['Beta', {}]] }); m.estoque('Acme'); m.pronto('Acme'); m.estoque('Beta'); m.pronto('Beta'); m.tarefa({ cliente: 'Beta' }); m.ligar(); m.w.falhas.criar.push({ status: 403 })
  await m.e.varrer()
  const a = m.e.listarCliente('Acme'); assert.deepEqual(Object.keys(a), ['itens', 'automatico']); assert.deepEqual(a.automatico, { ligado: true }); assert.equal(a.itens.length, 1)
  assert.deepEqual(Object.keys(a.itens[0]), ['id', 'item', 'rotulo', 'canal', 'canal_rotulo', 'gravidade', 'estado', 'motivo', 'motivo_codigo', 'titulo', 'page_url', 'criado_em', 'enviado_em', 'resolvido_em', 'assinatura'])
  assert.deepEqual([a.itens[0].estado, a.itens[0].rotulo, a.itens[0].canal_rotulo, a.itens[0].gravidade, a.itens[0].motivo_codigo], ['bloqueado', 'Estoque dos produtos que mais vendem', 'Mercado Livre', 'critico', 'notion_403'])
  assert.match(a.itens[0].motivo, /não tem permissão para criar páginas/)
  const b = m.e.listarCliente('beta'); assert.deepEqual(b.itens.map(i => [i.item, i.estado]).sort(), [['documentos_conta', 'enviado'], ['estoque_curva_a', 'enviado']]); assert.ok(b.itens[0].id > b.itens[1].id, 'mais recente primeiro')
  assert.ok(b.itens.every(i => i.page_url.startsWith('https://www.notion.so/')))
  const pend = m.e.listarPendentes(); assert.deepEqual(pend.itens.map(i => [i.cliente, i.estado]), [['Acme', 'bloqueado']]); assert.deepEqual(pend.resumo, { pendentes: 0, enviados_7d: 2, bloqueados: 1 }); assert.deepEqual(pend.automatico, { ligado: true })
  for (const ruim of ['[Comercial] Empresa · 3', 'Fantasma Z9']) { const e = await falha(() => m.e.listarCliente(ruim), /cliente não encontrado na central/, 404); assert.ok(!e.message.includes('Z9') && !e.message.includes('Empresa')) }
  await falha(() => m.e.listarCliente(''), /informe "cliente"/)
})

await ok('isolamento: o alerta de um cliente escreve só na base dele e usa só as pendências dele', async () => {
  const m = mundoPronto({ clientes: [['Acme', {}], ['Beta', {}]] }); m.mundo.bases.delete('Beta'); await m.e.varrer()
  assert.equal(m.linhas().length, 1); assert.equal(m.linhas()[0].cliente, 'Acme'); assert.equal(m.w.paginasVivas(m.w.cfgCli.get('Acme').ds_id).length, 1); assert.equal(m.w.paginasVivas(m.w.cfgCli.get('Beta').ds_id).length, 0)
  assert.ok(posts(m).every(p => p.body.parent.data_source_id === m.w.cfgCli.get('Acme').ds_id))
})

await ok('robustez da varredura: duas ao mesmo tempo (a 2ª sai), erro de avaliação de um cliente não derruba os outros (sem eco no log), prospect e itens inválidos na lista de elegíveis são ignorados', async () => {
  const clientes = [['Acme', {}], ['Quebra', {}], ['Beta', {}]]
  const m = montarAlerta({ clientes, avaliar: (c, orig) => { if (c === 'Quebra') throw new Error('estourou "SEGREDO-XYZ"'); return orig(c) },
    elegiveis: () => [...clientes.map(([c]) => ({ cliente: c, status: 'Ativo' })), { cliente: '[Comercial] X', status: 'Ativo' }, { cliente: 5, status: 'Ativo' }, null, 'Acme', { cliente: '  ', status: 'Ativo' }] })
  for (const [c] of clientes) m.estoque(c)
  const [x, y] = await Promise.all([m.e.varrer(), m.e.varrer()]); assert.deepEqual([x.pulou, y.pulou].sort(), ['', 'em_andamento'])
  const r = x.pulou ? y : x; assert.deepEqual([r.avaliados, r.falhas_avaliacao, r.novos], [2, 1, 2]); assert.deepEqual(m.linhas().map(l => l.cliente), ['Acme', 'Beta'])
  assert.ok(m.logs.some(l => /alertas Quebra: avaliação Error: estourou …/.test(l))); assert.ok(!m.logs.join('\n').includes('SEGREDO-XYZ'))
  assert.equal((await m.e.varrer()).falhas_avaliacao, 1, 'a próxima varredura tenta de novo')
})

await ok('reconferência (decisão pura): estoque relê até 3 anúncios (os críticos primeiro) e recalcula a cobertura; tarefa, conta e registro; leitura que falta = indisponível, nunca «negativo» por engano', async () => {
  const handle = new Database(':memory:'); handle.exec(SCHEMA_PENDENCIAS)
  const vivo = {}, status = {}, lidos = [], estado = { conta: 'erro' }
  const rec = criarReconferencia({ handle, estoqueAoVivo: async (c, ids) => { lidos.push(ids); return new Map(ids.filter(i => vivo[i]).map(i => [i, vivo[i]])) },
    statusTarefasAoVivo: async ids => new Map(ids.filter(i => status[i]).map(i => [i, status[i]])), contaAoVivo: async () => estado.conta, limiares: { cobertura_critica_dias: 5, cobertura_atencao_dias: 10, curvas_alerta: ['A'] } })
  const an = (id, curva, cobertura_dias, vendas_dia) => ({ id, curva, cobertura_dias, vendas_dia, estoque: 1 })
  const p = { fonte: 'medido', item: 'estoque_curva_a', anuncios: [an('B1', 'B', 8, 1), an('A1', 'A', 3, 2), an('A2', 'A', 2, 5), an('A3', 'A', 4, 1), an('A4', 'A', 1, 1)] }
  vivo.A1 = { disponivel: 4, status: 'active' }                                              // 4 un / 2 por dia = 2 dias < 5
  assert.deepEqual(await rec('Acme', p, { ids: [] }), { estado: 'confirmado' }); assert.deepEqual(lidos[0], ['A1', 'A2', 'A3'], 'até 3, os críticos (curva A < 5 dias) primeiro, na ordem de receita')
  vivo.A1 = { disponivel: 40, status: 'active' }; vivo.A2 = { disponivel: 100, status: 'active' }; vivo.A3 = { disponivel: 50, status: 'active' }
  assert.deepEqual(await rec('Acme', p, {}), { estado: 'negativo', motivo: 'estoque_normalizado' })
  vivo.A1 = { disponivel: 0, status: 'closed' }; assert.equal((await rec('Acme', p, {})).estado, 'negativo', 'anúncio encerrado não confirma ruptura')
  vivo.A1 = { disponivel: 0, status: 'paused' }; assert.equal((await rec('Acme', p, {})).estado, 'confirmado', 'pausado com 0 é ruptura')
  for (const k of Object.keys(vivo)) delete vivo[k]; assert.deepEqual(await rec('Acme', p, {}), { estado: 'indisponivel', motivo: 'sem_leitura' })
  vivo.A1 = { disponivel: null, status: 'active' }; assert.equal((await rec('Acme', p, {})).estado, 'indisponivel', 'disponível ausente não é zero')
  assert.equal((await rec('Acme', { ...p, anuncios: [] }, {})).estado, 'indisponivel'); assert.equal((await rec('Acme', { fonte: 'medido', item: 'estoque_curva_a' }, {})).estado, 'indisponivel')
  const t = { fonte: 'tarefa', item: 'documentos_conta' }
  status.t1 = 'concluida'; assert.deepEqual(await rec('Acme', t, { ids: ['t1', 't2'] }), { estado: 'negativo', motivo: 'tarefa_fora_da_dependencia' })
  status.t2 = 'dependencia_cliente'; assert.equal((await rec('Acme', t, { ids: ['t1', 't2'] })).estado, 'confirmado'); assert.equal((await rec('Acme', t, { ids: ['t9'] })).estado, 'indisponivel')
  assert.equal((await rec('Acme', t, { ids: [] })).estado, 'indisponivel')
  const c = { fonte: 'medido', item: 'acesso_conta' }; assert.equal((await rec('Acme', c, {})).estado, 'confirmado'); estado.conta = 'ok'; assert.deepEqual(await rec('Acme', c, {}), { estado: 'negativo', motivo: 'conta_respondeu' })
  const id = handle.prepare("INSERT INTO pendencia_cliente (cliente, canal, item, por, criada_em) VALUES ('Acme', 'ml', 'verba_ads', 'x', 'y')").run().lastInsertRowid
  const r = { fonte: 'registro' }; assert.equal((await rec('Acme', r, { ids: [`r${id}`] })).estado, 'confirmado'); assert.equal((await rec('Beta', r, { ids: [`r${id}`] })).estado, 'negativo', 'registro de outro cliente não confirma')
  handle.prepare("UPDATE pendencia_cliente SET resolvida_em = 'z'").run(); assert.deepEqual(await rec('Acme', r, { ids: [`r${id}`] }), { estado: 'negativo', motivo: 'registro_resolvido' })
  assert.equal((await rec('Acme', { fonte: 'medido', item: 'outro' }, {})).estado, 'indisponivel')
})

await ok('relógio no fuso de São Paulo: janela, dia do título e data do envio idênticos em qualquer TZ da máquina (UTC, Auckland, Tóquio, Los Angeles); fuso inválido derruba a carga', async () => {
  assert.deepEqual(await rodarFuso(), ESPERADO_FUSO.concat(['manual enviado 14/10/2026']), 'no TZ deste processo')
  for (const tz of ['UTC', 'America/Sao_Paulo', 'Pacific/Auckland', 'Asia/Tokyo', 'America/Los_Angeles']) {
    const o = execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--fuso'], { env: { ...process.env, TZ: tz }, encoding: 'utf8' }).trim().split('\n')
    assert.deepEqual(o, ESPERADO_FUSO.concat(['manual enviado 14/10/2026']), `TZ=${tz}`)
  }
  for (const ruim of ['Marte/Olimpo', '', 5, undefined, null]) assert.throws(() => validarConfig({ ...lerConfig(), fuso: ruim }), /config\/alerta-cliente\.json: "fuso"/, String(ruim))
})

console.log(`\n${n} verificações do alerta ok.`)
