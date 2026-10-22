// Trilha Prime e combinados da reunião como REGRAS do plano (docs/desenho-place-prime.md § D.1, D.2, D.5) — nunca um segundo motor.
// PURO (sem banco, sem rede): devolve DESCRITORES no formato de plano-cliente.acao(); plano-cliente.regras() os empurra com o mesmo score, o mesmo
// idAcao (cliente|regra|alvo, idempotente), o mesmo filtro de descartadas/alinhamentos e o mesmo salvarPlano. Só para cliente Prime (Performance byte a byte igual).
//   trilha_prime: cada passo de config/trilhas.json com prazo contado do ENCONTRO que o dispara (tipo marcado em Encontros); sem abertura marcada = passo 0.
//   combinado_ata: frases de compromisso do lado do cliente (lista fechada de verbos, guardiao.compromissosDaAta) da transcrição enviada ou da ata do card;
//   título redigido pela IA só quando houve chave na hora do upload (encontros.js), senão modelo fixo; processo só da lista fechada (acharProcesso).
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './env.js'
import { compromissosDaAta } from './guardiao.js'
import { acharProcesso, norm } from './processos.js'
import { ID_INTERNO } from './relatorio-seguro.js'
import { temContato } from './livro-registro.js'

export const CFG_TRILHAS = JSON.parse(readFileSync(join(ROOT, 'config', 'trilhas.json'), 'utf-8'))
export const TIPOS_ENCONTRO = CFG_TRILHAS.encontros.map(e => e.id)
export const ROTULO_ENCONTRO = Object.fromEntries(CFG_TRILHAS.encontros.map(e => [e.id, e.nome]))

const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const diasAte = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5)
const br = iso => iso ? iso.split('-').reverse().join('/') : '—'
export const horizonteDe = (hoje, prazo) => { const d = diasAte(hoje, prazo); return d <= 3 ? '72h' : d <= 7 ? '7d' : d <= 30 ? '30d' : '90d' }

// erros de curadoria (o teste roda sobre o config real): processo fora do Manual, faixa inexistente, gatilho fora da lista, métrica que o sistema não mede
export function validarTrilhas(cfg, { processos, faixas }) {
  const erros = [], tipos = new Set(cfg.encontros.map(e => e.id)), metricas = new Set([...cfg.metricas_medidas, 'pendente'])
  for (const t of cfg.trilhas) {
    if (!t.id || !t.passos?.length) erros.push(`${t.id || '?'}: sem id ou sem passos`)
    t.passos.forEach((p, i) => {
      const k = `${t.id} passo ${p.n}`
      if (p.n !== i + 1) erros.push(`${k}: numeração fora de ordem`)
      if (!processos.has(p.processo)) erros.push(`${k}: processo ${p.processo} não existe no Manual`)
      if (!faixas.has(p.faixa_prazo)) erros.push(`${k}: faixa de prazo inexistente`)
      if (!tipos.has(p.encontro_gatilho)) erros.push(`${k}: encontro_gatilho fora da lista`)
      if (!['cliente', 'consultor'].includes(p.executor)) erros.push(`${k}: executor inválido`)
      if (!['encontro', 'anterior'].includes(p.apos) || !(p.dias >= 0)) erros.push(`${k}: prazo relativo inválido`)
      if (!metricas.has(p.prova?.metrica)) erros.push(`${k}: métrica que o sistema não mede`)
    })
  }
  return erros
}

// trilha do cliente: a marcada padrao (David) primeiro, senão a primeira do produto num canal que o cliente tem
export const trilhaDo = ({ produto, canais = [] }, cfg = CFG_TRILHAS) =>
  [...cfg.trilhas].sort((a, b) => (b.padrao === true) - (a.padrao === true)).find(t => t.produto.includes(produto) && canais.includes(t.canal)) || null

// âncora = encontro REALIZADO mais recente de cada tipo (o tipo é marcado pelo consultor; card sem tipo não ancora nada)
export function ancoras(encontros, cfg = CFG_TRILHAS) {
  const ancora = new Set(cfg.encontros.filter(e => e.ancora !== false).map(e => e.id)), m = new Map()
  for (const e of encontros) if (e.estado === 'realizado' && e.data && ancora.has(e.tipo) && !(m.get(e.tipo)?.data >= e.data)) m.set(e.tipo, e)
  return m
}

