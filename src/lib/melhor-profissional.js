// Melhor profissional para a tarefa: para uma FAMÍLIA de demanda (e, se houver, um canal e um cliente), ranqueia os prestadores ativos pelo que o
// Merovíngio mediu — resultado nas vendas (melhorou/piorou com controle, limite inferior de Wilson contra a taxa habitual da família), receita
// incremental associada, velocidade (mediana de dias entre início e conclusão), volume executado (90 dias), experiência no cliente e carga atual.
// É associação temporal ajustada, nunca causalidade; sem amostra mínima o sistema NÃO afirma "melhor": diz "sem prova suficiente" e devolve a
// ordem por volume/velocidade como contexto. Núcleo puro (rankear) + carregador com banco (melhorProfissional).
import { db, hojeLocal } from './db.js'
import { wilson, excluirDaAprendizagem } from './impacto-tarefas.js'
import { padroesGlobaisCache } from './calibracao.js'
import { familiaDeDemanda } from './processos.js'
import { casadorOficial } from './analistas.js'
import { criarResolvedor, normNome, CANAIS } from './equipe.js'
import { ficha } from './ficha-cliente.js'
import { cfgRetro } from './retroalimentacao.js'
import { ABERTA_SQL } from './status-tarefa.js'

const r2 = n => Math.round(n * 100) / 100
const diasEntre = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000)
const mediana = v => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const explodir = s => [...new Set(String(s || '').split(',').map(x => x.trim()).filter(Boolean))]
export const PESOS = { resultado: 0.55, velocidade: 0.15, volume: 0.15, experiencia_cliente: 0.10, carga: 0.05 }
// canal do card do Notion pelo "Processo" ("Shopee 2", "Tiktok"…)
export const RX_CANAL = { ML: /mercado/i, SHO: /shopee/i, AMZ: /amazon/i, TTK: /tik\s*tok/i }

