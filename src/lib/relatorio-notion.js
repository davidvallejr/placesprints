// Relatório de Sprints Place2u no Notion do cliente — (a) PURO: brief → blocos, esquema da base Informações, decisão da categoria;
// (b) fábrica criarRelatorioNotion: resolve o destino (estados, nunca exceção para o que é esperado), consulta por título, cria numa chamada só, arquiva.
// NÃO importa db.js nem notion.js: o cliente do Notion (notion.req), o estado (sync_estado) e a descoberta entram por injeção — o teste usa stub.
// Segurança: o corpo de erro do Notion nunca sai deste módulo (mapeamento fixo); todo id vindo de cache passa por regex antes de entrar numa URL.
import { CATEGORIA } from './relatorio-seguro.js'
import { linhasDePendencia, quandoDe } from './pendencias-texto.js'   // puro: o texto das pendências é o MESMO do PDF semanal, do relatório do sprint e do documento do plano

export { CATEGORIA }
import { readFileSync } from 'node:fs'
// opções JÁ existentes em Secção (status) aceitas no lugar da categoria própria (config/relatorio-envio.json → categoria_alternativas); nunca cria opção
export const CATEGORIA_ALTERNATIVAS = (() => { try { const a = JSON.parse(readFileSync(new URL('../../config/relatorio-envio.json', import.meta.url), 'utf8')).categoria_alternativas; return Array.isArray(a) ? a.map(String).filter(Boolean) : [] } catch { return [] } })()
export const ICONE = '🧭'
export const normNome = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()   // igual a equipe.normNome (aqui não se importa o banco)
export const RX_ID = /^[0-9a-f-]{32,36}$/i
const TTL_MS = 10 * 60_000
const TTL_NEGATIVO_MS = 6 * 3600e3        // "sem Informações" (info_vazio) vale 6 h SÓ para o relatório em lote; PlacePlan e sincronizarPlanos reescaneiam sempre (padrão 0 em plano-informacoes.js)
// cópia de plano-informacoes.parseTituloPlano (aquele módulo importa o banco); o teste prova que os dois concordam
const MES_NUM = { janeiro: 1, fevereiro: 1, marco: 1, abril: 1, maio: 1, junho: 1, julho: 1, agosto: 1, setembro: 1, outubro: 1, novembro: 1, dezembro: 1 }
export const casaTituloPlano = titulo => { const m = normNome(titulo).trim().match(/^([a-zç]+)\s*\/\s*(\d{2,4})\s*-\s*(.+)$/); return !!(m && MES_NUM[m[1]]) }

// ── texto rico e blocos ───────────────────────────────────────────────────────────────────────────────
const LIM = 1900
export function rt(texto, { bold, italic, color } = {}) {
  let s = String(texto ?? ''); if (!s) return []
  const ann = (bold || italic || color) ? { annotations: { ...(bold ? { bold: true } : {}), ...(italic ? { italic: true } : {}), ...(color ? { color } : {}) } } : {}
  const partes = []
  while (s.length > LIM) {                                       // quebra em segmentos ≤1900, de preferência num espaço (nunca trunca em silêncio)
    let corte = s.lastIndexOf(' ', LIM); if (corte < LIM - 400) corte = LIM
    partes.push(s.slice(0, corte)); s = s.slice(corte)
  }
  partes.push(s)
  return partes.filter(Boolean).map(content => ({ type: 'text', text: { content }, ...ann }))
}
const juntar = (...rts) => rts.flat()
const bloco = (type, corpo) => ({ object: 'block', type, [type]: corpo })
const par = (rich, color) => bloco('paragraph', { rich_text: rich, ...(color ? { color } : {}) })
const cinza = texto => par(rt(texto, { color: 'gray' }))
const h2 = t => bloco('heading_2', { rich_text: rt(t) })
const h3 = t => bloco('heading_3', { rich_text: rt(t) })
const marcador = rich => bloco('bulleted_list_item', { rich_text: rich })
const divisor = () => bloco('divider', {})
const celula = (txt, o) => rt(txt, o)                            // vazio vira [] (célula vazia é válida; content '' não é)
const linhaTab = cels => bloco('table_row', { cells: cels.map(c => Array.isArray(c) ? c : celula(c)) })
const tabela = (largura, linhas) => bloco('table', { table_width: largura, has_column_header: true, has_row_header: false, children: linhas.map(linhaTab) })

const lista = v => Array.isArray(v) ? v : []
const txt = v => v === null || v === undefined ? '' : String(v).trim()
const ISO = /^(\d{4})-(\d{2})-(\d{2})/
const dm = iso => { const m = txt(iso).match(ISO); return m ? `${m[3]}/${m[2]}` : '' }
const dma = iso => { const m = txt(iso).match(ISO); return m ? `${m[3]}/${m[2]}/${m[1]}` : '' }
const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const diaSem = iso => { const m = txt(iso).match(ISO); return m ? DIAS[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()] : '' }
const quandoTxt = v => ISO.test(txt(v)) && /^\d{4}-\d{2}-\d{2}(T|$)/.test(txt(v)) ? dm(v) : txt(v)
// valor já formatado pelo brief (string) é usado como veio; número vira texto pt-BR; vazio = "—" (nunca zero inventado)
const val = v => v === null || v === undefined || txt(v) === '' ? '—' : typeof v === 'number' ? (Number.isFinite(v) ? v.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '—') : txt(v)
const n = v => Number.isFinite(Number(v)) ? Number(v) : 0
const plural = (k, um, varios) => `${k} ${k === 1 ? um : varios}`

