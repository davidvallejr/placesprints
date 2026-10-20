// Place Sprint 90: o que o CLIENTE lê de uma ação do plano. PURO (sem banco, sem rede). Projeção com lista FECHADA de campos (D11):
// cada linha de texto gerada pelo motor passa pelo auditor do relatório (relatorio-seguro: promessa, causalidade afirmada, jargão, ID interno, nome da equipe)
// e por um crivo do bastidor (consultor, analista, briefing, Notion, card, squad, "o cliente"); linha reprovada é OMITIDA e contada — nunca reescrita.
// Nunca saem: responsável, squad, delegado, Notion, ranking/profissional sugerido, lógica de prioridade, Merovíngio, id da ação.
// O anúncio vai num campo estruturado fora do crivo (é o anúncio do próprio cliente: o ID_INTERNO do auditor barraria o MLB).
// A cópia FIXA das páginas (s90-paginas.js) não passa por aqui: o auditor é para texto gerado pelo motor ("Place Sprint 90" é jargão para ele).
import { auditarTexto } from './relatorio-seguro.js'

// "cliente" na 3ª pessoa é a voz da equipe ("reunir com o cliente", "custos do cliente"); a "voz do cliente" (o comprador) é método e fica.
// Duplicação estratégica fica com a assessoria (foco.regras_exigem_consultor): passo que manda duplicar não vai a quem não pode fazê-lo
const RX_BASTIDOR = /\b(consultor(?:a|es|as)?|analistas?|briefing|notion|cards?|squads?|merov[ií]ngio|(?<!voz do )clientes?|duplica\w*|duplicata\w*)\b/i
export const MODO_TEXTO = {
  // F1 (só leitura): a execução pelo painel ainda não existe — o texto não promete o que a tela não faz (a F2 troca por "o sistema prepara e você aprova campo a campo")
  executa: 'Esta ação poderá ser preparada pelo painel, com a sua aprovação campo a campo, quando a execução for liberada. Até lá, aplique no Mercado Livre.',
  recomenda: 'Recomendação: você aplica no Mercado Livre e marca como feito; o sistema mede o antes e o depois.',
}
const num = v => (Number.isFinite(v) ? v : null)
const str = v => (typeof v === 'string' ? v : '')
const urlAnuncio = u => (/^https:\/\/([a-z0-9-]+\.)*mercadoli(vre|bre)\.com(\.br)?\//i.test(str(u)) ? str(u) : '')
const urlFoto = u => (/^https?:\/\/([a-z0-9-]+\.)*mlstatic\.com\//i.test(str(u)) ? str(u).replace(/^http:/i, 'https:') : '')

export function criarCrivo({ nomesInternos = [], permitidos = [] } = {}) {
  let omitidas = 0
  const passa = t => {
    const s = str(t).trim()
    if (!s) return false
    if (RX_BASTIDOR.test(s) || auditarTexto(s, { nomesInternos, permitidos }).length) { omitidas++; return false }
    return true
  }
  return {
    linha: t => (passa(t) ? str(t).trim() : null),
    lista: arr => (Array.isArray(arr) ? arr : []).filter(passa).map(x => str(x).trim()),
    get omitidas() { return omitidas },
  }
}

// D6: o que tem executor (Ofertas: ímã de conversão, fotos, frete; regras oferta_*) × o que só é recomendado ("você faz e marca feito")
export function modoDaAcao(acao) {
  const d = acao?.dados || {}, regra = str(acao?.regra).replace(/^anuncio_/, '')
  return (d.executar_via === 'oferta' && !d.executar_via_oferta?.duplicacao) || regra.startsWith('oferta_') ? 'executa' : 'recomenda'
}

// acao = { titulo, regra, prazo, dados, previsao } (linha de acoes_plano já com JSON lido)
export function acaoParaCliente(acao, { nomesInternos = [], permitidos = [] } = {}) {
  const crivo = criarCrivo({ nomesInternos, permitidos }), d = acao?.dados || {}, p = acao?.previsao || d.previsao || null, it = d.item || null
  const cen = p?.cenarios || {}
  const modo = modoDaAcao(acao)
  const out = {
    titulo: crivo.linha(str(acao?.titulo).replace(/\s*\(ML[A-Z]{1,2}\d+\)\s*$/, '')) || 'Prioridade da semana',   // o "(MLB…)" do título vai para anuncio.id
    problema: crivo.linha(d.problema), evidencia: crivo.linha(d.evidencia), hipotese: crivo.linha(d.hipotese),
    como: crivo.lista(d.como), indicador: crivo.linha(d.indicador_inicial), meta: crivo.linha(d.meta), aceite: crivo.linha(d.criterio_aceite),
    previsao: p ? {
      tipo: p.tipo === 'risco_evitado' ? 'risco_evitado' : 'ganho', horizonte_dias: num(p.horizonte_dias),
      cenarios: Object.fromEntries(['conservador', 'base', 'otimista'].map(k => [k, { unidades: num(cen[k]?.unidades), receita: num(cen[k]?.receita) }])),
      premissas: crivo.lista(p.premissas), p_sucesso: num(p.p_sucesso), p_fonte: crivo.linha(p.p_fonte),
    } : null,
    anuncio: it ? { id: str(it.id), titulo: str(it.titulo), permalink: urlAnuncio(it.permalink), thumb: urlFoto(it.thumb) } : null,
    modo, modo_texto: MODO_TEXTO[modo],
    prazo: /^\d{4}-\d{2}-\d{2}$/.test(str(acao?.prazo)) ? acao.prazo : null,
  }
  out.linhas_omitidas = crivo.omitidas
  return out
}
