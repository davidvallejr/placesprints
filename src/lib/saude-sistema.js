// Saúde do sistema (docs/plano-autogestao.md A2/A3/A5). PURO: sem banco, sem rede, sem relógio — tudo entra por parâmetro (o teste usa números fixos).
// avaliar(sinais, cfg, agoraMs)        → [{ id, sistema, sinal, rotulo, estado: ok|atencao|critico|sem_dado, valor }] — sinal sem valor = 'sem_dado' (nunca 'ok')
// reconciliar({ abertos, avaliacao, ultimosAvisos, cfg, agoraMs }) → { abrir, atualizar, fechar, avisar } — 1 incidente vivo por sinal; fecha com N leituras ok seguidas;
//                                        avisa só crítico (ou sinal em avisar_sempre) e no máximo 1× por incidente por aviso_intervalo_min
// contarSemToken(cont, falhas)         → novo contador por cliente de ciclos seguidos com falha TRANSITÓRIA na renovação (quem não falhou zera)
// tocaWhatsapp(nivel, cfg)             → só crítico e só com a chave ligada (D-A3: a qualquer hora)
import { sistema as sistemaDe } from './sistemas.js'

export const ORDEM = { ok: 0, sem_dado: 1, atencao: 2, critico: 3 }
// menor:true = quanto menor pior (disco livre: v < limiar); contagem:true = 1 já conta (v ≥ limiar); o resto (idade em horas) = v > limiar (26 h exatas ainda é ok)
export const nivelDe = (valor, lim) => {
  if (valor == null || valor === '' || !Number.isFinite(Number(valor))) return 'sem_dado'
  const v = Number(valor), passa = x => lim.menor ? v < x : lim.contagem ? v >= x : v > x
  return passa(lim.critico) ? 'critico' : passa(lim.atencao) ? 'atencao' : 'ok'
}

// sinais: { 'trinity.coleta_ml': horas, ..., ticks: { nome: idade_min } }
export function avaliar(sinais = {}, cfg = {}) {
  const out = []
  for (const [id, lim] of Object.entries(cfg.limiares || {})) {
    const [sis, sinal] = id.split('.'), valor = sinais[id]
    out.push({ id, sistema: sistemaDe(sis).id, sinal, rotulo: lim.rotulo || sinal, estado: nivelDe(valor, lim), valor: valor ?? null })
  }
  for (const [nome, t] of Object.entries(cfg.ticks || {})) {
    if (nome.startsWith('$')) continue
    const idade = sinais.ticks?.[nome], p = Number(t.periodo_min) || 10
    // tick que ainda não bateu desde que o servidor subiu: sem_dado (o servidor acabou de subir), nunca crítico inventado
    const estado = idade == null ? 'sem_dado' : idade > 6 * p ? 'critico' : idade > 3 * p ? 'atencao' : 'ok'
    out.push({ id: `tick.${nome}`, sistema: sistemaDe(t.sistema).id, sinal: `tick.${nome}`, rotulo: `Tick «${nome}» (minutos desde a última volta)`, estado, valor: idade ?? null })
  }
  return out
}

export const geral = avaliacao => avaliacao.reduce((g, s) => ORDEM[s.estado] > ORDEM[g] && s.estado !== 'sem_dado' ? s.estado : g, 'ok')

// abertos: [{ id, sinal_id, nivel, oks_seguidos, ultimo_aviso_em }]; ultimosAvisos: { sinal_id: ISO } (do último incidente, mesmo resolvido — barra o pisca-pisca)
export function reconciliar({ abertos = [], avaliacao = [], ultimosAvisos = {}, cfg = {}, agoraMs = Date.now() }) {
  const intervalo = (Number(cfg.aviso_intervalo_min) || 60) * 60_000, nOk = Number(cfg.fechar_apos_oks) || 2, sempre = new Set(cfg.avisar_sempre || [])
  const sla = cfg.sla_horas || { critico: 4, atencao: 48 }, porSinal = new Map(abertos.map(i => [i.sinal_id, i]))
  const r = { abrir: [], atualizar: [], fechar: [], avisar: [] }
  const podeAvisar = (id, ultimo) => !ultimo || agoraMs - Date.parse(ultimo) >= intervalo
  const avisavel = s => s.estado === 'critico' || sempre.has(s.id)
  for (const s of avaliacao) {
    const inc = porSinal.get(s.id)
    if (s.estado === 'ok') {
      if (!inc) continue
      const oks = (inc.oks_seguidos || 0) + 1
      if (oks >= nOk) r.fechar.push({ id: inc.id, sinal_id: s.id }); else r.atualizar.push({ id: inc.id, sinal_id: s.id, oks_seguidos: oks, nivel: inc.nivel, valor: s.valor })
      continue
    }
    if (s.estado === 'sem_dado') continue                          // sem leitura não abre nem fecha: o incidente fica como estava
    if (!inc) {
      const novo = { sinal_id: s.id, sistema: s.sistema, nivel: s.estado, valor: s.valor, rotulo: s.rotulo, sla_ate: new Date(agoraMs + (sla[s.estado] || 48) * 3600_000).toISOString() }
      r.abrir.push(novo)
      if (avisavel(s) && podeAvisar(s.id, ultimosAvisos[s.id])) r.avisar.push({ ...novo, motivo: 'abriu' })
      continue
    }
    const escalou = ORDEM[s.estado] > ORDEM[inc.nivel]
    r.atualizar.push({ id: inc.id, sinal_id: s.id, oks_seguidos: 0, nivel: s.estado, valor: s.valor, ...(escalou ? { sla_ate: new Date(agoraMs + (sla[s.estado] || 48) * 3600_000).toISOString() } : {}) })
    if (escalou && avisavel(s) && podeAvisar(s.id, inc.ultimo_aviso_em || ultimosAvisos[s.id])) r.avisar.push({ id: inc.id, sinal_id: s.id, sistema: s.sistema, nivel: s.estado, valor: s.valor, rotulo: s.rotulo, motivo: 'escalou' })
  }
  return r
}

// falhas: [{ cliente, erro }] do renovarPreventivo; só a falha TRANSITÓRIA conta (a definitiva já vira «conexão caída» pelo fluxo de sempre)
export function contarSemToken(cont = {}, falhas = []) {
  const novo = {}
  for (const f of falhas) if (/transit/i.test(String(f?.erro || ''))) novo[f.cliente] = (cont[f.cliente] || 0) + 1
  return novo
}
export const contasPresas = (cont, n = 3) => Object.values(cont).filter(v => v >= n).length

export const tocaWhatsapp = (nivel, cfg = {}) => cfg.whatsapp_critico_ligado === true && nivel === 'critico'
export const textoIncidente = i => `${sistemaDe(i.sistema).nome} · incidente ${i.nivel === 'critico' ? 'CRÍTICO' : 'de atenção'}: ${i.rotulo || i.sinal_id} = ${i.valor ?? '—'}${i.motivo === 'escalou' ? ' (piorou)' : ''}. Dono: Head de canais. Painel: /integracoes`