const COR_TOM = { verde: 'green_background', amarelo: 'yellow_background', laranja: 'orange_background', cinza: 'gray_background' }
const COR_SINAL = { bom: 'green', ruim: 'red', igual: 'gray' }
const SELO = { medido: 'Medido', hipotese: 'Hipótese', informado: 'Informado pela equipe' }
const NIVEL_CONFIANCA = { alta: 'alta', media: 'média', baixa: 'baixa' }                  // o motor manda "media" (sem acento); o texto do cliente leva o acento
// "(n/100)" só com número de verdade: pct null/'' viraria "0/100" (Number(null) === 0)
const confiancaTxt = c => {
  const nivel = NIVEL_CONFIANCA[normNome(txt(c?.nivel)).trim()]
  if (!nivel) return ''
  const pct = c.pct, tem = pct !== null && pct !== undefined && txt(pct) !== '' && Number.isFinite(Number(pct))
  return ` · confiança ${nivel}${tem ? ` (${Math.round(Number(pct))}/100)` : ''}`
}
// "Ajuste de rotina — Mercado Livre · Mercado Livre": o canal já está no rótulo genérico, não se repete
const comCanal = (rotulo, canal) => normNome(txt(rotulo)).endsWith(normNome(txt(canal))) && txt(canal) ? '' : txt(canal)
// período de um grupo de atividades: "02/10 a 06/10" quando o brief manda `fim` além da data inicial (antes só a inicial aparecia)
const periodoTxt = (ini, fim) => { const a = quandoTxt(ini), b = quandoTxt(fim); return a && b && b !== a ? `${a} a ${b}` : a }
const VAZIO = {
  resultados: 'Os números deste período não estão disponíveis; nada foi estimado.',
  concluido: 'Nenhuma ação concluída neste período.', andamento: 'Nenhuma ação em andamento no momento.',
  gerou: 'Nenhuma tarefa concluída tem efeito medido ou informado até agora.', mudou: 'Nenhuma mudança relevante registrada neste período.',
  proximos: 'Sem datas futuras confirmadas para os próximos 14 dias.',
  rodape: 'Números sem coleta aparecem como “—”. A leitura é indicativa; resultados dependem de fatores fora do nosso controle.',
}

