// Fiação REAL do progresso (F4, 21/10/2026): monta o contexto de src/lib/progresso-cliente.js (puro) com números que já existem — nenhuma tabela nova,
// nenhuma escrita. Lê: clientes_central (status, CS, canais, notificação), sync_estado (fonte_descoberta, ultimo_sync, medicao_em, gatilhos_ligado),
// meli_contas, meli_coleta_dia, custos-db.resumoCustos (custo ÷ receita), lead_time_cliente, perfil_cliente.catalogo_proprio, acoes_plano, tarefas
// (cards «· PS-»), exec_ordem, tarefa_dependencia + pendencia_cliente, aprendizado, gatilho_lote, feedback_relatorio e a listagem do relatório ao Notion
// (relatorios.listar(), injetada). Chave do Chaveiro: config/chaveiro.json como o servidor carregou. Integração ML de fato = gatilhos-real.integracaoMlReal.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { db, getEstado, agora } from './db.js'
import { ROOT } from './env.js'
import { resolverEscopo, normNome } from './equipe.js'
import { ABERTA_SQL } from './status-tarefa.js'
import { lerConfig as lerGatilhos, notificacaoDe } from './gatilhos.js'
import { integracaoMlReal } from './gatilhos-real.js'
import { resumoCustos } from './custos-db.js'
import { dataNoFuso, horaNoFuso } from './relatorio-envio.js'
import { progressoCliente, progressoCarteira, diasUteis, LIMIARES as L } from './progresso-cliente.js'

const CHAVEIRO = (() => { try { return JSON.parse(readFileSync(join(ROOT, 'config', 'chaveiro.json'), 'utf-8')) } catch { return {} } })()   // o carregado no início (como estrutura-estado-real)
const Q = {}
const q = (k, sql) => Q[k] ??= db.prepare(sql)            // preparo tardio: as tabelas de outros módulos (exec_ordem, aprendizado…) já existem quando a 1ª leitura acontece
const tenta = (fn, padrao) => { try { return fn() } catch { return padrao } }
const addDias = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const diasAte = (iso, hoje) => /^\d{4}-\d{2}-\d{2}/.test(iso || '') ? Math.max(0, Math.round((Date.parse(hoje + 'T12:00:00Z') - Date.parse(iso.slice(0, 10) + 'T12:00:00Z')) / 864e5)) : null
const segundaDa = iso => { const d = new Date(`${iso}T12:00:00Z`); return addDias(iso, -((d.getUTCDay() + 6) % 7)) }

