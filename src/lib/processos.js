// Inteligência de PROCESSOS: o sistema sabe como cada tarefa é executada em cada canal (passo a passo do Manual do Analista), o que é evidência e o que é
// "concluído", quem executa, em que ordem as tarefas vêm no plano e como a duplicação estratégica funciona. Fonte: config/processos-base.json (extraído do
// Manual por scripts/extrair-processos.mjs), config/processos-curadoria.json (MAPA por canal, tipo, executor, critério, famílias de demanda) e
// config/duplicacao.json (playbook de duplicação). Puro (sem banco): roda em qualquer lugar e é testado com os próprios arquivos.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './env.js'

const ler = nome => JSON.parse(readFileSync(join(ROOT, 'config', nome), 'utf-8'))
export const base = ler('processos-base.json')
export const curadoria = ler('processos-curadoria.json')
export const duplicacao = ler('duplicacao.json')

export const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9+\/ ]+/g, ' ').replace(/\s+/g, ' ').trim()
const porId = new Map(base.processos.map(p => [p.id, p]))
export const CANAIS = curadoria.canais
const ORDEM = new Map(curadoria.sequencia_logica.map(s => [s.k, s.ordem]))

// ── famílias de demanda: o Notion tem dezenas de grafias ("Duplicar anúncios", "Duplicação de Anuncio", "Duplicação"…) e o sistema aprende por FAMÍLIA ──
const FAMILIAS = curadoria.familias.map(f => ({ ...f, rxs: f.rx.map(r => new RegExp(r, 'i')) }))
export function familiaDeDemanda(tipo) {
  const t = norm(tipo)
  if (!t) return { id: 'sem_tipo', nome: '(sem tipo)' }
  const f = FAMILIAS.find(f => f.rxs.some(r => r.test(t)))
  return f ? { id: f.id, nome: f.nome } : { id: 'outra:' + t, nome: String(tipo).trim() }
}
// família AO CLIENTE (relatório: 🛠️ tarefas da semana e 🔍 ações medidas): tipo livre ou sem tipo vira «Outras ações» — o tipo cru pode ser jargão («(sem tipo)», «criar anúncio»).
// Tipo vazio, livre ou GENÉRICO («Central de marketing» cobre campanha e mensagem): a família sai do TÍTULO quando ele casa com uma família de verdade (14/10).
const real = f => !/^(sem_tipo|outra:)/.test(f.id), GENERICO = /^central de marketing$/
export const familiaCliente = (tipo, titulo = '') => {
  const f = familiaDeDemanda(tipo); if (real(f) && !GENERICO.test(norm(tipo))) return f
  const t = familiaDeDemanda(titulo); return real(t) ? t : real(f) ? f : { id: 'outras', nome: 'Outras ações' }
}

// ── processos de um canal, com passo a passo ──
const canalDoBloco = b => b.canal || null
function completar(entrada, canal) {
  const p = porId.get(entrada.processo)
  if (!p) return { ...entrada, canal, erro: 'processo não encontrado no Manual' }
  const cur = curadoria.processos[entrada.processo] || {}
  const blocos = p.blocos.filter(b => canalDoBloco(b) === canal)
  // o bloco que mais combina com o nome do MAPA (Amazon tem vários blocos no mesmo processo: "Modo 1", "Faturador"…)
  const n = norm(entrada.nome)
  const bloco = blocos.map(b => ({ b, pts: norm(b.titulo).split(' ').filter(w => w.length > 3 && n.includes(w)).length })).sort((a, c) => c.pts - a.pts)[0]?.b || blocos[0] || null
  return {
    canal, nome: entrada.nome, processo: p.id, nome_manual: p.nome, capitulo: p.capitulo?.nome || '', descricao: p.descricao,
    tipo: cur.tipo || null, sequencia: ORDEM.get(cur.tipo) ?? 9, demanda: cur.demanda || p.nome, executor: cur.executor || 'analista',
    evidencia: cur.evidencia || curadoria.regras_gerais.evidencia, criterio: cur.criterio || curadoria.regras_gerais.criterio_conclusao, prazo: cur.prazo || '',
    dependencias: cur.dependencias || [], atencao: [cur.atencao, ...(bloco?.atencoes || []), ...(p.atencoes || [])].filter(Boolean),
    duplicacao: !!cur.duplicacao, aliases: cur.aliases || [],
    bloco: bloco ? { titulo: bloco.titulo, plataforma: bloco.plataforma, caminho: bloco.caminho, passos: bloco.passos } : null,
    outros_blocos: blocos.filter(b => b !== bloco).map(b => ({ titulo: b.titulo, caminho: b.caminho, passos: b.passos })),
  }
}
// o MAPA de um canal ('ML' | 'SHO' | 'AMZ'); sem canal = os três
export function catalogo({ canal = null } = {}) {
  const canais = canal ? [canal] : Object.keys(curadoria.mapa)
  return canais.flatMap(c => (curadoria.mapa[c] || []).map(e => completar(e, c)))
}
export const processoPorId = id => porId.get(id) || null