// Brief (docs/contrato-relatorio-envio.md) → blocos do Notion. ≤60 blocos de topo, heading só h2/h3, nenhum "undefined", vazios honestos do brief.
export function briefParaBlocos(brief) {
  const B = brief && typeof brief === 'object' ? brief : {}
  const out = []
  const ab = B.abertura || {}, jan = B.janela || {}, res = B.resultados || {}, at = B.atividades || {}, dv = B.desenvolvimento || {}, px = B.proximos || {}, dep = B.depende || {}

  // 1. abertura (callout colorido pelo tom do resultado)
  out.push(bloco('callout', { icon: { type: 'emoji', emoji: ICONE }, color: COR_TOM[ab.tom] || COR_TOM.cinza,
    rich_text: juntar(rt(txt(ab.cabecalho), { bold: true }), rt(txt(ab.frase) ? (txt(ab.cabecalho) ? ' ' : '') + txt(ab.frase) : ''), rt(txt(ab.nudge) ? '\n' + txt(ab.nudge) : '')) }))
  // 1b. alertas (callout VERMELHO logo após a abertura): só pendências críticas, com o que está parado e desde quando — fato datado, sem culpa nem prazo
  const als = lista(B.alertas).filter(a => txt(a?.rotulo)).slice(0, 5)
  if (als.length) {
    const linhaAlerta = a => { const q = quandoDe(a); return `• ${txt(a.rotulo)}${txt(a.canal_rotulo) ? ` · ${txt(a.canal_rotulo)}` : ''}${q ? ` · ${q}` : txt(a.resumo) ? ` — ${txt(a.resumo)}` : ''}` }
    out.push(bloco('callout', { icon: { type: 'emoji', emoji: '⚠️' }, color: 'red_background',
      rich_text: juntar(rt('Pontos que exigem retorno do cliente com prioridade:', { bold: true }), rt('\n' + als.map(linhaAlerta).join('\n'))) }))
  }
  // 2. carimbo
  const quando = `Gerado em ${dma(B.hoje)}${txt(B.hora) ? ` às ${txt(B.hora)}` : ''}`
  const janTxt = txt(jan.rotulo) ? ` · Últimos 7 dias fechados: ${txt(jan.rotulo)}` : ''
  const ant = jan.anterior && dm(jan.anterior.de) ? ` · Comparado com ${dm(jan.anterior.de)} a ${dma(jan.anterior.ate)}` : ''
  out.push(cinza(`${quando}${janTxt}${ant}`))
  out.push(divisor())

  // 3. resultados
  out.push(h2('Resultados'))
  const linhas = lista(res.linhas)
  if (res.disponivel !== false && linhas.length) {
    out.push(tabela(4, [
      ['Indicador', '7 dias', '7 dias anteriores', 'Variação'],
      ...linhas.map(l => {
        const v = l?.variacao
        return [txt(l?.rotulo) || '—', val(l?.atual), val(l?.anterior), v && txt(v.texto) ? celula(txt(v.texto), COR_SINAL[v.sinal] ? { color: COR_SINAL[v.sinal] } : {}) : '—']
      }),
    ]))
    const h = res.hoje
    if (h && txt(h.ate_hora)) {
      const dado = h.faturamento === null || h.faturamento === undefined ? 'sem coleta até agora' : `${val(h.faturamento)}${h.pedidos === null || h.pedidos === undefined ? '' : ` em ${plural(n(h.pedidos), 'pedido', 'pedidos')}`}`
      out.push(par(rt(`Hoje (${dm(B.hoje)}) até ${txt(h.ate_hora)}: ${dado} — dia em andamento, fora da comparação acima.`)))
    }
    if (lista(res.nao_coletado).length) out.push(cinza(`Não coletado nesta semana: ${lista(res.nao_coletado).map(txt).filter(Boolean).join('; ')}.`))
  } else {
    out.push(cinza(txt(res.motivo) || VAZIO.resultados))
  }
  for (const o of lista(res.outros).slice(0, 4)) if (txt(o?.texto)) out.push(cinza(txt(o.canal) ? `${txt(o.canal)}: ${txt(o.texto)}` : txt(o.texto)))

  // 4. atividades
  out.push(h2('Atividades'))
  out.push(h3('Concluído'))
  const conc = at.concluido || {}
  const grupos = lista(conc.grupos)
  if (at.lista && grupos.length) {
    for (const g of grupos.slice(0, 6)) out.push(marcador(rt([`${txt(g?.rotulo)}${n(g?.n) > 1 ? ` (x${n(g.n)})` : ''}`, comCanal(g?.rotulo, g?.canal), periodoTxt(g?.quando, g?.fim)].filter(Boolean).join(' · '))))
  } else if (n(conc.total) > 0) {
    const porCanal = lista(conc.por_canal).filter(c => txt(c?.canal)).map(c => `${txt(c.canal)} ${n(c.n)}`)
    out.push(par(rt(`${plural(n(conc.total), 'ação concluída', 'ações concluídas')}${porCanal.length ? ` — ${porCanal.join(' · ')}` : ''}.`)))
  } else out.push(cinza(VAZIO.concluido))
  out.push(h3('Em andamento'))
  const and = at.andamento || {}
  if (at.lista && lista(and.itens).length) {
    for (const i of lista(and.itens).slice(0, 5)) out.push(marcador(rt([txt(i?.rotulo), comCanal(i?.rotulo, i?.canal), txt(i?.previsto) ? `previsto ${quandoTxt(i.previsto)}` : ''].filter(Boolean).join(' · '))))
  } else if (n(and.total) > 0) out.push(par(rt(`${plural(n(and.total), 'ação em andamento', 'ações em andamento')}.`)))
  else out.push(cinza(VAZIO.andamento))
  const promos = lista(and.promocoes).filter(p => txt(p?.rotulo))
  if (promos.length) {
    out.push(h3('Promoções no ar'))
    for (const p of promos.slice(0, 4)) out.push(marcador(rt(`${txt(p.rotulo)}${txt(p.ate) ? ` · ${ISO.test(txt(p.ate)) ? `até ${dm(p.ate)}` : txt(p.ate)}` : ''}`)))
  }

  // 5. desenvolvimento
  out.push(h2('Desenvolvimento'))
  out.push(h3('Resultados ligados a ações'))                      // não "O que gerou resultado": o título da seção afirmaria causa; o selo de cada item diz medido/hipótese/informado
  const gerou = lista(dv.resultados)
  if (gerou.length) {
    for (const r of gerou.slice(0, 3)) {
      const conf = confiancaTxt(r?.confianca)
      const m = r?.metrica || {}
      out.push(marcador(juntar(rt(txt(r?.rotulo), { bold: true }), rt([comCanal(r?.rotulo, r?.canal), quandoTxt(r?.quando)].filter(Boolean).map(x => ' · ' + x).join('')),
        rt(txt(m.texto) ? ` — ${txt(m.rotulo) ? txt(m.rotulo) + ': ' : ''}${txt(m.texto)}` : ''), rt(` · ${SELO[r?.selo] || SELO.hipotese}${conf}`, { italic: true, color: 'gray' }))))
    }
  } else out.push(cinza(txt(dv.vazio_resultados) || VAZIO.gerou))
  const mud = lista(dv.mudancas).filter(m => txt(m?.texto))
  // sem mudança E sem frase do brief = cliente sem histórico de anúncios (ex.: sem Mercado Livre): a seção some; afirmar "nenhuma mudança" seria dizer o que não foi medido
  if (mud.length || txt(dv.vazio_mudancas)) {
    out.push(h3('O que mudou nos anúncios'))
    if (mud.length) for (const m of mud.slice(0, 5)) out.push(marcador(rt(`${quandoTxt(m.quando) ? quandoTxt(m.quando) + ' · ' : ''}${txt(m.texto)}`)))
    else out.push(cinza(txt(dv.vazio_mudancas)))
  }

  // 6. próximos passos (só datas futuras: o brief já filtra)
  out.push(h2('Próximos passos'))
  const itens = lista(px.itens).filter(i => txt(i?.rotulo)).slice(0, 8)
  const radar = lista(px.radar).filter(i => txt(i?.rotulo)).slice(0, 2)
  const ag = px.agenda && (n(px.agenda.p7) + n(px.agenda.p8_14)) > 0 ? px.agenda : null
  if (itens.length || radar.length || ag) {
    const dataTxt = i => { const d = [diaSem(i.quando), dm(i.quando)].filter(Boolean).join(', '); return (txt(i.fim) && dm(i.fim) ? `${d} a ${dm(i.fim)}` : d || '—') + (i.previsto === true ? ' (previsto)' : '') }   // previsto = prazo de ação só aprovada, ainda sem tarefa distribuída
    out.push(tabela(2, [
      ['Quando', 'O que vem'],
      ...itens.map(i => [dataTxt(i), txt(i.rotulo)]),
      ...radar.map(i => [dataTxt(i), /^no radar/i.test(txt(i.rotulo)) ? txt(i.rotulo) : `No radar: ${txt(i.rotulo)}`]),
      ...(ag ? [['Próximos 14 dias', `${plural(n(ag.p7) + n(ag.p8_14), 'ação já agendada', 'ações já agendadas')} pela equipe (${n(ag.p7)} nos próximos 7 dias, ${n(ag.p8_14)} na semana seguinte)`]] : []),
    ]))
  } else out.push(cinza(txt(px.vazio) || VAZIO.proximos))

  // 7. depende de você (só se houver; sem responsável, sem prazo)
  const dps = lista(dep.itens).filter(i => txt(i?.rotulo)).slice(0, 5)
  const pends = lista(dep.pendencias).filter(p => txt(p?.rotulo)).slice(0, 5)
  if (pends.length) {   // com pendências do avaliador, só elas (tarefa e estoque já estão nelas): uma caixa âmbar por pendência, cada uma com o que precisamos, por que importa, o que acontece se atrasar e o impacto
    out.push(h2('Depende de você'))
    for (const p of pends) {
      const L = linhasDePendencia(p, { linguagem: dep.linguagem }), cab = [txt(L.canal), L.quando].filter(Boolean).join(' · ')
      out.push(bloco('callout', { icon: { type: 'emoji', emoji: '⏳' }, color: 'yellow_background',
        rich_text: juntar(rt(L.titulo, { bold: true }), rt(cab ? ` · ${cab}` : ''), ...L.linhas.map(l => juntar(rt(`\n${l.rotulo}: `, { italic: true }), rt(l.texto)))) }))
    }
    if (n(dep.mais) > 0) out.push(cinza(n(dep.mais) === 1 ? 'Mais 1 ponto também aguarda o seu retorno.' : `Mais ${n(dep.mais)} pontos também aguardam o seu retorno.`))
  } else if (dps.length) {
    out.push(h2('Depende de você'))
    const desde = i => dm(i.desde) ? (i.desde_aproximado === true ? ` · em aberto; data aproximada: ${dm(i.desde)}` : ` · desde ${dm(i.desde)}${Number.isFinite(Number(i.dias)) && i.dias !== null ? ` (${plural(n(i.dias), 'dia', 'dias')})` : ''}`) : ''
    out.push(bloco('callout', { icon: { type: 'emoji', emoji: '⏳' }, color: 'yellow_background', rich_text: rt(dps.map(i => `• ${txt(i.rotulo)}${desde(i)}`).join('\n')) }))
  }

  // 8. rodapé
  out.push(divisor())
  const rodape = lista(B.rodape).map(txt).filter(Boolean).slice(0, 4)
  for (const r of rodape.length ? rodape : [VAZIO.rodape]) out.push(cinza(r))
  return out                                                     // o auditor (limitesNotion) barra o que passar de 60 blocos de topo
}