// contexto de UM cliente (nome canônico da central). relatorio = item de relatorios.listar() para este cliente (ou null = não lido)
export function contextoCliente(cliente, { relatorio = null, cfgGatilhos = null, agoraIso = agora() } = {}) {
  const cfg = cfgGatilhos || lerGatilhos()
  const central = q('central', 'SELECT status_cs, cs_responsavel, canais_json, notificacao_json, tier FROM clientes_central WHERE cliente = ?').get(cliente) || {}
  const notif = notificacaoDe(central.notificacao_json, cfg), fuso = notif.fuso
  const hoje = dataNoFuso(Date.parse(agoraIso), fuso), hora = horaNoFuso(Date.parse(agoraIso), fuso)
  const canais = tenta(() => JSON.parse(central.canais_json || '[]'), [])
  // 1 cadastrado
  const temTarefa = !!q('temTarefa', 'SELECT 1 FROM tarefas WHERE cliente = ? AND arquivada = 0 LIMIT 1').get(cliente)
  const quadro = !!getEstado(`fonte_descoberta:${cliente}`) || temTarefa
  const conhecido = [q('minSync', 'SELECT MIN(sync_em) m FROM tarefas WHERE cliente = ?').get(cliente)?.m, tenta(() => q('minLivro', 'SELECT MIN(registrado_em) m FROM registro_cliente WHERE cliente = ?').get(cliente)?.m, '')].filter(Boolean).sort()[0] || ''
  // 2 conectado
  const conta = q('conta', 'SELECT erro, conectado_em, atualizado_em FROM meli_contas WHERE cliente = ?').get(cliente) || null
  const ml = { conectado: !!conta, erro: conta?.erro || '', conectado_em: conta?.conectado_em || '', atualizado_em: conta?.atualizado_em || '', canal: canais.includes('ML') }
  const conectadoOk = !!conta && !conta.erro
  // 3 coletado
  const coletaEm = conta ? (q('coletaEm', 'SELECT MAX(coletado_em) m FROM meli_coleta_dia WHERE cliente = ?').get(cliente)?.m || '') : ''
  const diasColetados = conta ? q('diasCol', 'SELECT COUNT(DISTINCT dia) n FROM meli_coleta_dia WHERE cliente = ? AND dia >= ? AND dia <= ?').get(cliente, addDias(hoje, -28), addDias(hoje, -1)).n : null
  const coleta = { em: coletaEm, sync_em: getEstado('ultimo_sync') || '', lacunas: coletaEm && diasColetados != null ? Math.max(0, 28 - diasColetados) : null }
  // 4 dados da empresa
  let custo = null, custoMotivo = ''
  if (conectadoOk) { const r = tenta(() => resumoCustos(cliente), null); custo = r?.efetivo?.cobertura_receita_pct ?? null; custoMotivo = r ? (r.reconciliacao_motivo || (custo == null ? 'anúncios sem faturamento em 30 d' : '')) : 'custos não lidos' }
  const empresa = { custo_pct: custo, custo_motivo: custoMotivo, lead_time: !!tenta(() => q('lead', 'SELECT 1 FROM lead_time_cliente WHERE cliente = ? LIMIT 1').get(cliente), null), catalogo: tenta(() => q('cat', 'SELECT catalogo_proprio c FROM perfil_cliente WHERE cliente = ?').get(cliente)?.c, null) != null }
  // 5 plano
  const ac = q('acoes', "SELECT MAX(criado_em) g, SUM(status = 'proposta') p, SUM(status IN ('aprovada','distribuida')) a, SUM(status = 'distribuida') d, COUNT(*) t FROM acoes_plano WHERE cliente = ?").get(cliente)
  const integ = conectadoOk ? tenta(() => integracaoMlReal(cliente), { ok: false, motivo: 'sem_conexao_ml' }) : null
  const plano = { diagnostico: !conectadoOk ? 'sem_ml' : integ.ok ? 'disponivel' : 'indisponivel', diagnostico_motivo: integ?.motivo || '', gerado_em: ac?.g || '', propostas: ac?.p || 0 }
  // 6 aprovado
  const p01 = q('p01', "SELECT criado_em FROM acoes_plano WHERE cliente = ? AND status = 'proposta' AND json_extract(dados_json, '$.prioridade.p') IN ('P0','P1')").all(cliente).map(r => diasUteis(r.criado_em, hoje) ?? 0)
  const decisao = { p01_sem_decisao: p01.length, p01_dias_uteis_max: p01.length ? Math.max(...p01) : 0, p01_atrasadas: p01.filter(d => d > L.decisao_dias_uteis).length, aprovadas: ac?.a || 0, total: ac?.t || 0 }
  // 7 distribuído
  const apr = q('aprovadas', "SELECT COUNT(*) n, MIN(atualizado_em) m, SUM(atualizado_em < ?) paradas FROM acoes_plano WHERE cliente = ? AND status = 'aprovada'").get(addDias(hoje, -L.distribuir_dias) + 'T00:00:00', cliente)
  const cards = q('cards', "SELECT COUNT(*) n, SUM(" + ABERTA_SQL + ") abertos FROM tarefas WHERE cliente = ? AND arquivada = 0 AND titulo LIKE '%· PS-%'").get(cliente)
  const tarefasN = q('tarefasN', 'SELECT COUNT(*) n FROM tarefas WHERE cliente = ? AND arquivada = 0').get(cliente).n
  const distribuicao = { aprovadas_nao_distribuidas: apr.n, aprovadas_paradas: apr.paradas || 0, aprovadas_dias_max: apr.paradas ? diasAte(apr.m, hoje) : 0, distribuidas: ac?.d || 0, cards_ps: cards.n, tarefas: tarefasN }
  // 8 executado
  const parados = q('parados', "SELECT COUNT(*) n, MIN(last_edited) m FROM tarefas WHERE cliente = ? AND arquivada = 0 AND titulo LIKE '%· PS-%' AND " + ABERTA_SQL + ' AND last_edited < ?').get(cliente, addDias(hoje, -L.card_parado_dias) + 'T00:00:00')
  const ordens = tenta(() => q('ordens', 'SELECT estado, COUNT(*) n FROM exec_ordem WHERE cliente = ? GROUP BY estado').all(cliente), [])
  const nOrd = e => ordens.find(o => o.estado === e)?.n || 0
  const pend = [
    ...tenta(() => q('depTar', "SELECT COALESCE(NULLIF(d.em, ''), t.last_edited) desde FROM tarefas t LEFT JOIN tarefa_dependencia d ON d.tarefa_id = t.id WHERE t.cliente = ? AND t.arquivada = 0 AND t.status = 'dependencia_cliente'").all(cliente), []),
    ...tenta(() => q('pendMan', "SELECT COALESCE(NULLIF(desde, ''), criada_em) desde FROM pendencia_cliente WHERE cliente = ? AND resolvida_em = ''").all(cliente), []),
  ].map(r => diasAte(r.desde, hoje)).filter(d => d != null)
  const execucao = { cards_ps: cards.n, cards_abertos: cards.abertos || 0, cards_parados: parados.n, cards_dias_max: parados.n ? diasAte(parados.m, hoje) : 0, ordens: ordens.reduce((s, o) => s + o.n, 0), ordens_conferidas: nOrd('executada'), ordens_divergentes: nOrd('divergente'),
    pendencias: pend.length, pendencias_14: pend.filter(d => d >= L.pendencia_atencao_dias).length, pendencias_30: pend.filter(d => d >= L.pendencia_revisar_dias).length, pendencias_dias_max: pend.length ? Math.max(...pend) : 0, chaveiro_ligado: CHAVEIRO.execucao_ligada === true }
  // 9 medido — distribuídas cujo card concluiu (sufixo « · PS-id» no título) sem linha em aprendizado
  const concl = tenta(() => q('concl', "SELECT t.data_conclusao dc FROM acoes_plano a JOIN (SELECT trim(substr(titulo, instr(titulo, 'PS-'))) pid, data_conclusao FROM tarefas WHERE cliente = ? AND arquivada = 0 AND status = 'concluida' AND titulo LIKE '%· PS-%' AND data_conclusao IS NOT NULL AND data_conclusao <> '') t ON t.pid = a.id WHERE a.cliente = ? AND a.status = 'distribuida' AND NOT EXISTS (SELECT 1 FROM aprendizado p WHERE p.acao_id = a.id)").all(cliente, cliente), [])
  const idades = concl.map(r => diasAte(r.dc, hoje)).filter(d => d != null), velhas = idades.filter(d => d > L.medida_carencia_dias)
  const medicao = { medidas: tenta(() => q('medidas', 'SELECT COUNT(*) n FROM aprendizado WHERE cliente = ?').get(cliente).n, 0), medicao_em: getEstado('medicao_em') || '', sem_medida: velhas.length, sem_medida_dias_max: velhas.length ? Math.max(...velhas) : 0, em_janela: idades.length - velhas.length }
  // 10 comunicado
  const seg = segundaDa(hoje), lote = tenta(() => q('lote', "SELECT estado FROM gatilho_lote WHERE cliente = ? AND tipo = 'semanal' AND dia >= ? AND dia <= ? ORDER BY rowid DESC LIMIT 1").get(cliente, seg, addDias(seg, 6)), null)
  const comunicacao = { chave_ligada: getEstado('gatilhos_ligado') === 'ligado', inicio_envios: cfg.inicio_envios || '', elegivel: !!integ?.ok, motivo_inelegivel: integ ? integ.motivo : 'sem_conexao_ml', liberado: !!notif.liberado_por, recibo_semana: lote?.estado || '',
    relatorio: relatorio ? { situacao: relatorio.situacao, situacao_rotulo: relatorio.situacao_rotulo, frequencia: relatorio.frequencia } : null,
    resposta_14d: !!tenta(() => q('resp', 'SELECT 1 FROM feedback_relatorio WHERE cliente = ? AND recebido_em >= ? LIMIT 1').get(cliente, addDias(hoje, -L.resposta_dias)), null) }
  return { cliente, agora: agoraIso, hoje, hora, ativo: central.status_cs === 'Ativo', quadro, cs: central.cs_responsavel || '', conhecido_desde: conhecido, ml, coleta, empresa, plano, decisao, distribuicao, execucao, medicao, comunicacao }
}

