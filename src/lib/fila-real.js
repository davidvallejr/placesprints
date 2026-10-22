// Fiação REAL da fila do dia (F5, 21/10/2026): lê as tabelas que já existem e entrega as listas a src/lib/fila.js (puro). NENHUMA escrita, nenhuma tabela nova.
// Lê: meli_contas (+ arquivo), sync_estado, custos-db.resumoCustos, lead_time_cliente, acoes_plano, exec_ordem, exec_liberacao, tarefas (+ Eisenhower para o analista),
// tarefa_dependencia + pendencia_cliente (+ aba «Do cliente» para a chave do lembrete), gatilho_lote, relatorio_envio, feedback_relatorio, risco_cliente, incidente,
// aprendizado, meli_item_mudanca × preco_decisao, clientes_central, consultor_aviso; estado das estruturas (F3) e progresso da carteira (F4) vêm injetados.
// Escopo: consultor pelo MESMO resolverEscopo de /planos; CS por clientes_central.cs_responsavel; analista pelas tarefas com responsável = nome; dono/líder/técnico = tudo.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { db, getEstado, agora as agoraIso, hojeLocal } from './db.js'
import { ROOT } from './env.js'
import { resolverEscopo, carregarClientes, listarEquipe, normNome } from './equipe.js'
import { ABERTA_SQL } from './status-tarefa.js'
import { resumoCustos } from './custos-db.js'
import { classificarTarefa } from './eisenhower.js'
import { lerConfig as lerGatilhos, notificacaoDe } from './gatilhos.js'
import { integracaoMlReal } from './gatilhos-real.js'
import { montarFila, PAPEIS } from './fila.js'

const ALG = (() => { try { return JSON.parse(readFileSync(join(ROOT, 'config', 'algoritmo.json'), 'utf-8')) } catch { return {} } })()
const REGRAS_CONSULTOR = Array.isArray(ALG.foco?.regras_exigem_consultor) ? ALG.foco.regras_exigem_consultor : []
const Q = {}
const q = (k, sql) => Q[k] ??= db.prepare(sql)            // preparo tardio: tabelas de outros módulos já existem na 1ª leitura
const tenta = (fn, padrao) => { try { return fn() } catch { return padrao } }
const addDias = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const diasAte = (iso, hoje) => /^\d{4}-\d{2}-\d{2}/.test(iso || '') ? Math.max(0, Math.round((Date.parse(hoje + 'T12:00:00Z') - Date.parse(iso.slice(0, 10) + 'T12:00:00Z')) / 864e5)) : null
const segundaDa = iso => { const d = new Date(`${iso}T12:00:00Z`); return addDias(iso, -((d.getUTCDay() + 6) % 7)) }
const MAX_ABA = 25                                        // ponytail: aba.ler roda o avaliador inteiro por cliente; só os com pendência ≥ 14 d, até 25 por leitura

// escopo por papel → { clientes: [...] | null (todos), motivo }
function escopoDe(papel, quem) {
  if (papel === 'consultor') { const e = resolverEscopo({ tipo: 'consultor', consultor: quem }); return { clientes: e.erro ? [] : e.clientes, motivo: e.erro || '' } }
  if (papel === 'cs') { const n = normNome(quem).trim(); return n ? { clientes: carregarClientes().filter(c => normNome(c.cs_responsavel).trim() === n).map(c => c.cliente), motivo: '' } : { clientes: [], motivo: 'informe o nome do CS («Quem sou»)' } }
  if (papel === 'analista') { const n = normNome(quem).trim(); return n ? { clientes: [...new Set(tarefasDoAnalista(n).map(t => t.cliente))], motivo: '' } : { clientes: [], motivo: 'informe o nome do analista («Quem sou»)' } }
  return { clientes: null, motivo: '' }
}
const tarefasDoAnalista = n => q('tarAn', `SELECT id, cliente, titulo, responsavel, status, last_edited, prazo, url, tipo_demanda, data_inicio, data_conclusao FROM tarefas WHERE arquivada = 0 AND responsavel <> '' AND ${ABERTA_SQL}`).all().filter(t => normNome(t.responsavel).trim() === n)