// ── esquema da base Informações, decisão da categoria e do Status ──────────────────────────────────────────
// chave SEMPRE o texto exato lido do esquema ("Secção " com espaço no fim); normNome só serve para casar
const opcoesDe = p => (p.select?.options || p.status?.options || []).map(o => o?.name).filter(Boolean)
const entrada = (chave, p) => ({ chave, tipo: p.type, opcoes: opcoesDe(p) })
export function esquemaInformacoes(props) {
  const ps = props && typeof props === 'object' ? Object.entries(props) : []
  const tipoOk = p => p?.type === 'select' || p?.type === 'status'
  const tit = ps.find(([, p]) => p?.type === 'title')
  const status = ps.find(([k, p]) => tipoOk(p) && normNome(k).trim() === 'status')
  const secao = ps.find(([k, p]) => tipoOk(p) && /^sec{1,2}ao$/.test(normNome(k).trim()))      // só "Secção"/"Seção"/"Secao" exatos: "Sector", "Seção X" não são a categoria
  return { titulo: tit ? { chave: tit[0] } : null, status: status ? entrada(...status) : null, secao: secao ? entrada(...secao) : null }
}
export const valorPropriedade = (ent, nome) => ({ [ent.tipo]: { name: nome } })

// `categoria`: a opção da Secção a usar (padrão = a do relatório; o alerta passa a sua). Nunca cria opção em Secção do tipo status.
export function decidirCategoria(esq, { semCategoria = false, categoria = CATEGORIA, alternativas = categoria === CATEGORIA ? CATEGORIA_ALTERNATIVAS : [] } = {}) {
  const sec = esq?.secao
  if (!sec) return { estado: 'sem_propriedade', tipo: null, opcao: '', propriedades: {}, bloqueia: false, aviso: 'A base Informações deste cliente não tem a coluna Secção: a página será criada só com o título, sem categoria.' }
  const existente = sec.opcoes.find(o => normNome(o).trim() === normNome(categoria).trim())
  if (existente) return { estado: 'ok', tipo: sec.tipo, opcao: existente, propriedades: { [sec.chave]: valorPropriedade(sec, existente) }, bloqueia: false, aviso: '' }
  if (sec.tipo === 'status') {                                     // 09/10: status sem a opção própria → usa uma alternativa que JÁ existe (ex.: «Relatórios»)
    for (const alt of alternativas) { const op = sec.opcoes.find(o => normNome(o).trim() === normNome(alt).trim()); if (op) return { estado: 'ok_alternativa', tipo: 'status', opcao: op, propriedades: { [sec.chave]: valorPropriedade(sec, op) }, bloqueia: false,
      aviso: `A coluna «${sec.chave.trim()}» não tem a opção «${categoria}»; a página vai na opção existente «${op}».` } }
  }
  if (sec.tipo === 'select') return { estado: 'select_cria', tipo: 'select', opcao: categoria, propriedades: { [sec.chave]: valorPropriedade(sec, categoria) }, bloqueia: false,
    aviso: `A opção «${categoria}» ainda não existe na coluna «${sec.chave.trim()}»: o Notion vai criá-la ao enviar.` }
  if (semCategoria) return { estado: 'padrao_da_base', tipo: 'status', opcao: '', propriedades: {}, bloqueia: false,
    aviso: `A coluna «${sec.chave.trim()}» é do tipo Status e não tem a opção «${categoria}»: a página nasce sem categoria e o Notion pode preencher a opção padrão da base (talvez a categoria errada).` }
  return { estado: 'opcao_ausente_status', tipo: 'status', opcao: '', propriedades: {}, bloqueia: true,
    aviso: `A coluna «${sec.chave.trim()}» é do tipo Status e não tem a opção «${categoria}». O Notion não cria opção de Status pela API: crie a opção em Informações › ${sec.chave.trim()} e envie de novo.` }
}
// Status da página: por padrão "Concluído" (é um relatório publicado, não uma tarefa). `preferidos` = nomes em ordem de preferência (o alerta aberto usa ['pendente', 'em andamento'];
// a resolução, ['concluido']). Só com opção que já existe; nunca cria opção.
const ROTULO_STATUS = { concluido: 'Concluído', pendente: 'Pendente', 'em andamento': 'Em andamento' }
export function decidirStatus(esq, { preferidos = ['concluido'] } = {}) {
  const st = esq?.status
  if (!st) return { propriedades: {}, aviso: '' }
  const lista = (Array.isArray(preferidos) ? preferidos : [preferidos]).map(p => normNome(p).trim()).filter(Boolean)
  for (const p of lista) { const op = st.opcoes.find(o => normNome(o).trim() === p); if (op) return { propriedades: { [st.chave]: valorPropriedade(st, op) }, aviso: '' } }
  const nomes = lista.map(p => ROTULO_STATUS[p] || p)
  return { propriedades: {}, aviso: `A coluna «${st.chave.trim()}» não tem a opção ${nomes.map(x => `«${x}»`).join(' nem ')}: a página nasce sem Status.` }
}