// passos devidos: só os do encontro que já aconteceu; 'anterior' encadeia no passo anterior do mesmo encontro
export function passosDevidos(trilha, encontros, cfg = CFG_TRILHAS) {
  const anc = ancoras(encontros, cfg), out = []
  let prev = null
  for (const p of trilha.passos) {
    const e = anc.get(p.encontro_gatilho)
    if (!e) { prev = null; continue }
    const base = p.apos === 'anterior' && prev?.encontro.id === e.id ? prev.prazo : e.data
    prev = { passo: p, encontro: e, prazo: addDias(base, p.dias) }
    out.push(prev)
  }
  return { devidos: out, sem_abertura: !anc.has('kickoff') }
}

// descritores da regra trilha_prime (formato plano-cliente.acao)
export function descritoresTrilha({ produto, canais, encontros, hoje, cfg = CFG_TRILHAS }) {
  if (produto !== 'prime') return []
  const t = trilhaDo({ produto, canais }, cfg); if (!t) return []
  const R = cfg.regras.trilha_prime
  const { devidos, sem_abertura } = passosDevidos(t, encontros, cfg)
  const FONTE = 'Place Sprints — trilha Prime (config/trilhas.json) e encontros registrados'
  const out = []
  if (sem_abertura) {
    const semTipo = encontros.filter(e => e.estado === 'realizado' && !e.tipo).length
    out.push({ regra: 'trilha_prime', alvo: `${t.id}|0`, titulo: `${t.nome} · marcar o encontro de abertura (kickoff)`, horizonte: '72h', prazo: addDias(hoje, 3),
      dimensao: R.dimensao, problema: 'A trilha do cliente só começa a contar prazo a partir do encontro de abertura',
      acaoTexto: 'Registrar o encontro de abertura em Encontros (novo, ou marcar como «Abertura» um encontro já realizado). Os passos da trilha nascem datados a partir dele.',
      tipo: 'fato', evidencia: semTipo ? `${semTipo} encontro(s) realizado(s) sem tipo marcado; nenhum marcado como abertura.` : 'Nenhum encontro realizado registrado para o cliente.',
      fonte: FONTE, periodo: `posição em ${br(hoje)}`, dependencia: 'Agenda do cliente', indicador: 'Abertura marcada: não', meta: 'Encontro de abertura registrado',
      aceite: 'Encontro com tipo «Abertura» registrado em Encontros', impacto: R.impacto, urgencia: R.urgencia, esforco: 1, demanda: 'Reunião de Alinhamento',
      extra: { trilha_id: t.id, passo_n: 0, executor: 'consultor', encontro_id: '' } })
  }
  for (const { passo: p, encontro: e, prazo } of devidos) {
    const doCliente = p.executor === 'cliente', pend = p.prova.metrica === 'pendente'
    out.push({ regra: 'trilha_prime', alvo: `${t.id}|${p.n}|${e.id}`, titulo: `${t.nome} ${p.n}/${t.passos.length} · ${p.titulo}`, horizonte: horizonteDe(hoje, prazo), prazo,
      dimensao: R.dimensao, problema: `Passo ${p.n} da trilha, disparado pelo encontro «${ROTULO_ENCONTRO[e.tipo]}» de ${br(e.data)}`,
      acaoTexto: doCliente ? `O cliente executa o que foi treinado no encontro: ${p.titulo}. O consultor acompanha e cobra; o sistema não envia mensagens.` : `O consultor conduz com o cliente: ${p.titulo}.`,
      tipo: R.tipo, evidencia: `Encontro «${ROTULO_ENCONTRO[e.tipo]}» realizado em ${br(e.data)}. Prazo: ${p.dias} dia(s) depois ${p.apos === 'encontro' ? 'do encontro' : 'do passo anterior'} (processo ${p.processo} do Manual, faixa ${p.faixa_prazo}).`,
      fonte: FONTE, periodo: `${br(e.data)} a ${br(prazo)}`, dependencia: doCliente ? 'Execução do cliente' : 'Agenda do consultor',
      indicador: pend ? 'Indicador: pendente (o sistema não mede este passo)' : `Indicador: ${p.prova.metrica} no início do passo`, meta: p.prova.criterio,
      aceite: p.check.join('; '), impacto: R.impacto, urgencia: diasAte(hoje, prazo) <= 3 ? 5 : R.urgencia, esforco: R.esforco, demanda: p.demanda,
      extra: { trilha_id: t.id, passo_n: p.n, executor: p.executor, encontro_id: e.id, processo_id: p.processo, como: p.check, prova: p.prova } })
  }
  return out
}