// deps: relatorios = criarRelatorioEnvio(...) do server (listar() → { itens[] }); sem ele o relatório sai «não lido»
export function criarProgressoReal({ relatorios = null } = {}) {
  const relatorioDe = () => { const m = new Map(); for (const i of tenta(() => relatorios?.listar()?.itens, null) || []) m.set(normNome(i.cliente).trim(), i); return c => m.get(normNome(c).trim()) || null }
  return {
    cliente(c) { const cfg = lerGatilhos(); return progressoCliente(contextoCliente(c, { relatorio: relatorioDe()(c), cfgGatilhos: cfg })) },
    // escopo = { tipo, clientes, consultor, squad } de equipe.resolverEscopo; no 'total' entram também os Ativos ainda sem quadro (ignorados «sem tarefa sincronizada»):
    // é exatamente a população parada na etapa 1, que o escopo dos planos esconde
    carteira(escopo = {}) {
      const e = resolverEscopo({ tipo: escopo.tipo || 'total', clientes: escopo.clientes || [], consultor: escopo.consultor || '', squad: escopo.squad || '' })
      if (e.erro) throw Object.assign(new Error(e.erro), { status: 400 })
      const nomes = [...e.clientes]
      if ((escopo.tipo || 'total') === 'total') for (const i of e.ignorados) if (!/^status/.test(i.motivo)) nomes.push(i.cliente)
      const cfg = lerGatilhos(), rel = relatorioDe(), agoraIso = agora()
      const r = progressoCarteira(nomes.map(c => contextoCliente(c, { relatorio: rel(c), cfgGatilhos: cfg, agoraIso })), { hoje: dataNoFuso(Date.parse(agoraIso)) })
      return { ...r, escopo: { tipo: e.tipo, consultor: e.consultor, squad: e.squad, sem_quadro: nomes.length - e.clientes.length } }
    },
  }
}