// ── título ───────────────────────────────────────────────────────────────────────────────────────────────────
// exatamente o título do brief; destino compartilhado leva o cliente ao final (a consulta por título não pode adotar a página do outro)
export const tituloFinal = (titulo, { cliente = '', compartilhado = false } = {}) => `${String(titulo ?? '').trim()}${compartilhado && cliente ? ` (${cliente})` : ''}`
// Alerta ao cliente (rodada B): mesma higiene do título do relatório, com o prefixo próprio
export const PREFIXO_ALERTA = 'Alerta Place2u · '
export const tituloAlertaOk = titulo => { const t = String(titulo ?? ''); return t.startsWith(PREFIXO_ALERTA) && t.length > PREFIXO_ALERTA.length && t.length <= 200 && !/[\r\n]/.test(t) && !/placeplan/i.test(t) && !casaTituloPlano(t) }
export const tituloOk = titulo => { const t = String(titulo ?? ''); return t.startsWith(CATEGORIA) && t.length <= 200 && !/[\r\n]/.test(t) && !/placeplan/i.test(t) && !casaTituloPlano(t) }

// ── erros do Notion: mapeamento fixo; o corpo da resposta NUNCA vai para a resposta HTTP nem para o log ───────────────
// 400 tem DUAS causas e mensagens distintas: (a) a base não aceita o que mandamos (coluna/opção mudou) → pede conferir a base; (b) o NOSSO envio é inválido (corpo recusado, id/destino
// interno malformado) → erro do sistema, não da base. 401 = token inválido (não adianta tentar de novo). Em todos: não retentável.
export const MSG_NOTION = {
  0: 'NOTION_TOKEN ausente',
  400: 'a base mudou: confira a coluna de título e a categoria na base Informações',
  401: 'o token do Notion está inválido ou expirou — atualize a integração antes de enviar de novo',
  403: 'a integração não tem permissão para criar páginas na base Informações deste cliente',
  404: 'página ou base fora do acesso da integração',
  payload: 'o Notion recusou o envio por um erro do próprio sistema (conteúdo ou destino inválido) — nada foi criado; avise o time técnico (o log traz o código)',
}
// código → mensagem (relatorio-envio.js faz o spread disto em MSG_FALHA: notion_0, notion_400, notion_401, notion_403, notion_404, notion_payload)
export const MSG_POR_CODIGO = { notion_0: MSG_NOTION[0], notion_400: MSG_NOTION[400], notion_401: MSG_NOTION[401], notion_403: MSG_NOTION[403], notion_404: MSG_NOTION[404], notion_payload: MSG_NOTION.payload }
const CODIGOS_INTERNOS = new Set(['titulo_invalido', 'destino_invalido', 'id_invalido', 'categoria_ausente'])      // erros que NÓS levantamos antes (ou em vez) de falar com o Notion
// o `code`/`message` do corpo só serve para escolher entre as duas mensagens fixas; nada dele sai daqui
const recusaDePayload = e => {
  let corpo = e?.corpo
  if (typeof corpo === 'string') { try { corpo = JSON.parse(corpo) } catch { corpo = { message: corpo } } }
  const code = String(corpo?.code ?? ''), msg = String(corpo?.message ?? '')
  return ['invalid_json', 'invalid_request', 'invalid_request_url', 'missing_version'].includes(code) || /body failed validation|should be (?:≤|<=|a valid)|length should be/i.test(msg)
}
export function classificarErro(e) {
  if (CODIGOS_INTERNOS.has(e?.codigo)) return { status: Number.isInteger(e?.status) ? e.status : null, codigo: 'notion_payload', mensagem: MSG_NOTION.payload, retentavel: false, ambiguo: false }
  const status = Number.isInteger(e?.status) ? e.status : null
  if (status === 400 && recusaDePayload(e)) return { status, codigo: 'notion_payload', mensagem: MSG_NOTION.payload, retentavel: false, ambiguo: false }
  const mensagem = MSG_NOTION[status] || 'Notion indisponível agora — tente de novo'
  return {
    status, codigo: status === null ? 'notion_rede' : `notion_${status}`, mensagem,
    retentavel: ![0, 400, 401, 403, 404].includes(status),         // 400/401/403/404/sem token pausam (repetir não resolve); o resto tem backoff
    ambiguo: status === null || status >= 500,                    // 5xx/timeout/rede: a escrita pode ter acontecido (429 não: o pedido não foi processado)
  }
}
export const MSG_DESTINO = {
  sem_pagina: 'a página do cliente no Notion não foi localizada — confira o id na central',
  pagina_invalida: 'o id da página do cliente na central não é uma página válida do Notion — confira o cadastro',
  sem_base: 'este cliente ainda não tem a base «Informações» na página do Notion',
  base_invalida: 'a base «Informações» deste cliente está inacessível ou mudou — confira no Notion',
  destino_compartilhado: 'a página ou base deste cliente é compartilhada com outro cliente da central — o envio automático fica bloqueado',
  sem_titulo: 'a base «Informações» não tem coluna de título',
  sem_permissao: 'a integração não tem permissão para acessar a página ou a base deste cliente',
}
export const PROXIMA_ACAO = {
  sem_pagina: 'Conferir o id da página do cliente na central', pagina_invalida: 'Conferir o id da página do cliente na central',
  sem_base: 'Criar a base Informações na página do cliente', base_invalida: 'Conferir a base Informações no Notion (acesso da integração)',
  destino_compartilhado: 'Destino compartilhado com outro cliente: enviar só manualmente, com confirmação', sem_titulo: 'Conferir a coluna de título da base Informações',
  sem_permissao: 'Compartilhar a página do cliente com a integração do Notion',
  opcao_ausente_status: `Criar a opção «${CATEGORIA}» em Informações › Secção`, sem_propriedade: 'Criar a coluna Secção na base Informações',
}