// ── núcleo puro ──────────────────────────────────────────────────────────────
// medidas: [{ tipo, analista, estado, receita_incremental, cliente, data, reversao_provavel, confundido_preco }] (de impacto-tarefas, todas as contas)
// concluidas: [{ responsavel, tipo_demanda, cliente, data_inicio, data_conclusao }] (90 dias) · abertas: [{ responsavel }]
// prestadores: [{ nome }] ativos · canon(nome) → nome oficial do prestador ou null
// opt-in: nicho recorta as MEDIDAS (m.nicho, anotado por padroesGlobais); canal recorta volume e velocidade pelo processo do card. Toda medição de
// resultado é do Mercado Livre: em outro canal não há resultado para comparar e a resposta diz "sem medição para {canal}" (carga segue a total).
export function rankear({ familia, cliente = null, medidas, concluidas, abertas, prestadores, canon, minN = 8, nicho = null, canal = null }) {
  const fam = m => familiaDeDemanda(m.tipo || m.tipo_demanda).id
  const semMedicao = !!canal && canal !== 'ML'
  if (canal) concluidas = concluidas.filter(t => RX_CANAL[canal]?.test(t.processo || ''))
  const daFam = semMedicao ? [] : medidas.filter(m => fam(m) === familia && (!nicho || m.nicho === nicho) && !excluirDaAprendizagem(m) && ['melhorou', 'piorou', 'sem_efeito'].includes(m.estado))
  const base = daFam.length >= minN ? Math.min(0.5, daFam.filter(m => m.estado === 'melhorou').length / daFam.length) : null
  const P = new Map()
  const linha = nome => { if (!P.has(nome)) P.set(nome, { nome, n: 0, melhorou: 0, piorou: 0, sem_efeito: 0, receita: 0, no_cliente: 0, concluidas90: 0, concluidas_fam90: 0, duracoes: [], abertas: 0 }); return P.get(nome) }
  for (const p of prestadores) linha(p.nome)
  for (const m of daFam) for (const n of explodir(m.analista)) {
    const of = canon(n); if (!of) continue
    const l = linha(of); l.n++; l[m.estado]++; if (m.estado === 'melhorou' && Number.isFinite(m.receita_incremental)) l.receita += Math.max(0, m.receita_incremental)
    if (cliente && m.cliente === cliente) l.no_cliente++
  }
  for (const t of concluidas) for (const n of explodir(t.responsavel)) {
    const of = canon(n); if (!of) continue
    const l = linha(of); l.concluidas90++
    if (fam(t) === familia) { l.concluidas_fam90++; if (t.data_inicio && t.data_conclusao && t.data_conclusao >= t.data_inicio) { const d = diasEntre(t.data_inicio, t.data_conclusao); if (d <= 365) l.duracoes.push(d) } }
  }
  for (const t of abertas) for (const n of explodir(t.responsavel)) { const of = canon(n); if (of) linha(of).abertas++ }
  const linhas = [...P.values()].map(l => {
    const w = l.n ? wilson(l.melhorou, l.n) : { p: 0, baixo: 0, alto: 1 }
    const prova = l.n >= minN && base != null && w.baixo > base       // resultado conclusivo: limite inferior acima da taxa habitual da família
    const fraco = l.n >= minN && base != null && w.alto < base
    return { ...l, mediana_dias: mediana(l.duracoes), taxa: r2(w.p), taxa_baixo: r2(w.baixo), taxa_alto: r2(w.alto), prova, fraco, receita: r2(l.receita) }
  }).filter(l => l.n || l.concluidas_fam90 || l.concluidas90)
  // normalizações 0–1 dentro do conjunto (quem não tem dado fica em 0, nunca em "média")
  const max = k => Math.max(1e-9, ...linhas.map(l => l[k] || 0))
  const maxRec = max('receita'), maxVol = max('concluidas_fam90'), maxExp = max('no_cliente'), maxCarga = max('abertas')
  const medianas = linhas.map(l => l.mediana_dias).filter(x => x != null), maxMed = medianas.length ? Math.max(...medianas, 1) : 1
  for (const l of linhas) {
    const resultado = l.n ? (0.7 * l.taxa_baixo + 0.3 * (l.receita / maxRec)) : 0
    const velocidade = l.mediana_dias == null ? 0 : 1 - Math.min(1, l.mediana_dias / maxMed)
    l.componentes = { resultado: r2(resultado), velocidade: r2(velocidade), volume: r2(l.concluidas_fam90 / maxVol), experiencia_cliente: r2(cliente ? l.no_cliente / maxExp : 0), carga: r2(1 - l.abertas / maxCarga) }
    l.score = r2(100 * Object.entries(PESOS).reduce((t, [k, p]) => t + p * (l.componentes[k] || 0), 0))
    l.evidencia = [
      l.n ? `${l.melhorou} de ${l.n} ${familia === 'sem_tipo' ? 'tarefas' : 'tarefas desta família'} melhoraram as vendas (${Math.round(100 * l.taxa)}%; intervalo ${Math.round(100 * l.taxa_baixo)}–${Math.round(100 * l.taxa_alto)}%)` : 'nenhuma tarefa desta família com resultado medido',
      l.receita ? `R$ ${Math.round(l.receita).toLocaleString('pt-BR')} de receita incremental associada` : '',
      l.mediana_dias != null ? `executa em ${l.mediana_dias} dia(s) na mediana` : 'sem tempo de execução registrado',
      `${l.concluidas_fam90} concluída(s) desta família em 90 dias · ${l.abertas} aberta(s) agora`,
      cliente && l.no_cliente ? `${l.no_cliente} medida(s) neste cliente` : '',
    ].filter(Boolean)
  }
  linhas.sort((a, b) => (b.prova - a.prova) || b.score - a.score || b.concluidas_fam90 - a.concluidas_fam90)
  const topo = linhas[0] || null
  const recomendado = topo && topo.prova ? topo : null
  return {
    familia, cliente, base_familia: base, min_n: minN, n_medidas_familia: daFam.length,
    recomendado: recomendado ? { nome: recomendado.nome, motivo: `melhor desempenho medido nesta tarefa: ${recomendado.melhorou} de ${recomendado.n} melhoraram (acima da taxa habitual de ${Math.round(100 * base)}%)`, score: recomendado.score } : null,
    aviso: recomendado ? '' : semMedicao ? `sem medição para ${CANAIS[canal] || canal}: toda medição de resultado é do Mercado Livre; a ordem abaixo é por volume e velocidade neste canal, não por resultado`
      : (daFam.length < minN ? `sem prova suficiente: só ${daFam.length} tarefa(s) desta família com resultado medido ${nicho ? `no nicho "${nicho}"` : 'na base'} (mínimo ${minN}); a ordem abaixo é por volume e velocidade, não por resultado` : 'ninguém se destaca da taxa habitual com prova estatística; a ordem abaixo pondera resultado, velocidade, volume e carga'),
    ranking: linhas.slice(0, 15).map(({ duracoes, ...l }) => l),
    nicho, canal,
  }
}

