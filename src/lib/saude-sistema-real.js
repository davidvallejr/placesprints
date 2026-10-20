// Fiação da Saúde do sistema (docs/plano-autogestao.md A2/A3/A5): sinais lidos do banco/disco/memória, batimento em data/batimento.json (lido pelo vigia
// externo, scripts/vigia.sh), tabela `incidente` (aberto/resolvido, dono Head de canais, SLA) e aviso interno só por exceção (sino; WhatsApp do Head só
// para CRÍTICO e atrás de config/autogestao.json → whatsapp_critico_ligado, que NASCE false). A lógica é a de saude-sistema.js (pura).
// Fábrica com injeção (o teste passa handle em memória, relógio e envio stub); a instância do servidor usa os padrões.
import { readFileSync, writeFileSync, renameSync, statfsSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './env.js'
import { avaliar, geral, reconciliar, contarSemToken, contasPresas, tocaWhatsapp, textoIncidente } from './saude-sistema.js'

export const SCHEMA_INCIDENTE = `
CREATE TABLE IF NOT EXISTS incidente (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sinal_id TEXT NOT NULL, sistema TEXT NOT NULL, rotulo TEXT NOT NULL DEFAULT '',
  nivel TEXT NOT NULL CHECK (nivel IN ('atencao','critico')),
  estado TEXT NOT NULL DEFAULT 'aberto' CHECK (estado IN ('aberto','resolvido')),
  valor TEXT NOT NULL DEFAULT '', dono TEXT NOT NULL DEFAULT 'Head de canais',
  aberto_em TEXT NOT NULL, atualizado_em TEXT NOT NULL, resolvido_em TEXT NOT NULL DEFAULT '', resolvido_por TEXT NOT NULL DEFAULT '',
  sla_ate TEXT NOT NULL DEFAULT '', oks_seguidos INTEGER NOT NULL DEFAULT 0, ultimo_aviso_em TEXT NOT NULL DEFAULT '', avisos INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_incidente_aberto ON incidente (sinal_id) WHERE estado = 'aberto';
CREATE INDEX IF NOT EXISTS ix_incidente_sinal ON incidente (sinal_id, id);
`
export const lerCfg = () => JSON.parse(readFileSync(join(ROOT, 'config', 'autogestao.json'), 'utf-8'))
const horasDesde = (iso, agoraMs) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? Math.round((agoraMs - t) / 36e5 * 10) / 10 : null }