// deps: estrutura() → montarEstrutura(...) (F3) · progresso.carteira(escopo) (F4) · aba.ler(cliente) (aba «Do cliente») — todos opcionais: sem eles a fonte sai «não lida»
export function criarFilaReal({ estrutura = null, progresso = null, aba = null } = {}) {
  function fontes(papel, quem, escopo, hoje, agora) {
    const cfg = lerGatilhos(), dentro = c => !escopo || escopo.includes(c)
    const central = q('central', 'SELECT cliente, status_cs, cs_responsavel, notificacao_json, vencimentos_json FROM clientes_central').all()
    const ativos = central.filter(c => c.status_cs === 'Ativo')
    const contas = q('contas', 'SELECT cliente, erro, conectado_em FROM meli_contas').all()
    const comConta = new Set(contas.map(c => c.cliente))
    const arquivadas = new Set(tenta(() => q('arq', 'SELECT cliente, linha_json FROM meli_contas_arquivo ORDER BY id DESC').all(), []).filter(r => tenta(() => !JSON.parse(r.linha_json).erro, false)).map(r => r.cliente))
    const F = {}
    F.contas = [...contas.filter(c => c.erro).map(c => ({ cliente: c.cliente, erro: c.erro, conectado_em: c.conectado_em, restauravel: false })),
      ...ativos.filter(c => !comConta.has(c.cliente) && arquivadas.has(c.cliente)).map(c => ({ cliente: c.cliente, erro: 'desconectada; conexão guardada', conectado_em: '', restauravel: true }))]
    F.coleta = { coleta_em: getEstado('coleta_ml_em') || '', sync_em: getEstado('ultimo_sync') || '', medicao_em: getEstado('medicao_em') || '' }
    // dados da empresa: custo ÷ receita (custos-db) + prazo do fornecedor, só para contas vivas no escopo
    F.empresa = contas.filter(c => !c.erro && dentro(c.cliente)).map(c => { const r = tenta(() => resumoCustos(c.cliente), null); return { cliente: c.cliente, conectado_em: c.conectado_em, custo_pct: r?.efetivo?.cobertura_receita_pct ?? null, lead_time: !!tenta(() => q('lead', 'SELECT 1 FROM lead_time_cliente WHERE cliente = ? LIMIT 1').get(c.cliente), null) } })
    F.acoes = q('acoes', "SELECT id, cliente, regra, titulo, status, json_extract(dados_json, '$.prioridade.p') p, criado_em, atualizado_em FROM acoes_plano WHERE status IN ('proposta','aprovada')").all().filter(a => dentro(a.cliente))
    F.ordens = tenta(() => q('ordens', "SELECT id, cliente, operacao, estado, criado_em, regra FROM exec_ordem WHERE estado IN ('aguardando_aprovacao','divergente','falhou')").all(), null)?.filter(o => dentro(o.cliente)) ?? null
    F.vetos = tenta(() => q('vetos', "SELECT cliente, operacao, veto_ate FROM exec_liberacao WHERE ampliacao_proposta_em <> '' AND vetado_em = '' AND veto_ate > ?").all(agora), null)?.filter(v => dentro(v.cliente)) ?? null
    F.cards = papel === 'analista'
      ? tarefasDoAnalista(normNome(quem).trim()).map(t => ({ ...t, ps: /· PS-/.test(t.titulo), quadrante: tenta(() => classificarTarefa(t, { hoje })?.quadrante, null) }))
      : q('cards', `SELECT id, cliente, titulo, responsavel, status, last_edited, prazo, url FROM tarefas WHERE arquivada = 0 AND titulo LIKE '%· PS-%' AND ${ABERTA_SQL}`).all().filter(t => dentro(t.cliente)).map(t => ({ ...t, ps: true }))
    // pendências do cliente: leitura barata (tarefas em dependência + registro manual) e, para quem passou de 14 d, a chave do lembrete pela aba «Do cliente»
    const baratas = [
      ...tenta(() => q('depTar', "SELECT t.cliente, t.titulo, COALESCE(NULLIF(d.em, ''), t.last_edited) desde FROM tarefas t LEFT JOIN tarefa_dependencia d ON d.tarefa_id = t.id WHERE t.cliente <> '' AND t.arquivada = 0 AND t.status = 'dependencia_cliente'").all(), []),
      ...tenta(() => q('pendMan', "SELECT cliente, item titulo, COALESCE(NULLIF(desde, ''), criada_em) desde FROM pendencia_cliente WHERE resolvida_em = ''").all(), []),
    ].filter(p => dentro(p.cliente)).map(p => ({ cliente: p.cliente, titulo: p.titulo, dias: diasAte(p.desde, hoje), chave: '' }))
    const vencidos = [...new Set(baratas.filter(p => (p.dias ?? 0) >= 14).map(p => p.cliente))].slice(0, MAX_ABA)
    F.dependencias = baratas
    if (aba) for (const c of vencidos) {
      const itens = tenta(() => aba.ler(c)?.itens, null); if (!itens) continue
      F.dependencias = F.dependencias.filter(p => p.cliente !== c).concat(itens.filter(i => (i.dias ?? 0) >= 14).map(i => ({ cliente: c, titulo: i.titulo, dias: i.dias, chave: i.chave, o_que_precisamos: i.o_que_precisamos || '' })))
    }
    const sete = addDias(hoje, -7), quatorze = addDias(hoje, -14)
    F.lotes = tenta(() => q('lotes', 'SELECT cliente, tipo, dia, estado, motivo, criado_em FROM gatilho_lote WHERE criado_em >= ?').all(sete), null)?.filter(l => dentro(l.cliente)) ?? null
    F.relatorios = tenta(() => q('rel', 'SELECT cliente, estado, motivo, em FROM relatorio_envio WHERE em >= ?').all(sete), null)?.filter(r => dentro(r.cliente)) ?? null
    F.respostas = tenta(() => q('resp', "SELECT cliente, recebido_em, temas_json, status, autor_nome FROM feedback_relatorio WHERE recebido_em >= ? AND status <> 'descartado'").all(quatorze), null)?.filter(r => dentro(r.cliente)).map(r => ({ cliente: r.cliente, recebido_em: r.recebido_em, status: r.status, autor_nome: r.autor_nome, temas: tenta(() => JSON.parse(r.temas_json || '[]'), []), dias: diasAte(r.recebido_em, hoje) })) ?? null
    F.riscos = tenta(() => q('risco', "SELECT cliente, motivo, desde FROM risco_cliente WHERE estado = 'aberto'").all(), null)?.filter(r => dentro(r.cliente)) ?? null
    F.incidentes = tenta(() => q('inc', "SELECT id, sinal_id, rotulo, nivel, dono, sla_ate, aberto_em, valor, sistema FROM incidente WHERE estado = 'aberto'").all(), null)
    F.estruturas = estrutura ? tenta(() => estrutura().linhas, null) : null
    // elegíveis ao plano de terça sem liberação: Ativo + conta viva + integração de fato (gatilhos-real) + sem liberado_por
    F.nao_liberados = ativos.filter(c => comConta.has(c.cliente) && dentro(c.cliente) && !notificacaoDe(c.notificacao_json, cfg).liberado_por && tenta(() => integracaoMlReal(c.cliente).ok, false)).map(c => ({ cliente: c.cliente, motivo: 'sem liberação do líder' }))
    F.medidas = tenta(() => q('med', 'SELECT acao_id, cliente, regra, resolveu, medido_em FROM aprendizado WHERE medido_em >= ?').all(addDias(hoje, -2)), null)?.filter(m => dentro(m.cliente)) ?? null
    F.precos = tenta(() => q('precos', "SELECT m.cliente, m.item_id, m.dia, m.variacao_pct, i.titulo FROM meli_item_mudanca m LEFT JOIN meli_item i ON i.cliente = m.cliente AND i.item_id = m.item_id LEFT JOIN preco_decisao d ON d.cliente = m.cliente AND d.ref = 'ml:' || m.item_id || ':' || m.dia WHERE m.campo = 'preco' AND m.fonte <> 'chaveiro' AND m.dia >= ? AND d.ref IS NULL ORDER BY m.dia DESC LIMIT 200").all(addDias(hoje, -28)), null)?.filter(p => dentro(p.cliente)).map(p => ({ ...p, variacao_pct: p.variacao_pct == null ? null : Math.round(p.variacao_pct * 10) / 10 })) ?? null
    F.clientes = ativos.filter(c => dentro(c.cliente)).map(c => ({ cliente: c.cliente, cs: c.cs_responsavel, whatsapp: !!notificacaoDe(c.notificacao_json, cfg).canais?.whatsapp?.destino, vencimentos: tenta(() => JSON.parse(c.vencimentos_json || '{}'), {}) }))
    F.avisos_discord = tenta(() => q('disc', "SELECT cliente, dia, estado FROM consultor_aviso WHERE tipo = 'interno_semanal' AND dia >= ?").all(segundaDa(hoje)), null)?.filter(a => dentro(a.cliente)) ?? null
    F.carteira = papel === 'dono' && progresso ? tenta(() => progresso.carteira({ tipo: 'total' }).etapas.map(e => ({ n: e.n, nome: e.nome, atrasado: e.atrasado, parados: e.parados })), null) : null
    // os 4 números do topo (sempre globais: medem o androide, não o recorte)
    const d28 = addDias(hoje, -28)
    const ordensOk = tenta(() => q('ordOk', "SELECT COUNT(*) n FROM exec_ordem WHERE estado = 'executada' AND executado_em >= ?").get(d28 + 'T00:00:00').n, 0)
    const cardsOk = q('cardsOk', "SELECT COUNT(*) n FROM tarefas WHERE arquivada = 0 AND status = 'concluida' AND titulo LIKE '%· PS-%' AND data_conclusao >= ?").get(d28).n
    const cob = q('cob', "SELECT SUM(titulo LIKE '%· PS-%') cards, COUNT(*) tarefas FROM tarefas WHERE arquivada = 0").get()
    const eq = tenta(() => listarEquipe(), { clientes: [], consultores: [] })
    F.numeros = { autonomia: { n: ordensOk, de: ordensOk + cardsOk }, cobertura: { cards: cob.cards || 0, tarefas: cob.tarefas || 0 }, contas: { clientes: eq.clientes.length, pessoas: eq.consultores.length } }
    return F
  }
  return {
    // montar({ por, quem, etapa }) → a fila pronta para a tela
    montar({ por = '', quem = '', etapa = null } = {}) {
      const papel = PAPEIS.includes(por) ? por : 'lider', hoje = hojeLocal(), agora = agoraIso()
      const e = escopoDe(papel, quem)
      const r = montarFila({ por: papel, quem, etapa, hoje, agora, escopo: e.clientes, fontes: fontes(papel, quem, e.clientes, hoje, agora), regrasConsultor: REGRAS_CONSULTOR })
      return { ...r, lido_em: agora, ...(e.motivo ? { escopo_motivo: e.motivo } : {}), regras_consultor: REGRAS_CONSULTOR }
    },
  }
}
