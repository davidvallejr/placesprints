// Texto ÚNICO das pendências do cliente nos relatórios (curto do Notion, PDF semanal, relatório do sprint e documento do plano).
// Puro: sem banco, sem rede, sem import. Consome a `Pendencia` do avaliador (src/lib/pendencias-cliente.js, contrato em docs/contrato-pendencias-cliente.md)
// ou a forma já normalizada que o brief guarda (`depende.pendencias[]`), e devolve as MESMAS linhas para os quatro relatórios — só o rótulo da linha varia com a
// `linguagem` do perfil. Os textos de "por que importa / se atrasar / o que precisamos" são os templates FIXOS do catálogo (nunca texto livre).
// Tom: factual e neutro, sem culpa, sem promessa, sem nome interno/responsável/prazo/ID; associação ≠ causalidade.
// Honestidade: R$ só quando o avaliador mediu ou previu COM premissa; sem base = "Impacto não estimado" (nunca zero); dado ausente = linha omitida ou "—".

const str = v => typeof v === 'string' ? v.trim() : ''
const ISO = /^\d{4}-\d{2}-\d{2}$/
const dm = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
const brl = v => 'R$ ' + Math.round(v).toLocaleString('pt-BR')                    // reais inteiros: o mesmo arredondamento explícito do avaliador
const RANK = { critico: 0, atencao: 1, info: 2 }

// rótulos das linhas por linguagem do perfil (padrao | simples | tecnica); o conteúdo das linhas é o mesmo
const ROT = {
  padrao: { por_que: 'Por que importa', atraso: 'Se atrasar', precisamos: 'O que precisamos', impacto: 'Impacto possível', sem_impacto: 'Impacto não estimado', fazemos: 'O que fazemos quando recebermos' },
  simples: { por_que: 'Por que isso importa', atraso: 'O que acontece se atrasar', precisamos: 'O que precisamos de você', impacto: 'Quanto pode impactar', sem_impacto: 'Impacto não estimado', fazemos: 'O que fazemos quando recebermos' },
}
ROT.tecnica = ROT.padrao                                                           // ponytail: a premissa da estimativa já traz os números; sem linha extra para o perfil técnico

// "Impacto não estimado: 2 tarefa(s) parada(s) há 15 dia(s)" / "Impacto não estimado (parado: X)" → só o complemento (o rótulo da linha já diz "não estimado")
function complementoNaoEstimado(rotulo) {
  let r = str(rotulo).replace(/^Impacto não estimado\s*/i, '').replace(/^[:\s]+/, '')
  const par = /^\((.*)\)$/s.exec(r)
  if (par) r = par[1]
  r = r.replace(/^parado:\s*/i, 'em espera — ').replace(/[.\s]+$/, '')
  return r || 'sem base de cálculo nesta leitura'
}

// Pendencia (avaliador) → forma que o brief guarda e que linhasDePendencia entende. Já normalizada (sem `impacto` objeto) passa como veio.
export function pendenciaParaCliente(p) {
  if (p && typeof p === 'object' && p.impacto === undefined && typeof p.impacto_texto === 'string') return p
  const i = p?.impacto && typeof p.impacto === 'object' ? p.impacto : {}
  const valor = Number.isFinite(i.valor_brl) && i.valor_brl > 0 ? i.valor_brl : null           // zero ou ausente nunca vira R$
  const premissa = str(i.premissa).replace(/^Estimativa:\s*/i, '')                    // o rótulo "(estimativa)" já diz; não repetir
  const estimado = valor !== null && ((i.tipo === 'previsto' && premissa) || i.tipo === 'medido')    // estimativa sem premissa declarada não é mostrada como valor
  const tipo = estimado ? i.tipo : 'sem_estimativa'
  const impacto_texto = estimado ? `${brl(valor)} (${tipo === 'medido' ? 'medido' : 'estimativa'})${premissa ? `. Premissa: ${premissa.replace(/[.\s]+$/, '')}.` : ''}` : complementoNaoEstimado(i.rotulo)
  const aprox = p?.desde_aproximado === true
  const dias = !aprox && Number.isFinite(p?.dias) && p.dias >= 0 ? p.dias : null          // data aproximada (última edição do card) nunca carrega contagem de dias na forma do cliente
  return {
    rotulo: str(p?.rotulo), canal_rotulo: str(p?.canal_rotulo), gravidade: Object.hasOwn(RANK, p?.gravidade) ? p.gravidade : 'info',
    desde: ISO.test(str(p?.desde)) ? str(p.desde) : null, dias, desde_aproximado: aprox,
    por_que_importa: str(p?.por_que_importa), efeito_se_atrasar: str(p?.efeito_se_atrasar), o_que_precisamos: str(p?.o_que_precisamos), o_que_fazemos: str(p?.o_que_fazemos),
    impacto_texto, impacto_tipo: tipo,
  }
}