// deps: handle (better-sqlite3), getEstado, agora() ISO, log, notificar, cfg, env, envio ({ postar } de gatilhos-envio.criarEnvio), dirDados, discoGb()
export function criarSaudeSistema({ handle, getEstado, agora = () => new Date().toISOString(), log = () => {}, notificar = () => {}, cfg = lerCfg(), env = process.env,
  envio = null, dirDados = join(ROOT, 'data'), discoGb = () => { try { const f = statfsSync(dirDados); return Math.round(f.bavail * f.bsize / 1e8) / 10 } catch { return null } } }) {
  handle.exec(SCHEMA_INCIDENTE)
  const batidas = {}
  let semToken = {}, ultimaReconc = 0
  const bater = nome => { batidas[nome] = Date.parse(agora()) }
  const registrarRenovacao = (falhas = []) => { semToken = contarSemToken(semToken, falhas) }

  function sinais() {
    const ms = Date.parse(agora())
    const coletaEm = getEstado('coleta_ml_em') || (getEstado('coleta_ml_dia') ? `${getEstado('coleta_ml_dia')}T04:00:00` : '')   // antes do carimbo novo: o dia da coleta às 04h (hora local)
    const n8nOk = !!(env.PLACE_GATILHOS_URL && env.PLACE_GATILHOS_SECRET)
    const desde6h = new Date(ms - 6 * 36e5).toISOString()
    const n8nErros = n8nOk ? handle.prepare("SELECT COUNT(*) n FROM sync_log WHERE nivel = 'erro' AND em >= ? AND msg LIKE '%(n8n\\_%' ESCAPE '\\'").get(desde6h).n : null
    return {
      'trinity.coleta_ml': horasDesde(coletaEm, ms),
      'trinity.notion_sync': horasDesde(getEstado('ultimo_sync'), ms),
      'trinity.tokens': contasPresas(semToken),
      'trinity.disco': discoGb(),
      'morpheus.n8n': n8nErros,                                       // n8n não configurado = sem_dado (a entrega já fica 'pendente' com o motivo)
      'merovingio.medicao': horasDesde(getEstado('medicao_em'), ms),
      ticks: Object.fromEntries(Object.entries(batidas).map(([k, t]) => [k, Math.round((ms - t) / 6e4)])),
    }
  }
  const avaliacao = () => avaliar(sinais(), cfg)

  const abertos = () => handle.prepare("SELECT * FROM incidente WHERE estado = 'aberto' ORDER BY id").all()
  const listar = (n = 10) => ({ abertos: abertos(), resolvidos: handle.prepare("SELECT * FROM incidente WHERE estado = 'resolvido' ORDER BY id DESC LIMIT ?").all(n) })

  async function avisarWhatsapp(inc) {
    if (!tocaWhatsapp(inc.nivel, cfg)) return { estado: 'desligado' }
    const destino = String(env.HEAD_CANAIS_WHATSAPP || '').replace(/\D/g, '')
    if (!destino || !envio) return { estado: 'pendente', motivo: 'sem_destino' }
    const texto = textoIncidente(inc)
    const r = await envio.postar('/webhook/place-gatilhos', { lote_id: `incidente-${inc.sinal_id}-${Date.parse(agora())}`, tipo: 'incidente', interno: true, assunto: 'Incidente do Place Sprints', texto, texto_html: '', link: '',
      canais: { whatsapp: { ligado: true, destino } }, whatsapp_partes: [texto] })
    if (!r.ok) log('erro', `Morpheus · incidente ${inc.sinal_id}: WhatsApp do Head falhou (n8n_${r.status ?? r.erro ?? 'erro'})`)
    return r.ok ? { estado: 'enviado' } : { estado: 'falhou' }
  }

  // aplica a avaliação: abre/atualiza/fecha e avisa só por exceção. Nunca lança (saúde não derruba o servidor).
  async function reconciliarAgora(av = avaliacao()) {
    const ms = Date.parse(agora()), em = agora()
    const ultimosAvisos = Object.fromEntries(handle.prepare("SELECT sinal_id, MAX(ultimo_aviso_em) u FROM incidente WHERE ultimo_aviso_em != '' GROUP BY sinal_id").all().map(r => [r.sinal_id, r.u]))
    const r = reconciliar({ abertos: abertos(), avaliacao: av, ultimosAvisos, cfg, agoraMs: ms })
    const tx = handle.transaction(() => {
      for (const n of r.abrir) handle.prepare('INSERT INTO incidente (sinal_id, sistema, rotulo, nivel, valor, dono, aberto_em, atualizado_em, sla_ate) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(n.sinal_id, n.sistema, n.rotulo || '', n.nivel, String(n.valor ?? ''), cfg.dono || 'Head de canais', em, em, n.sla_ate)
      for (const u of r.atualizar) handle.prepare("UPDATE incidente SET nivel = ?, valor = ?, oks_seguidos = ?, atualizado_em = ?, sla_ate = COALESCE(?, sla_ate) WHERE id = ? AND estado = 'aberto'")
        .run(u.nivel, String(u.valor ?? ''), u.oks_seguidos, em, u.sla_ate ?? null, u.id)
      for (const f of r.fechar) handle.prepare("UPDATE incidente SET estado = 'resolvido', resolvido_em = ?, resolvido_por = 'auto', atualizado_em = ? WHERE id = ? AND estado = 'aberto'").run(em, em, f.id)
    })
    tx()
    for (const a of r.avisar) {
      const inc = handle.prepare("SELECT * FROM incidente WHERE sinal_id = ? AND estado = 'aberto'").get(a.sinal_id)
      if (!inc) continue
      handle.prepare('UPDATE incidente SET ultimo_aviso_em = ?, avisos = avisos + 1 WHERE id = ?').run(em, inc.id)
      try { notificar({ tipo: 'incidente', nivel: a.nivel === 'critico' ? 'erro' : 'alerta', titulo: `Incidente ${a.nivel === 'critico' ? 'crítico' : 'de atenção'}: ${a.rotulo || a.sinal_id}`, corpo: textoIncidente(a), link: '/integracoes', sistema: a.sistema }) } catch { /* sino é melhor esforço */ }   // sem dedupeMin: o dedupe do sino é por tipo+cliente e calaria OUTRO incidente; o 1/h por sinal já vem do reconciliar
      try { await avisarWhatsapp(a) } catch { /* nunca derruba */ }
    }
    for (const f of r.fechar) log('info', `Morpheus · incidente resolvido sozinho: ${f.sinal_id}`)
    for (const n of r.abrir) log(n.nivel === 'critico' ? 'erro' : 'aviso', `Morpheus · incidente aberto (${n.nivel}): ${n.sinal_id} = ${n.valor ?? '—'}`)
    return r
  }

  // batimento lido pelo vigia externo: escrita atômica (tmp + rename), sem segredo, sem cliente
  function escreverBatimento(av) {
    const ms = Date.parse(agora()), seg = iso => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? Math.floor(t / 1000) : 0 }
    const coleta = getEstado('coleta_ml_em') || (getEstado('coleta_ml_dia') ? `${getEstado('coleta_ml_dia')}T04:00:00` : '')
    const corpo = JSON.stringify({ em: agora(), em_s: Math.floor(ms / 1000), pid: process.pid, coleta_ml_s: seg(coleta), ultimo_sync_s: seg(getEstado('ultimo_sync')), geral: geral(av), ticks: sinais().ticks })
    const destino = join(dirDados, 'batimento.json'), tmp = destino + '.tmp'
    try { writeFileSync(tmp, corpo); renameSync(tmp, destino) } catch { /* disco cheio: o vigia percebe pela idade do arquivo */ }
  }

  // a cada minuto: batimento; a cada 5 min: incidentes
  async function tick() {
    bater('saude')
    let av = []
    try { av = avaliacao() } catch (e) { log('erro', `Morpheus · saúde do sistema: ${String(e?.message).slice(0, 120)}`) }
    escreverBatimento(av)
    const ms = Date.parse(agora())
    if (ms - ultimaReconc < 5 * 6e4) return
    ultimaReconc = ms
    try { await reconciliarAgora(av) } catch (e) { log('erro', `Morpheus · incidentes: ${String(e?.message).slice(0, 120)}`) }
  }

  const estado = () => { const av = avaliacao(); return { em: agora(), geral: geral(av), sinais: av, incidentes: listar(), whatsapp_critico_ligado: cfg.whatsapp_critico_ligado === true, dono: cfg.dono } }
  return { bater, registrarRenovacao, sinais, avaliacao, reconciliarAgora, avisarWhatsapp, escreverBatimento, tick, estado, listar }
}
