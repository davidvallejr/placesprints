// Retroalimentação ("machine learn" da casa, 100% determinística e auditável):
// cada ação DISTRIBUÍDA vira uma tarefa "· PS-xxxx" no Notion; quando o time a conclui,
// este módulo mede se a CONDIÇÃO que gerou a ação se resolveu (re-rodando a checagem da
// regra sobre o estado atual do banco) e acumula a taxa de sucesso por regra.
// A taxa volta para o plano como "base própria: em N casos semelhantes, resolveu em X%" —
// só com amostra mínima (5 casos medidos); abaixo disso o sistema diz "amostra insuficiente"
// em vez de fingir estatística. Associação temporal, nunca causa comprovada.
import { db, agora, hojeLocal } from './db.js'
import { playbook, addDias, dependenciasDe } from './plano-cliente.js'
import { ABERTA_SQL } from './status-tarefa.js'

db.exec(`CREATE TABLE IF NOT EXISTS aprendizado (
  acao_id TEXT PRIMARY KEY, cliente TEXT NOT NULL, regra TEXT NOT NULL,
  distribuida_em TEXT NOT NULL DEFAULT '', concluida_em TEXT NOT NULL DEFAULT '',
  dias_para_concluir INTEGER,            -- distribuição → conclusão da tarefa no Notion
  resolveu INTEGER,                      -- 1 = a condição da regra sumiu após a execução; 0 = persiste; NULL = não mensurável
  detalhe TEXT NOT NULL DEFAULT '',      -- o que foi comparado (auditoria)
  medido_em TEXT NOT NULL
)`)

const AMOSTRA_MINIMA = 5
const L = playbook.limiares

// re-checa a CONDIÇÃO de cada regra no estado atual (mesmos limiares do motor)
function condicaoAtiva(regra, cliente, hoje, mesAcao = '') {
  const abertas = db.prepare(`SELECT status, responsavel, SUBSTR(last_edited, 1, 10) ed FROM tarefas
    WHERE arquivada = 0 AND cliente = ? AND ${ABERTA_SQL} AND titulo NOT LIKE '%· PS-%'`).all(cliente)
  const serieFim = db.prepare(`SELECT COALESCE(NULLIF(data_conclusao,''), SUBSTR(last_edited, 1, 10)) d FROM tarefas
    WHERE arquivada = 0 AND cliente = ? AND status = 'concluida' AND titulo NOT LIKE '%· PS-%'`).all(cliente).map(r => r.d)
  const noIntervalo = (a, b) => serieFim.filter(d => d >= a && d <= b).length
  const limParada = addDias(hoje, -L.dias_parada)
  switch (regra) {
    case 'bloqueio_cliente': { const n = dependenciasDe(cliente, hoje).vencidas.length; return { ativa: n > 0, detalhe: `aguardando o cliente há ${L.dependencia_atencao_dias}+ dias agora: ${n}` } }
    case 'bloqueio_interno': return { ativa: abertas.some(t => t.status === 'bloqueada'), detalhe: `bloqueadas agora: ${abertas.filter(t => t.status === 'bloqueada').length}` }
    case 'sem_responsavel': return { ativa: abertas.some(t => !t.responsavel), detalhe: `sem dono agora: ${abertas.filter(t => !t.responsavel).length}` }
    case 'backlog_parado': { const n = abertas.filter(t => t.ed && t.ed < limParada && t.status !== 'bloqueada').length; return { ativa: n >= L.min_paradas, detalhe: `paradas 30d+ agora: ${n}` } }
    case 'sem_entrega': { const ult = serieFim.sort().at(-1) || null; const dias = ult ? Math.round((new Date(hoje + 'T12:00:00') - new Date(ult + 'T12:00:00')) / 86400000) : null
      return { ativa: abertas.length > 0 && (dias == null || dias >= L.dias_sem_entrega), detalhe: `última entrega: ${ult || 'nenhuma'}` } }
    case 'queda_cadencia': { const c28 = noIntervalo(addDias(hoje, -27), hoje), p28 = noIntervalo(addDias(hoje, -55), addDias(hoje, -28))
      if (p28 < L.queda_cadencia_base_minima) {                         // a janela-base deslizou para o próprio período ruim
        const ult = [...serieFim].sort().at(-1) || null
        const parou = !ult || ult < addDias(hoje, -L.dias_sem_entrega)
        return parou ? { ativa: true, detalhe: `entregas pararam (última: ${ult || 'nenhuma'}) — NÃO resolvido` }
          : { ativa: null, detalhe: `base de comparação deslizou (${c28} vs ${p28}) — não mensurável` }
      }
      return { ativa: c28 <= p28 * (1 - L.queda_cadencia_pct / 100), detalhe: `cadência agora: ${c28} vs ${p28}` } }
    case 'sem_plano_mes': { const mes = mesAcao || hoje.slice(0, 7)        // o mês que a AÇÃO mirava, não o da medição
      const n = db.prepare('SELECT COUNT(*) n FROM planos_acao WHERE cliente = ? AND ano_mes = ?').get(cliente, mes).n
      return { ativa: n === 0, detalhe: `planos de ${mes} no cache local (último sync): ${n}` } }
    default:
      if (regra.startsWith('alavanca_')) {
        const a = playbook.alavancas[regra.slice(9)]
        if (!a) return { ativa: null, detalhe: 'alavanca desconhecida' }
        const rx = new RegExp(a.padroes.join('|'))
        const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
        const janela = addDias(hoje, -L.janela_alavanca_dias)
        const recentes = db.prepare(`SELECT titulo, tipo_demanda FROM tarefas WHERE arquivada = 0 AND cliente = ?
          AND SUBSTR(last_edited, 1, 10) >= ? AND titulo NOT LIKE '%· PS-%'`).all(cliente, janela)
        if (recentes.length < L.min_tarefas_ativas_para_alavanca)       // cliente dormente: a regra não se aplica (guarda do motor)
          return { ativa: null, detalhe: `cliente sem atividade (${recentes.length} tarefa(s) em ${L.janela_alavanca_dias}d) — não mensurável` }
        const n = recentes.filter(t => rx.test(semAcento(`${t.titulo} ${t.tipo_demanda}`))).length
        return { ativa: n === 0, detalhe: `tarefas da alavanca na janela: ${n}` }
      }
      return { ativa: null, detalhe: 'regra sem recheque automático (calendário/renovação/ml sem dados conectados)' }
  }
}