// ── carregador com banco: medidas de TODAS as contas (cache de 5 min da calibração) + tarefas do Notion + prestadores ativos ──
const cache = new Map()                                                   // (familia|cliente) → { em, r } por 5 min: o plano de 141 clientes chama isto por ação
export function melhorProfissional({ demanda, familia = null, cliente = null, candidatos = null, nicho = null, canal = null, hoje = hojeLocal() } = {}) {
  const famId = familia || familiaDeDemanda(demanda).id
  const k = `${famId}|${cliente || ''}|${(candidatos || []).join(',')}|${nicho || ''}|${canal || ''}`
  const hit = cache.get(k); if (hit && Date.now() - hit.em < 5 * 60_000) return hit.r
  const P = padroesGlobaisCache()
  const medidas = (P.analises || []).flatMap(a => a.medidas.map(m => ({ ...m, cliente: a.cliente })))
  const corte90 = new Date(hoje + 'T12:00:00'); corte90.setDate(corte90.getDate() - 89)
  const concluidas = db.prepare(`SELECT responsavel, tipo_demanda, cliente, processo, data_inicio, data_conclusao FROM tarefas WHERE arquivada = 0 AND fonte != 'demo' AND status = 'concluida' AND titulo NOT LIKE '%· PS-%' AND COALESCE(NULLIF(data_conclusao,''), DATE(last_edited,'localtime')) >= ?`).all(corte90.toISOString().slice(0, 10))
  const abertas = db.prepare(`SELECT responsavel FROM tarefas WHERE arquivada = 0 AND fonte != 'demo' AND ${ABERTA_SQL} AND responsavel != ''`).all()
  const prestadores = ficha.listarPrestadores()
  const ativos = new Map(prestadores.map(p => [normNome(p.nome), p.nome]))
  const resolver = criarResolvedor([...new Set([...concluidas, ...abertas].flatMap(t => explodir(t.responsavel)))]), oficial = casadorOficial()
  const subseq = (curto, longo) => { let i = 0; for (const p of longo) if (p === curto[i]) i++; return i === curto.length }
  // nome curto do Notion → prestador ATIVO (oficial do RH, ou único prestador cujo nome completo contém as palavras na ordem); ambíguo = não casa
  const canon = nomeCru => {
    const c = resolver(nomeCru); if (!c) return null
    const o = oficial(c); if (o && ativos.has(normNome(o))) return ativos.get(normNome(o))
    const pal = normNome(c).split(' ').filter(Boolean); if (pal.length < 2) return ativos.get(normNome(c)) || null
    const cand = [...ativos.entries()].filter(([n]) => subseq(pal, n.split(' ')))
    return cand.length === 1 ? cand[0][1] : null
  }
  let lista = prestadores
  if (candidatos?.length) { const set = new Set(candidatos.map(normNome)); lista = prestadores.filter(p => set.has(normNome(p.nome)) || candidatos.some(c => normNome(canon(c) || '') === normNome(p.nome))) }
  const r = rankear({ familia: famId, cliente, medidas, concluidas, abertas, prestadores: lista, canon: n => { const c = canon(n); return c && (!candidatos?.length || lista.some(p => p.nome === c)) ? c : null }, minN: cfgRetro.plano.min_n_aprendizado, nicho, canal })
  r.candidatos_restritos = !!candidatos?.length
  cache.set(k, { em: Date.now(), r })
  return r
}
export const limparCacheProfissionais = () => cache.clear()

// a melhor TAREFA para um profissional: famílias em que ele tem prova de resultado (o inverso do ranking)
export function melhoresTarefasDe(nome, { hoje = hojeLocal() } = {}) {
  const P = padroesGlobaisCache(), medidas = (P.analises || []).flatMap(a => a.medidas.map(m => ({ ...m, cliente: a.cliente })))
  const alvo = normNome(nome), resolver = criarResolvedor(medidas.flatMap(m => explodir(m.analista))), oficial = casadorOficial()
  const minhas = medidas.filter(m => explodir(m.analista).some(n => { const c = resolver(n); return normNome(c) === alvo || normNome(oficial(c) || '') === alvo }) && ['melhorou', 'piorou', 'sem_efeito'].includes(m.estado) && !excluirDaAprendizagem(m))
  const porFam = new Map()
  for (const m of minhas) { const f = familiaDeDemanda(m.tipo); const l = porFam.get(f.id) || { familia: f.id, nome: f.nome, n: 0, melhorou: 0, receita: 0 }; l.n++; if (m.estado === 'melhorou') { l.melhorou++; l.receita += Math.max(0, m.receita_incremental || 0) } porFam.set(f.id, l) }
  const minN = cfgRetro.plano.min_n_aprendizado
  return [...porFam.values()].map(l => { const w = wilson(l.melhorou, l.n); return { ...l, receita: r2(l.receita), taxa: r2(w.p), taxa_baixo: r2(w.baixo), prova: l.n >= minN && w.baixo > 0.1 } })
    .sort((a, b) => (b.prova - a.prova) || b.taxa_baixo - a.taxa_baixo || b.n - a.n)
}