export const urlDe = pg => {
  const u = String(pg?.url ?? '')
  if (/^https:\/\/([a-z0-9-]+\.)*notion\.(so|site)\//i.test(u)) return u
  return RX_ID.test(String(pg?.id ?? '')) ? `https://www.notion.so/${String(pg.id).replace(/-/g, '')}` : ''
}
const tituloDaPagina = pg => Object.values(pg?.properties || {}).find(p => p?.type === 'title')?.title?.map(t => t?.plain_text ?? '').join('') || ''

// ── fábrica ──────────────────────────────────────────────────────────────────────────────────────────────────────
// deps: notion.req(caminho, { method, body, retry5xx }) · estado { get, set, listar?(prefixo) → [{chave, valor}] } (sync_estado) · fontes() → [{ cliente, dbId, modo, paginaClienteId }]
//       resolverPaginaCliente({ cliente, paginaClienteId, tarefasDbId, tarefasModo, forcar? }) · acharInformacoesDb(pagina, { ttlNegativoMs? }) · invalidar(cliente, pagina) · agora() ISO
export function criarRelatorioNotion({ notion, estado, fontes, resolverPaginaCliente, acharInformacoesDb, invalidar, agora = () => new Date().toISOString() }) {
  const req = (...args) => notion.req(...args)                    // resolve no momento da chamada (stub/teste pode trocar notion.req depois)
  const t0 = () => Date.parse(agora())
  let memFontes = null
  const schemas = new Map()                                       // ds → { em, esquema }
  const destinosVistos = new Map()                                // cliente → ds resolvido nesta execução (para achar dois clientes no MESMO data source, inclusive o de `relatorio_base:`)

  function invalidarCaches() { memFontes = null; schemas.clear(); destinosVistos.clear() }
  function listaFontes(forcar) {
    if (!forcar && memFontes && t0() - memFontes.em < TTL_MS) return memFontes.p
    const p = Promise.resolve().then(fontes); memFontes = { em: t0(), p }
    p.catch(() => { if (memFontes?.p === p) memFontes = null })
    return p
  }
  async function esquemaDe(ds) {
    const hit = schemas.get(ds)
    if (hit && t0() - hit.em < TTL_MS) return hit.esquema
    const s = await req(`data_sources/${ds}`)
    const esquema = esquemaInformacoes(s?.properties)
    schemas.set(ds, { em: t0(), esquema })
    return esquema
  }
  // GET que transforma 400/404 em null e 403 em 'sem_permissao'; o resto sobe (5xx/rede não viram estado de destino)
  async function ler(caminho) {
    try { return { v: await req(caminho) } } catch (e) {
      if (e?.status === 403) return { negado: true }
      if (e?.status === 400 || e?.status === 404) return { v: null }
      throw e
    }
  }
  const mesmoId = (a, b) => !!a && !!b && String(a).replace(/-/g, '').toLowerCase() === String(b).replace(/-/g, '').toLowerCase()
  const compartilhadoCom = (cliente, pagina, fonte, todas, ds = '') => {
    const nomes = new Set()
    for (const r of estado.listar ? estado.listar('pagina_cliente:') : []) if (mesmoId(r.valor, pagina) && r.chave !== `pagina_cliente:${cliente}`) nomes.add(r.chave.slice('pagina_cliente:'.length))
    for (const f of todas) if (f.cliente && f.cliente !== cliente && fonte.dbId && f.dbId === fonte.dbId) nomes.add(f.cliente)
    if (ds) {                                                      // por data source: o desvio manual (`relatorio_base:`) e o que já foi resolvido nesta execução
      for (const r of estado.listar ? estado.listar('relatorio_base:') : []) if (mesmoId(r.valor, ds) && r.chave !== `relatorio_base:${cliente}`) nomes.add(r.chave.slice('relatorio_base:'.length))
      for (const [c, d] of destinosVistos) if (c !== cliente && mesmoId(d, ds)) nomes.add(c)
    }
    return [...nomes].sort()
  }

  // destino do relatório: SEMPRE devolve um estado (ok | sem_pagina | pagina_invalida | sem_base | base_invalida | destino_compartilhado | sem_titulo | sem_permissao).
  // Em ok e destino_compartilhado traz ds + esquema; a política (bloquear/pedir confirmação) é de quem chama.
  async function destinoDe(cliente, { forcar = false, reescanear = false } = {}) {
    const fim = (estadoDestino, extra = {}) => ({ estado: estadoDestino, cliente, pagina: '', pagina_titulo: '', informacoes: '', informacoes_url: '', ds: '', esquema: null, compartilhado: [],
      mensagem: MSG_DESTINO[estadoDestino] || '', ...extra })
    if (forcar || reescanear) schemas.clear()                      // "forçar"/"Verificar bases" leem o esquema de novo (o líder pode ter criado a opção agora)
    const todas = await listaFontes(forcar)
    const fonte = todas.find(f => f.cliente === cliente)
    if (!fonte) return fim('sem_pagina')
    const params = { cliente, paginaClienteId: fonte.paginaClienteId, tarefasDbId: fonte.dbId, tarefasModo: fonte.modo }

    // base posta à mão pelo líder (data source id): pula página e Informações
    const manual = estado.get(`relatorio_base:${cliente}`)
    if (manual && RX_ID.test(manual)) {
      const esquema = await esquemaDe(manual).catch(e => { if ([400, 404].includes(e?.status)) return null; throw e })
      if (!esquema) return fim('base_invalida')
      if (!esquema.titulo) return fim('sem_titulo', { ds: manual, esquema })
      const outrosM = compartilhadoCom(cliente, '', fonte, todas, manual)              // o desvio manual também pode apontar para a base de OUTRO cliente
      destinosVistos.set(cliente, manual)
      return fim(outrosM.length ? 'destino_compartilhado' : 'ok', { ds: manual, esquema, compartilhado: outrosM })
    }

    // página do cliente: validada (GET pages/{id}); uma única revalidação com a resolução forçada
    const pagina0 = async f => { const p = await resolverPaginaCliente({ ...params, ...(f ? { forcar: true } : {}) }); const v = RX_ID.test(String(p || '')) ? await ler(`pages/${p}`) : { v: null }; return { p, v } }
    const valida = r => r.v?.v && r.v.v.object === 'page' && !r.v.v.archived && !r.v.v.in_trash
    let r = await pagina0(forcar)
    if (r.v.negado) return fim('sem_permissao')
    if (!valida(r)) {
      const havia = r.p
      invalidar(cliente, havia || '')
      r = await pagina0(true)
      if (r.v.negado) return fim('sem_permissao')
      if (!r.p) return fim('sem_pagina')
      if (!valida(r)) return fim('pagina_invalida')
    }
    const pagina = r.p, paginaTitulo = tituloDaPagina(r.v.v)

    // base Informações da página (PaginaInvalida = a página não tem filhos: o id era de outra coisa → mesma revalidação, uma vez)
    let info
    const ttlNegativo = reescanear || forcar ? 0 : TTL_NEGATIVO_MS                   // "Verificar bases": ignora o cache de 6 h de "sem Informações" (o líder pode ter criado a base agora)
    try { info = await acharInformacoesDb(pagina, { ttlNegativoMs: ttlNegativo }) } catch (e) {
      if (e?.name !== 'PaginaInvalida') throw e
      invalidar(cliente, pagina); return fim('pagina_invalida')
    }
    if (!info) return fim('sem_base', { pagina, pagina_titulo: paginaTitulo })
    const base = async id => RX_ID.test(String(id || '')) ? ler(`databases/${id}`) : { v: null }
    let b = await base(info)
    if (b.negado) return fim('sem_permissao', { pagina, pagina_titulo: paginaTitulo })
    if (!b.v) {                                                    // cache velho: reescaneia uma vez
      invalidar(cliente, pagina)
      try { info = await acharInformacoesDb(pagina, { ttlNegativoMs: 0 }) } catch (e) { if (e?.name !== 'PaginaInvalida') throw e; return fim('pagina_invalida') }
      if (!info) return fim('sem_base', { pagina, pagina_titulo: paginaTitulo })
      b = await base(info)
      if (b.negado) return fim('sem_permissao', { pagina, pagina_titulo: paginaTitulo })
      if (!b.v) return fim('base_invalida', { pagina, pagina_titulo: paginaTitulo, informacoes: info })
    }
    const dss = lista(b.v.data_sources)
    const ds = dss.length === 1 ? dss[0].id : dss.find(d => /informa/i.test(d?.name || ''))?.id || (dss.length ? '' : info)   // sem data_sources = base legada: o próprio id
    const comum = { pagina, pagina_titulo: paginaTitulo, informacoes: info, informacoes_url: urlDe({ url: b.v.url, id: info }) }
    if (!ds || !RX_ID.test(String(ds))) return fim('base_invalida', comum)
    let esquema
    try { esquema = await esquemaDe(ds) } catch (e) { if (e?.status === 403) return fim('sem_permissao', comum); if ([400, 404].includes(e?.status)) return fim('base_invalida', comum); throw e }
    if (!esquema.titulo) return fim('sem_titulo', { ...comum, ds, esquema })
    const outros = compartilhadoCom(cliente, pagina, fonte, todas, ds)
    destinosVistos.set(cliente, ds)
    return fim(outros.length ? 'destino_compartilhado' : 'ok', { ...comum, ds, esquema, compartilhado: outros })
  }

  // páginas vivas do período com este título exato (mais nova primeiro)
  async function acharPorTitulo(destino, titulo) {
    if (!RX_ID.test(String(destino?.ds || ''))) throw Object.assign(new Error('destino inválido'), { status: 400, codigo: 'destino_invalido' })   // erro NOSSO: classificarErro não o confunde com "a base mudou"
    const r = await req(`data_sources/${destino.ds}/query`, { method: 'POST', body: { filter: { property: destino.esquema.titulo.chave, title: { equals: titulo } }, page_size: 10 } })
    return lista(r?.results).filter(p => p && !p.archived && !p.in_trash && RX_ID.test(String(p.id || '')))
      .map(p => ({ id: p.id, url: urlDe(p), created_time: p.created_time || '' }))
      .sort((a, b2) => String(b2.created_time).localeCompare(String(a.created_time)))
  }
  // adotar = reconhecer a página que já existe (sem escrever): a mais nova é a viva; as demais são duplicatas do mesmo título
  async function adotar(destino, titulo) {
    const achadas = await acharPorTitulo(destino, titulo)
    return { pagina: achadas[0] || null, duplicadas: achadas.slice(1) }
  }
  // UMA chamada de escrita: propriedades + todos os blocos (≤100 por lista, ≤2 níveis). 5xx/timeout NÃO reenvia (retry5xx:false); quem chama consulta por título.
  // Reaproveitável (alerta ao cliente): `validarTitulo`, `icone`, `categoria` e `statusPreferido` têm como padrão os do relatório. `propriedades` explícitas valem como vieram (o relatório
  // as calcula na prévia); sem elas, a categoria e o Status saem do esquema do destino, só com opção que já existe.
  async function criar({ destino, titulo, blocos, propriedades, validarTitulo = tituloOk, icone = ICONE, categoria = CATEGORIA, statusPreferido }) {
    if (!validarTitulo(titulo)) throw Object.assign(new Error('título inválido'), { codigo: 'titulo_invalido' })
    if (!RX_ID.test(String(destino?.ds || '')) || !destino.esquema?.titulo) throw Object.assign(new Error('destino inválido'), { codigo: 'destino_invalido' })
    let props = propriedades
    if (props === undefined) {
      const cat = decidirCategoria(destino.esquema, { categoria })
      if (cat.bloqueia) throw Object.assign(new Error('categoria ausente'), { codigo: 'categoria_ausente' })
      props = { ...cat.propriedades, ...decidirStatus(destino.esquema, statusPreferido ? { preferidos: statusPreferido } : undefined).propriedades }
    }
    const body = { parent: { data_source_id: destino.ds }, icon: { type: 'emoji', emoji: icone },
      properties: { [destino.esquema.titulo.chave]: { title: rt(titulo) }, ...props }, children: blocos }
    let pg
    try { pg = await req('pages', { method: 'POST', body, retry5xx: false }) } finally { schemas.delete(destino.ds) }   // o Notion pode ter criado a opção de Secção agora: o esquema em cache ficou velho
    if (!RX_ID.test(String(pg?.id || ''))) throw Object.assign(new Error('resposta sem id'), { status: 502 })
    return { id: pg.id, url: urlDe(pg) }
  }
  async function arquivar(id) {
    if (!RX_ID.test(String(id || ''))) throw Object.assign(new Error('id inválido'), { status: 400, codigo: 'id_invalido' })
    await req(`pages/${id}`, { method: 'PATCH', body: { archived: true } })
    return true
  }
  // muda o Status de uma página já criada (o alerta aberto vira "Concluído" ao ser resolvido). Só com a opção que JÁ existe na base; nunca cria opção.
  // → { ok:true, status:'Concluído' } | { ok:false, motivo:'sem_destino'|'sem_status'|'sem_opcao' }. Erros do Notion sobem (classificarErro).
  async function atualizarStatus(pageId, nome) {
    if (!RX_ID.test(String(pageId || ''))) throw Object.assign(new Error('id inválido'), { status: 400, codigo: 'id_invalido' })
    const pg = await req(`pages/${pageId}`)
    const ds = pg?.parent?.data_source_id
    if (!RX_ID.test(String(ds || ''))) return { ok: false, motivo: 'sem_destino' }
    const st = (await esquemaDe(ds)).status
    if (!st) return { ok: false, motivo: 'sem_status' }
    const op = st.opcoes.find(o => normNome(o).trim() === normNome(nome).trim())
    if (!op) return { ok: false, motivo: 'sem_opcao' }
    await req(`pages/${pageId}`, { method: 'PATCH', body: { properties: { [st.chave]: valorPropriedade(st, op) } } })
    return { ok: true, status: op }
  }
  return { destinoDe, acharPorTitulo, adotar, criar, arquivar, atualizarStatus, invalidarCaches }
}