// mede as ações distribuídas cujas tarefas foram concluídas no Notion (idempotente)
export function medirResultados({ hoje = hojeLocal() } = {}) {
  const distribuidas = db.prepare(`SELECT id, cliente, regra, mes, distribuido_em, notion_page_id FROM acoes_plano WHERE status = 'distribuida'`).all()
  if (!distribuidas.length) return { medidas: 0, aguardando: 0, aguardando_cliente: 0, nao_mensuraveis: 0, sem_tarefa: 0 }
  const jaMedidas = new Set(db.prepare('SELECT acao_id FROM aprendizado').all().map(r => r.acao_id))   // inclui não-mensuráveis (estático)
  const up = db.prepare(`INSERT INTO aprendizado (acao_id, cliente, regra, distribuida_em, concluida_em, dias_para_concluir, resolveu, detalhe, medido_em)
    VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(acao_id) DO UPDATE SET concluida_em=excluded.concluida_em,
    dias_para_concluir=excluded.dias_para_concluir, resolveu=excluded.resolveu, detalhe=excluded.detalhe, medido_em=excluded.medido_em`)
  let medidas = 0, aguardando = 0, aguardando_cliente = 0, nao_mensuraveis = 0, sem_tarefa = 0
  for (const a of distribuidas) {
    if (jaMedidas.has(a.id)) continue
    // vínculo pelo sufixo "· PS-id" no título OU pelo page_id do Notion (sobrevive a renomear o card)
    const tarefa = db.prepare(`SELECT status, COALESCE(NULLIF(data_conclusao,''), SUBSTR(last_edited, 1, 10)) fim
      FROM tarefas WHERE (cliente = ? AND titulo LIKE ?) OR (? != '' AND id = ?) LIMIT 1`).get(a.cliente, `%· ${a.id}%`, a.notion_page_id || '', a.notion_page_id || '')
    if (!tarefa) { sem_tarefa++; continue }
    if (tarefa.status === 'dependencia_cliente') { aguardando_cliente++; continue }   // o card espera o cliente: nem concluído nem falha — mede quando ele entregar
    if (tarefa.status !== 'concluida') { aguardando++; continue }
    // carência de 3 dias após a conclusão: o efeito precisa de tempo para aparecer no board
    if (tarefa.fim && addDias(tarefa.fim, 3) > hoje) { aguardando++; continue }
    const { ativa, detalhe } = condicaoAtiva(a.regra, a.cliente, hoje, a.mes)
    const diaLocal = iso => { const d = new Date(iso); return Number.isFinite(+d) ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : null }
    const ini = a.distribuido_em ? diaLocal(a.distribuido_em) : null           // distribuido_em é ISO UTC; fim é data local
    const dias = ini && tarefa.fim ? Math.max(0, Math.round((new Date(tarefa.fim + 'T12:00:00') - new Date(ini + 'T12:00:00')) / 86400000)) : null
    up.run(a.id, a.cliente, a.regra, a.distribuido_em || '', tarefa.fim || '', dias, ativa == null ? null : (ativa ? 0 : 1), detalhe, agora())
    if (ativa == null) nao_mensuraveis++; else medidas++
  }
  return { medidas, aguardando, aguardando_cliente, nao_mensuraveis, sem_tarefa }   // sem_tarefa = distribuída cujo card sumiu/não sincronizou (declarado)
}

// taxa de sucesso por regra (só com amostra mínima — senão o sistema declara, não finge)
export function estatisticas() {
  const rows = db.prepare(`SELECT regra, COUNT(*) executadas,
      SUM(CASE WHEN resolveu IS NOT NULL THEN 1 ELSE 0 END) medidas,
      SUM(CASE WHEN resolveu = 1 THEN 1 ELSE 0 END) resolveram,
      ROUND(AVG(dias_para_concluir), 1) dias_medio
    FROM aprendizado GROUP BY regra ORDER BY executadas DESC`).all()
  return rows.map(r => ({
    ...r,
    taxa: r.medidas >= AMOSTRA_MINIMA ? Math.round(100 * r.resolveram / r.medidas) : null,
    nota: r.medidas >= AMOSTRA_MINIMA ? `em ${r.medidas} caso(s) medidos, a condição se resolveu em ${Math.round(100 * r.resolveram / r.medidas)}% (associação temporal, não causa comprovada)` : `amostra insuficiente (${r.medidas}/${AMOSTRA_MINIMA} medidas) — o aprendizado liga sozinho conforme as tarefas forem concluídas`,
  }))
}

export const historicoPorRegra = () => new Map(estatisticas().map(e => [e.regra, e]))