// "desde 02/10 (6 dias)" quando a data é real; "em aberto; data aproximada: 02/06" quando veio da última edição do card (NUNCA contagem de dias);
// '' quando não há data (nada de data inventada)
export function quandoDe(c) {
  if (!ISO.test(str(c?.desde))) return ''
  if (c.desde_aproximado === true) return `em aberto; data aproximada: ${dm(c.desde)}`
  const d = Number.isFinite(c.dias) && c.dias >= 0 ? c.dias : null
  return `desde ${dm(c.desde)}${d !== null ? ` (${d} ${d === 1 ? 'dia' : 'dias'})` : ''}`
}

// fato datado de UMA pendência de tarefa com data aproximada (sem dias, sem "última atualização", sem "card"); usado pelo avaliador (texto ao cliente) e,
// como defesa em profundidade, por quem monta texto ao cliente a partir da pendência (alerta, resumo do brief)
export function fatoAproximado(n, desde) {
  const q = Number.isInteger(n) && n > 0 ? `${n} ${n === 1 ? 'tarefa aguarda' : 'tarefas aguardam'} o retorno do cliente` : 'Há pontos aguardando o retorno do cliente'
  return `${q} (em aberto${ISO.test(str(desde)) ? `; data aproximada: ${dm(desde)}` : ''}).`
}
// evidência que pode ir ao cliente: aproximada é sempre reconstruída (nunca confia no texto interno); data real segue a evidência do avaliador
export const fatoParaCliente = p => p?.desde_aproximado === true ? fatoAproximado(p.tarefas, p.desde) : str(p?.evidencia)

// primeira frase da evidência (datada e factual), no máximo ~170 caracteres, para o resumo do alerta
export function resumoCurto(evidencia, max = 170) {
  let t = str(evidencia).split(/(?<=[.!?])\s/)[0]
  if (t.length > max) {
    const corte = t.slice(0, max), i = Math.max(corte.lastIndexOf(';'), corte.lastIndexOf(':'))
    t = i > 40 ? corte.slice(0, i) : corte.slice(0, corte.lastIndexOf(' ')) + '…'
  }
  t = t.replace(/[\s;:,]+$/, '')
  return t && !/[.!?…]$/.test(t) ? t + '.' : t
}

// ordem única: gravidade, maior valor em R$ (quando houver), mais dias de espera, id estável. Recebe Pendencia (com `impacto`) ou a forma normalizada.
export const ordemPendencias = (a, b) => RANK[a.gravidade] - RANK[b.gravidade] || (b.impacto?.valor_brl ?? -1) - (a.impacto?.valor_brl ?? -1) || (b.dias ?? -1) - (a.dias ?? -1) || String(a.id ?? '').localeCompare(String(b.id ?? ''))

// As linhas que os quatro relatórios mostram. { titulo, canal, quando, gravidade, linhas:[{ chave, rotulo, texto }] }
export function linhasDePendencia(p, { linguagem } = {}) {
  const c = pendenciaParaCliente(p), L = ROT[linguagem] || ROT.padrao
  const naoEstimado = c.impacto_tipo === 'sem_estimativa'
  const linhas = [
    { chave: 'por_que', rotulo: L.por_que, texto: c.por_que_importa },
    { chave: 'atraso', rotulo: L.atraso, texto: c.efeito_se_atrasar },
    { chave: 'precisamos', rotulo: L.precisamos, texto: c.o_que_precisamos },
    { chave: 'impacto', rotulo: naoEstimado ? L.sem_impacto : L.impacto, texto: c.impacto_texto },
    { chave: 'fazemos', rotulo: L.fazemos, texto: c.o_que_fazemos },                 // 5ª linha: registra o trabalho da Place2u quando o retorno chegar
  ]
  return { titulo: c.rotulo, canal: c.canal_rotulo, quando: quandoDe(c), gravidade: c.gravidade, impacto_tipo: c.impacto_tipo, linhas: linhas.filter(l => str(l.texto)) }
}

// todas as strings que vão ao cliente nesta pendência (para o auditor do brief; o resto do texto é rótulo fixo daqui)
export const textosDaPendencia = c => [c.rotulo, c.canal_rotulo, c.por_que_importa, c.efeito_se_atrasar, c.o_que_precisamos, c.o_que_fazemos, c.impacto_texto].filter(t => typeof t === 'string' && t)