// processos do Manual que TÊM passo a passo no canal mas não estão no MAPA (ex.: 11.7 Planejamento FULL, 9.6 Campanhas de desconto):
// aparecem na tela e servem de roteiro quando a demanda não casa com nenhum item do MAPA. fonte:'manual' distingue do MAPA (fonte:'mapa').
export function extras({ canal = null } = {}) {
  const canais = canal ? [canal] : Object.keys(curadoria.mapa)
  const noMapa = new Set(Object.values(curadoria.mapa).flat().map(e => e.processo))
  return canais.flatMap(c => base.processos.filter(p => !noMapa.has(p.id) && (p.blocos || []).some(b => b.canal === c && b.passos?.length))
    .map(p => ({ ...completar({ processo: p.id, nome: p.nome }, c), fonte: 'manual' })))
}
// um processo completo (MAPA ou extra) para outro sistema executar passo a passo: GET /api/processos/:id?canal=
export function processoCompleto(id, canal) {
  const e = [...catalogo({ canal }), ...extras({ canal })].find(x => x.processo === id)
  if (!e) return null
  return { ...e, fonte: e.fonte || 'mapa', roteiro: roteiro({ demanda: e.nome, canal, incluirExtras: true }) }
}

// processo que corresponde a uma demanda do Notion ("Duplicar Anúncio", "Preencher Ficha Técnica"…) num canal: alias exato > alias contido > família
export function acharProcesso({ demanda, canal = null, incluirExtras = true } = {}) {
  const t = norm(demanda)
  if (!t) return null
  const fam = familiaDeDemanda(demanda).id
  const busca = itens => {
    const alvo = e => [norm(e.nome), norm(e.demanda), ...e.aliases.map(norm)]
    const exato = itens.filter(e => alvo(e).includes(t))
    if (exato.length) return exato[0]
    const contido = itens.filter(e => alvo(e).some(a => a && a.length >= 6 && (t.includes(a) || a.includes(t))))
    if (contido.length) return contido.sort((a, b) => b.nome.length - a.nome.length)[0]
    // família só quando a demanda pertence a uma família de verdade ('outra:'/'sem_tipo' nunca casam por família)
    if (/^(outra:|sem_tipo)/.test(fam)) return null
    return itens.find(e => familiaDeDemanda(e.demanda).id === fam || e.aliases.some(a => familiaDeDemanda(a).id === fam)) || null
  }
  // MAPA primeiro (é a lista do David); depois os processos do Manual com passo a passo no canal
  return busca(catalogo({ canal }).map(e => ({ ...e, fonte: 'mapa' }))) || (incluirExtras ? busca(extras({ canal })) : null)
}

// roteiro para o card do Notion: o que fazer, em que ordem, com que evidência e quando está concluído
export function roteiro({ demanda, canal = null, incluirExtras = true } = {}) {
  const e = acharProcesso({ demanda, canal, incluirExtras })
  if (!e) return null
  return {
    fonte: e.fonte || 'mapa', processo: e.processo, nome: e.nome, canal: e.canal, canal_rotulo: CANAIS[e.canal] || e.canal, caminho: e.bloco?.caminho || '', passos: e.bloco?.passos || [],
    atencao: e.atencao, evidencia: e.evidencia, criterio: e.criterio, prazo: e.prazo, executor: e.executor, dependencias: e.dependencias, tipo: e.tipo, duplicacao: e.duplicacao,
  }
}
export function roteiroEmTexto(r) {
  if (!r) return ''
  const linhas = [`COMO FAZER — ${r.nome} (${r.canal_rotulo})`]
  if (r.caminho) linhas.push(`Caminho: ${r.caminho}`)
  r.passos.forEach(p => linhas.push(`${p.n}. ${p.titulo}${p.texto ? ' — ' + p.texto : ''}`))
  if (r.atencao.length) linhas.push('', ...r.atencao.map(a => `Atenção: ${a}`))
  linhas.push('', 'EVIDÊNCIA (registrar no card no momento da execução):', ...r.evidencia.map(e => `• ${e}`))
  linhas.push('', `CRITÉRIO DE CONCLUSÃO: ${r.criterio}`)
  if (r.prazo) linhas.push(`PRAZO DE REFERÊNCIA: ${r.prazo}`)
  if (r.dependencias.length) linhas.push(`DEPENDE DO CLIENTE: ${r.dependencias.join('; ')}`)
  return linhas.join('\n')
}
// ordem de execução do plano (Manual 5.2): saúde → disponibilidade → cadastros e duplicações → otimização → tráfego/promoção → expansão
export const ordemDoTipo = tipo => ORDEM.get(tipo) ?? 9
export function ordenarPorSequencia(itens, tipoDe) {
  return [...itens].map((x, i) => ({ x, i })).sort((a, b) => ordemDoTipo(tipoDe(a.x)) - ordemDoTipo(tipoDe(b.x)) || a.i - b.i).map(o => o.x)
}
export const regrasGerais = curadoria.regras_gerais

// volume do método de duplicação (config/duplicacao.json): A/B conta o TOTAL de anúncios (original + duplicatas); os demais contam as duplicatas
export function volumeEsperado(objetivoId, nFilhos) {
  const v = duplicacao.tipos.find(t => t.id === objetivoId)?.volume
  if (!v) return { ok: null, texto: 'sem objetivo, não há volume de referência' }
  const total = v.total ? nFilhos + 1 : nFilhos
  const ok = total >= v.min && (v.max == null || total <= v.max)
  return { ok, texto: `${v.texto} — esta duplicação: ${v.total ? `${total} anúncio(s) no total` : `${nFilhos} duplicata(s)`}` }
}