// ── combinados da reunião → candidatos de tarefa (lado do cliente; nunca com contato/documento/id interno) ──
export const alvoDaFrase = frase => createHash('sha256').update(norm(frase)).digest('hex').slice(0, 16)
export const tituloFixo = frase => `Combinado na reunião: ${String(frase).replace(/[.;:!\s]+$/, '')}`.slice(0, 150)
export function candidatosDaAta(texto) {
  const vistos = new Set()
  return compromissosDaAta(texto).filter(c => c.lado === 'cliente' && !ID_INTERNO.test(c.frase) && !temContato(c.frase)).map(c => ({
    frase: c.frase, alvo: alvoDaFrase(c.frase), processo: acharProcesso({ demanda: c.frase, canal: 'ML' })?.processo || '', titulo: tituloFixo(c.frase), titulo_origem: 'modelo',
  })).filter(c => !vistos.has(c.alvo) && vistos.add(c.alvo))
}

// descritores da regra combinado_ata: encontros realizados na janela; transcrição (candidatos gravados no upload) vence a ata do card
export function descritoresCombinados({ produto, encontros, titulosTarefas = [], hoje, cfg = CFG_TRILHAS }) {
  if (produto !== 'prime') return []
  const R = cfg.regras.combinado_ata, desde = addDias(hoje, -R.janela_dias)
  const existentes = titulosTarefas.map(norm), out = [], vistos = new Set()
  for (const e of [...encontros].filter(e => e.estado === 'realizado' && e.data >= desde).sort((a, b) => (a.data < b.data ? 1 : -1))) {
    const daTranscricao = Array.isArray(e.candidatos) && e.candidatos.length
    const cands = daTranscricao ? e.candidatos : String(e.conteudo || '').length > 200 ? candidatosDaAta(e.conteudo) : []
    for (const c of cands) {
      const n = norm(c.frase).slice(0, 40)
      if (vistos.has(c.alvo) || existentes.some(t => t.includes(n))) continue   // já há card com esse combinado
      vistos.add(c.alvo)
      const prazo = [addDias(e.data, 7), addDias(hoje, 3)].sort().at(-1)
      out.push({ regra: 'combinado_ata', alvo: c.alvo, titulo: c.titulo, horizonte: horizonteDe(hoje, prazo), prazo,
        dimensao: R.dimensao, problema: 'Combinado com o cliente em reunião sem tarefa correspondente no quadro',
        acaoTexto: `O cliente executa o combinado: «${c.frase}». O consultor confirma o prazo e acompanha; o sistema não envia mensagens.`,
        tipo: R.tipo, evidencia: `Frase de compromisso do lado do cliente na ${daTranscricao ? 'transcrição enviada' : 'ata do card'} do encontro de ${br(e.data)} (lista fechada de verbos; o consultor confirma ou descarta).`,
        fonte: daTranscricao ? 'Transcrição do encontro (enviada pelo consultor, com consentimento)' : 'Notion — ata do card do encontro', periodo: br(e.data),
        dependencia: 'Execução do cliente', indicador: 'Combinado registrado como tarefa: não', meta: 'Combinado executado pelo cliente no prazo', aceite: 'Card concluído com a evidência do combinado',
        impacto: R.impacto, urgencia: R.urgencia, esforco: R.esforco, demanda: '',
        extra: { executor: 'cliente', encontro_id: e.id, processo_id: c.processo || '', origem: daTranscricao ? 'transcricao' : 'ata', titulo_origem: c.titulo_origem || 'modelo' } })
      if (out.length >= R.max_por_cliente) return out
    }
  }
  return out
}
