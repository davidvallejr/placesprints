// Texto ao cliente no TOM APROVADO pelo David em 12/10/2026 (modelo validado com dados reais em scripts/previa-plano-semana.mjs, que importa daqui):
// (a) PLANO SEMANAL — toda segunda 09:00 no fuso do cliente; (b) URGENTE — na hora, curto, mesmo tom. Só Mercado Livre.
// PURO: sem banco, sem rede, sem relógio (só lê config/perfil-informacao.json → relatorio). Quem lê os dados é gatilhos-real.js (dadosPlanoSemana); quem decide QUANDO sai é gatilhos.js.
// (c) RELATÓRIO PERSONALIZADO (Etapa 3, 13/10/2026): com `perfil` ({ ordem, temas, nivel } = perfil-informacao.ler → efetivo) a mensagem segue a ordem do perfil — base fixa
// (vendas no cabeçalho, ✅ entregas, 🎯 plano com o 📦, 🛒 compras) e os blocos PEDIDOS no topo (📊 🛠️ 🔍 📉 📣 🏷️ 🆚 🚀 ✨, dados em `info`); nível didático = linha
// «💡 O que isso significa» por bloco + mini-glossário no rodapé. Sem `perfil` o texto é EXATAMENTE o do tom aprovado (scripts/previa-plano-semana.mjs, consultor).
// Regras do texto: nunca promessa ("tenho certeza", "garantido", ranking), nunca culpa, nunca "O que depende de você"; entrega da equipe = FATO ("desde então",
// nunca "graças a"); toda quantidade é estimativa pelo ritmo de 28 dias e a nota diz isso.
// Auditor: o texto inteiro passa pelo relatorio-seguro. As frases FIXAS aprovadas (abertura, fecho, assinatura, nota) e os links de anúncio do Mercado Livre saem do crivo
// (semFixos) porque o gabarito do auditor barraria o tom aprovado: «Merovíngio» e «Place Sprints» contam como jargão, «trouxe informações» como causalidade e o link
// do anúncio (…/MLB-123…) como ID interno. Só ESSAS strings exatas saem; todo o resto (nomes de produto, números, blocos, títulos) passa pelo crivo inteiro.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './env.js'
import { emRuptura, riscoRuptura } from './lead-time.js'
import { representaEstoque, estoqueDe, sufixoAnuncios, envioDoProprio } from './produto-estoque.js'   // V3 F3: 1 linha por estoque físico, números do produto; sem i.produto, nada muda

export const ABERTURA = 'Oie, tudo bem? 👋\n\nEu sou o *Merovíngio*, a inteligência do *Place Sprints* da Place2u. Analisei a sua conta do Mercado Livre de ponta a ponta (vendas, anúncios, estoque e Full) e trouxe informações *ultra relevantes*: pontos que protegem o seu faturamento dos próximos dias e abrem espaço para vender mais. Bora? 🚀'
export const FECHO = 'Se algum desses pontos já está encaminhado, é só responder aqui com a data prevista que a gente ajusta o acompanhamento. Conte com a gente! 🤝'
export const ASSINATURA = '*Merovíngio · Place Sprints | Equipe Place2u*'
export const NOTA = '_Valores estimados pelo ritmo de vendas dos últimos 28 dias._'
// com o 🛒 no texto: a compra pode somar a alta recente e a data comercial (premissas no próprio bloco), então a nota diz isso
export const NOTA_COMPRAS = '_Valores estimados pelo ritmo de vendas dos últimos 28 dias; nas compras, o maior número inclui as premissas do bloco._'
const URG_ABRE = 'Oi, time ', URG_UM = '! Passando rapidinho com um ponto importante da sua conta no Mercado Livre:', URG_VARIOS = '! Passando rapidinho com pontos importantes da sua conta no Mercado Livre:'
const URG_FECHO = 'Se já está encaminhado, é só responder aqui com a data prevista que a gente ajusta o acompanhamento. Conte com a gente! 🤝'
// urgente de ESTOQUE e PREÇO com impacto em R$ (14/10/2026): premissa curta da estimativa (uma vez, no rodapé) e o «ainda cedo» do preço que acabou de subir
export const IMPACTO_PREMISSA = '_Estimativa pelo ritmo de vendas dos últimos 28 dias; não é garantia._'
const IMPACTO_CEDO = '💰 *Impacto:* ainda cedo para medir. Preço mais alto pode reduzir a conversão e a posição na busca; a gente acompanha as vendas dos próximos dias.'
// relatório FOCADO (14/10/2026): abertura no tom aprovado, citando SÓ as seções que entraram (sem o 🛠️ = zero tarefa confirmada; sem ✅ = nada medido); as 6 combinações
// possíveis entram em FIXOS. Sem linha no 📦 (nada a pedir nem a repor) o fecho não pede «data prevista»: FECHO_CURTO.
const FOCO_ABRE = 'Oie, tudo bem? 👋\n\nAqui é o *Merovíngio*, a inteligência do *Place Sprints* da Place2u. Trouxe um resumo rápido da sua conta no Mercado Livre'
const FOCO_PONTOS = { estoque: 'o estoque dos produtos que mais vendem', tarefas: 'o que a nossa equipe fez na sua conta', resultados: 'o que já está dando resultado', medicao: 'o que segue em medição' }
export const aberturaFoco = ks => { const l = ks.map(k => FOCO_PONTOS[k]); return l.length > 1 ? `${FOCO_ABRE} em ${l.length} pontos: ${l.slice(0, -1).join(', ')} e ${l.at(-1)}.` : `${FOCO_ABRE}: ${l[0]}.` }
const ABERTURAS_FOCO = [['tarefas'], []].flatMap(t => [['resultados'], ['medicao'], []].map(r => aberturaFoco(['estoque', ...t, ...r])))
export const ABERTURA_FOCO = aberturaFoco(['estoque', 'tarefas', 'resultados']), ABERTURA_FOCO_2 = aberturaFoco(['estoque', 'resultados'])
export const FECHO_CURTO = 'Conte com a gente! 🤝'   // 14/10: vem logo depois da PERGUNTA_FOCO (que já pede a resposta)
// pergunta do relatório focado (14/10): puxa resposta; a coleta reconhece a abertura do focado como âncora com janela (config/respostas-relatorio.json)
export const PERGUNTA_FOCO = '💬 Esse resumo ajuda no seu dia a dia? Responda aqui o que achou ou o que você quer que a gente acompanhe mais de perto.'
// MICRO-RELATÓRIO DE COMPRAS (pedido do David, 15/10/2026): frases fixas aprovadas (saem do crivo como as outras; «Merovíngio» conta como jargão no gabarito)
const MICRO_UM = '! Aqui é o *Merovíngio*, da Place2u. Separei os produtos que dependem do próximo pedido de compra e quanto de venda está em jogo se a reposição não acontecer:'
export const MICRO_RESPOSTA = 'Se o pedido já saiu, responda com a data prevista que ajustamos.'
const MICRO_GARANTIA = '; não é garantia._'
const FIXOS = [...ABERTURAS_FOCO, MICRO_UM, MICRO_RESPOSTA, MICRO_GARANTIA, ABERTURA, FECHO, FECHO_CURTO, PERGUNTA_FOCO, URG_FECHO, ASSINATURA, NOTA_COMPRAS, NOTA, IMPACTO_PREMISSA, IMPACTO_CEDO, URG_UM, URG_VARIOS, URG_ABRE]
const LINK_ML = /https:\/\/(?:produto|articulo|www|lista)\.mercadolivre\.com\.br\/[^\s]+/g
// o MLB no começo da linha do micro-relatório de compras («• MLB123 · …», pedido do David) é o código do anúncio do PRÓPRIO cliente, como o link: só esse formato sai do crivo
const MLB_MICRO = /^• MLB\d{5,15} · /gm
export const semFixos = texto => FIXOS.reduce((t, f) => t.split(f).join('\n'), String(texto ?? '')).replace(LINK_ML, '').replace(MLB_MICRO, '• ')
// crivo da mensagem inteira, LINHA A LINHA (cada linha vira um parágrafo no Notion; o limite de 1900 caracteres por trecho é de lá, e o plano tem ~5 mil caracteres)
export const auditarMensagem = (texto, auditar, opts) => semFixos(texto).split('\n').filter(l => l.trim()).flatMap(l => auditar(l, opts))
// título da página no Notion / assunto do e-mail (o WhatsApp leva só o texto)
export const TITULO = { semanal: 'Plano da semana', imediato: 'Ponto importante da conta' }

// cabeçalho (emoji + título-benefício) de cada gatilho que vira bloco de mensagem; a linha do gatilho (template do catálogo) é o fato logo abaixo
export const BLOCOS = {
  ruptura_curva_a: ['📦', 'Estoque acabando nos campeões de venda'],
  estoque_zerado: ['🛑', 'Produto que vendia está sem estoque e fora da busca'],   // 14/10: curva B com 1 unidade não é «campeão» (o focado diz «Já fora do ar»)
  ciclo_estoque_previsto: ['🛒', 'Hora de fazer o pedido ao fornecedor'],
  envio_atrasado: ['🚚', 'Pedido com despacho vencido'],
  reclamacao_mediacao: ['⚠️', 'Reclamação aguardando a sua resposta'],
  reputacao_em_risco: ['🛡️', 'Reputação pedindo atenção'],
  anuncio_restrito: ['⏸️', 'Anúncio que vendia está fora do ar'],
  queda_por_preco: ['📉', 'Rever o preço que pode estar segurando as vendas'],
  preco_alterado_drastico: ['🏷️', 'Conferir o preço que mudou fora das nossas ações'],
  perguntas_sem_resposta: ['💬', 'Responder as perguntas dos compradores'],
  envio_full_sugerido: ['🚚', 'Levar ao Full quem já vende bem fora dele'],
  dependencia_vencida: ['🤝', 'Liberar os próximos passos da sua conta'],
}
// ordem do plano: o modelo aprovado (📦 🔄 💡 📊) com os urgentes que ainda não saíram logo depois do estoque (o plano da segunda os leva: uma mensagem só), preço em
// seguida; os demais pontos do cliente entram depois; teto de 5 ações
const ORDEM = ['ruptura', 'envio_atrasado', 'reclamacao_mediacao', 'reputacao_em_risco', 'anuncio_restrito', 'queda_por_preco', 'preco_alterado_drastico', 'ciclo', 'parado', 'custos', 'perguntas_sem_resposta', 'envio_full_sugerido', 'dependencia_vencida']
export const MAX_ACOES = 5

const brl = n => 'R$ ' + Math.round(n).toLocaleString('pt-BR')
const dm = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
const mais = (iso, n) => { const x = new Date(iso + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const limpo = t => String(t || '').replace(/\s+/g, ' ').trim()
// nome curto: 6 palavras, sem conector solto, parêntese aberto nem pontuação no fim ("Kit 2 Roldana 3 Polegada (7,5" → "Kit 2 Roldana 3 Polegada"); número no fim leva
// a unidade seguinte ("Lattafa 100" → "Lattafa 100 Ml"; «170 X» não). unidade:false = o corte seco em 6 palavras (é ele que decide se o nome curto se repete: «10 Caixa» × «10 Caixas»)
const SOLTO = /^(de|da|do|das|dos|para|com|em|e|c\/|-|–|\+|\|)$/i, UNIDADE = /^(m?l|litros?|k?g|gramas?|mg|[cm]?m|metros?|un|unid\.?|unidades?|p[cç]s|pe[cç]as|dentes|pol(egadas?)?|w|v)$/i
const aparar = (w, min = 2) => { w = [...w]; for (;;) { const u = w.at(-1).replace(/[,;:/]+$/, ''); if (w.length > min && (SOLTO.test(w.at(-1)) || /\([^)]*$/.test(w.at(-1)) || !u || SOLTO.test(u))) { w.pop(); continue } w[w.length - 1] = u; return w.join(' ').trim() } }
export const nome = (t, { unidade = true } = {}) => {
  const todas = limpo(t).split(' '), w = todas.slice(0, 6)
  if (unidade && todas.length > 6 && /^\d+([.,]\d+)?$/.test(w.at(-1)) && UNIDADE.test(todas[6])) w.push(todas[6])
  return aparar(w)
}
const semana = i => (estoqueDe(i).r || 0) / 4            // F3: receita do estoque físico inteiro (anúncios do mesmo estoque)
// premissa fixa ao cliente quando alguma linha do bloco junta anúncios do mesmo estoque (desenho § 8.6)
export const PREMISSA_PRODUTO = 'Contamos o estoque uma vez por produto: no Mercado Livre, anúncios do mesmo produto vendem do mesmo estoque.'
const algumGrupo = l => l.some(i => estoqueDe(i).n > 1)
// linhas de compra (preverCompras) indexadas também pelos irmãos do produto: o representante do estoque físico acha a linha do produto dele
const mapaCompras = itens => { const m = new Map(); for (const x of itens || []) for (const id of x.produto?.itens || [x.id]) if (!m.has(String(id))) m.set(String(id), x); return m }
export const diasTxt = n => n < 1 ? 'menos de 1 dia' : n === 1 ? '~1 dia' : `~${n} dias`
// nomes repetidos (variações, duplicação estratégica) ganham o título completo, cortado em ~70 caracteres por palavra inteira; se o corte ainda é o começo de outro título:
// começo e FIM quando o fim diferencia (cor, tamanho: «Kit 2 Conjuntos Fitness Modelador… Preto E Azul Tamanho P»), senão palavra a palavra até diferenciar (até 90:
// «… Cor Cinza» × «… Cor Laranja», quando o fim é igual)
const ate = (l, max) => { let r = ''; for (const p of l) { const j = r ? `${r} ${p}` : p; if (j.length > max) break; r = j } return r }   // palavras inteiras
const corte70 = (t, todos) => {
  const w = t.split(' '), outros = todos.filter(x => x !== t), unico = r => !outros.some(x => x === r || x.startsWith(r + ' '))
  let r = ate(w, 70) || t.slice(0, 70)
  if (r === t) return t
  if (unico(r)) return aparar(r.split(' '))
  const ini = ate(w, 40), fim = ate([...w].reverse(), 28).split(' ').reverse().join(' '), f = ini && fim ? `${ini}… ${fim}` : ''
  if (f && !outros.some(x => x.startsWith(ini + ' ') && x.endsWith(' ' + fim))) return f              // nenhum outro título tem o mesmo começo E o mesmo fim
  for (const p of w.slice(r.split(' ').length)) { r = `${r} ${p}`; if (r.length > 90) break; if (unico(r)) return r === t ? t : aparar(r.split(' ')) }
  return f || ate(w, 70) || t.slice(0, 70)
}
// universo: contra quem o nome curto é comparado (padrão: a própria lista; o relatório focado usa a conta inteira — «Kit 2 Rolos Fio Crô Premium» tem 28 cores)
export const nomesDe = (lista, universo = lista) => {
  const base = universo.map(i => nome(i.titulo, { unidade: false })), cheio = universo.map(i => limpo(i.titulo))
  return lista.map(i => base.filter(x => x === nome(i.titulo, { unidade: false })).length > 1 ? corte70(limpo(i.titulo), cheio) : nome(i.titulo))
}
const qtdTxt = s => s ? (s.conservador === s.base ? `${s.base}` : `${s.conservador} a ${s.base}`) : null
const ehFull = i => i.logistica === 'fulfillment'

// entrega da equipe que entra em «O que já fizemos e está dando resultado» (FATO, sem afirmar causa): anúncio criado pela equipe; ou que não vendia antes
// (28 dias antes sem venda com ≥ 14 dias coletados); ou que triplicou 28 d antes × 28 d depois com ≥ 5 un depois; sempre ≥ R$ 300 vendidos desde a entrega.
// Tarefa de kit só conta pelo anúncio do kit criado (nunca pelos anúncios que ela cita). «Não vendia» exige venda depois (pos > 0: o Merovíngio fecha 'lancamento'
// mesmo sem venda); «triplicou» só com os 28 dias seguintes inteiros (diasDesde ≥ 29: o texto afirma «nos 28 dias seguintes»). → { semVendaAntes, aumento } | null
// cobertura = dias coletados em que o ANÚNCIO já existia (desde max(criação, data − 28)); «triplicou» compara 28 × 28 dias, então exige o anúncio existindo nos 28 dias
// antes inteiros (preInteiro; 14/10: um anúncio de 14 dias «vendeu 1 nos 28 dias antes» inflava a alta). kit = tarefa de CRIAÇÃO (cadastro, duplicação, kit): só o anúncio criado.
export function avaliarEntrega({ criado, pre, pos, cobertura, receitaDesde, kit, diasDesde = Infinity, preInteiro = true }) {
  const semVendaAntes = !criado && pre === 0 && pos > 0 && cobertura >= 14
  const aumento = !criado && !semVendaAntes && preInteiro && cobertura >= 14 && diasDesde >= 29 && pos >= 5 && pos >= 3 * Math.max(pre, 1)
  if (!(receitaDesde >= 300) || !(criado || semVendaAntes || aumento)) return null
  if (kit && !criado) return null
  return { semVendaAntes, aumento }
}
// verbo pela FAMÍLIA da tarefa (familiaCliente: tipo, ou título quando o tipo é vazio/genérico), nunca por palavra solta no título («Criar anúncio… já otimizado» não é «Otimizamos»)
const verbo = e => e.criado ? 'Criamos' : e.familia === 'otimizar' ? 'Otimizamos' : e.familia === 'corrigir' ? 'Corrigimos' : 'Trabalhamos'
// construtores de linha COMPARTILHADOS pelo plano semanal e pelo relatório focado (o mesmo produto sai com o mesmo texto nos dois)
const linhaEntrega = (e, nm) => `• *${verbo(e)}* o anúncio ${nm(e)} em ${dm(e.dia)}${e.semVendaAntes ? ' (ele não vinha vendendo)' : ''}${e.aumento ? `: nos 28 dias antes vendeu ${e.pre}; nos 28 dias seguintes, ${e.pos}. Desde então já são` : ': desde então,'} *${e.unidades} ${e.unidades === 1 ? 'unidade vendida' : 'unidades vendidas'} (${brl(e.receita)})*.${e.permalink ? `\n  ${e.permalink}` : ''}`
// F3: Full acabando com estoque PRÓPRIO do mesmo produto → «e N un no seu estoque → sugerimos enviar *X un* ao Full (não precisa comprar)» (desenho § 8.6)
const linhaRuptura = (i, nm, { todosFull = false, avisado = false, sug = i.sug } = {}) => { const env = ehFull(i) ? envioDoProprio(i, sug) : null, q = qtdTxt(env || sug); return `• ${nm(i)}${sufixoAnuncios(i)}${!todosFull && ehFull(i) ? ' (Full)' : ''}: tem ${estoqueDe(i).estoque} un (${diasTxt(i.cobertura)})${env ? ` e ${env.proprio} un no seu estoque` : ''}${q ? ` → sugerimos ${ehFull(i) ? 'enviar' : 'repor'} *${q} un*${env ? ' ao Full (não precisa comprar)' : ''}` : ''}${avisado ? ' _(lembrete: já avisamos nos últimos dias)_' : ''}${i.permalink ? `\n  ${i.permalink}` : ''}` }
// 📦 = o MESMO predicado da regra estoque_ruptura do Algoritmo (lead-time.js → emRuptura: corte crítico ou prazo informado, sempre abaixo do prazo) e vendas ≥ min_unidades_item
export function rupturaDe(itens, L, { livre = () => true, ok = () => true } = {}) {
  const ab = itens.filter(i => i && i.curva !== 'C' && i.status === 'active' && i.ponto_reposicao != null && (estoqueDe(i).vel || 0) > 0 && representaEstoque(i) && livre('estoque_ruptura', i.id) && ok(i))
  return { ab, urg: ab.filter(i => emRuptura(i, L) && (estoqueDe(i).u || 0) >= (L.min_unidades_item || 0)).sort((a, b) => a.cobertura - b.cobertura) }
}
// anúncio que vendia e está fora do ar: a MESMA condição do gatilho anuncio_restrito (pausado/revisão/inativo com venda no período anterior ≥ min_impacto_pct_gmv do
// GMV anterior; 'closed' é decisão do cliente; alinhamento tira) — o 🎯, o 📉 e o relatório focado nunca contam números diferentes
// campo: 'r0' (período anterior, o do gatilho) | 'r' (últimos 28 dias: o relatório focado só fala da ruptura RECENTE — anúncio sem venda há 28 dias não é «já fora do ar»)
const FORA = { paused: 'pausado', under_review: 'em revisão no Mercado Livre', inactive: 'inativo' }
export function foraDoAr(itens, L = {}, { livre = () => true, ok = () => true, campo = 'r0' } = {}) {
  const gmv0 = itens.reduce((t, i) => t + (i[campo] || 0), 0)
  return itens.filter(i => FORA[i.status] && (i[campo] || 0) > 0 && i[campo] >= gmv0 * (L.min_impacto_pct_gmv || 0) / 100 && representaEstoque(i) && livre('anuncio_restrito', i.id) && ok(i)).sort((a, b) => b[campo] - a[campo])
}

// bloco de gatilhos (linhas do catálogo já auditadas): cabeçalho + fato(s); lembrete = já avisado no urgente dos últimos dias e a condição continua
function blocoDe(tipo, textos, { lembrete = false } = {}) {
  const [emoji, titulo] = BLOCOS[tipo] || ['•', tipo]
  return `${emoji} *${lembrete ? `Lembrete: ${titulo.charAt(0).toLowerCase()}${titulo.slice(1)}` : titulo}*\n` + textos.map(t => /^•/.test(t) || textos.length === 1 ? t : `• ${t}`).join('\n')
}

// dados: { rotulo, hoje 'AAAA-MM-DD', resumo { gmv, pedidos, variacao_pct (null = janela com lacuna: não se afirma variação) }, itens (diagnóstico, com sug { conservador, base }),
//   fullParado [{ item_id, inventory_id, disponivel, dias, idade_dias, titulo }], entregas [{ titulo, permalink, dia, criado, semVendaAntes, aumento, pre, pos, unidades, receita, acao }],
//   custosInformados, limiares { cobertura_critica_dias, lead_time_reposicao_dias, min_unidades_item }, extras [{ id?, tipo, texto, lembrete? }] (linhas de gatilho do cliente),
//   jaAvisados [ids de anúncio do urgente dos últimos dias], livre(regra, id) → false quando o alinhamento com o cliente cobre (predicado único),
//   tituloOk(titulo) → false quando o auditor reprova o título do produto (só a linha daquele produto sai; o resto do plano segue), maxLinhas (linhas por bloco de gatilho), previa }
// → { texto, n_acoes, blocos, usados } (blocos = chaves das ações que ENTRARAM no texto: ruptura | ciclo | parado | custos | <tipo do gatilho>; usados = ids dos extras que entraram)
// perfil? { ordem [temas], temas [pedidos], nivel 'padrao'|'didatico'|'completo' } · info? (gatilhos-real.dadosPlanoSemana → relatorio): { compras { disponivel, ciclo_dias, seguranca_dias,
//   itens [preverCompras] }, tarefas [{ id, familia, n }] | null, causa { funil { visitas_pct, conv_antes, conv_depois, ticket_pct } | null, medidas [{ familia, data, estado, efeito_pct,
//   metrica, confianca, preco_junto, reversao, item_id, unidades, dias }], outras { sem_alta, em_medicao } }, acoes [{ regra, item_id, status }], ads { custo, receita, roas, anterior } | null,
//   promocoes { lida_em, parcial, no_ar [{ item_id, nome, fim, titulo }], elegiveis } | null, concorrentes [{ item_id, url, preco, observado_em }] } · itens ganham r0/u0/v/v0/catalogo/ptw/preco
// → com perfil, também secoes [{ chave, tema, pedido, conteudo }] (o que entrou e de onde veio); sem bloco com conteúdo = texto ''
export function montarPlanoSemanal({ rotulo, hoje, resumo = {}, itens = [], fullParado = [], entregas = [], custosInformados = true, limiares: L, extras = [], jaAvisados = [], livre = () => true, tituloOk = () => true, maxLinhas = 3, previa = false, perfil = null, info = {}, cfgRel = null }) {
  const avisado = new Set(jaAvisados.map(String)), ok = x => tituloOk(limpo(x.titulo))
  const { ab, urg } = rupturaDe(itens, L, { livre, ok })
  const prox = ab.filter(i => !urg.includes(i) && estoqueDe(i).estoque != null && estoqueDe(i).estoque <= i.ponto_reposicao).sort((a, b) => semana(b) - semana(a)).slice(0, 3)
  const vendeu28 = new Set(itens.filter(i => (i.u || 0) > 0).map(i => String(i.id)))       // contradição: vendeu nos últimos 28 dias não é «parado»
  const parado = fullParado.filter(x => !vendeu28.has(String(x.item_id)) && livre('full_estoque_antigo', x.item_id) && ok(x))
  const ent = entregas.filter(ok).slice(0, 3)
  // nomes repetidos em QUALQUER bloco da mensagem ganham o título completo (o mesmo nome curto como campeão no 📦 e como parado no 💡 confundia o cliente)
  const vis = [...urg.slice(0, 5), ...prox, ...parado.slice(0, 4), ...ent], nomeDe = new Map(nomesDe(vis).map((n, k) => [vis[k], n])), nm = x => nomeDe.get(x) ?? nome(x.titulo)
  const blocos = new Map(), idsDe = new Map()
  // quantidade da reposição FORA do Full = o pedido ao fornecedor de preverCompras (a mesma do relatório focado e do aviso de estoque, com a premissa dela no bloco);
  // no Full, o envio (sugestaoFull). Sem a previsão de compras lida (prévia/teste sem info), fica a de antes. Achado de 14/10: eram dois números para o mesmo produto.
  const compra = mapaCompras(info.compras?.itens), comCompras = !!info.compras?.disponivel
  const sugDe = i => ehFull(i) || !comCompras ? i.sug : compra.get(String(i.id))?.quanto_pedir || null
  const pedidosUrg = comCompras ? urg.slice(0, 5).filter(i => !ehFull(i) && sugDe(i)).map(i => compra.get(String(i.id))) : []
  const premUrg = pedidosUrg.length ? premissaCompras(pedidosUrg, info.compras, hoje) : null

  if (urg.length) {
    const tot = urg.reduce((s, i) => s + semana(i), 0), ult = urg[0], um = urg.length === 1, limite = mais(hoje, Math.max(Math.floor(ult.cobertura) - 1, 1))
    const nFull = urg.filter(ehFull).length, todosFull = nFull === urg.length, nenhumFull = nFull === 0
    const titulo = todosFull ? 'Abastecer o Full para os campeões de venda não pararem' : nenhumFull ? 'Repor o estoque dos campeões de venda para eles não pararem' : 'Repor o estoque e abastecer o Full dos campeões de venda'
    const onde = todosFull ? `o estoque ${um ? 'dele' : 'deles'} no Full` : `o estoque ${um ? 'dele' : 'deles'}`, chegada = todosFull ? 'a remessa' : 'a reposição'
    const maxDias = Math.max(...urg.map(i => i.cobertura))
    const dura = um || ult.cobertura === maxDias ? (ult.cobertura < 1 ? 'menos de 1 dia' : `${maxDias} dias`) : `${ult.cobertura < 1 ? 'menos de 1 dia' : `de ${ult.cobertura}`} a ${maxDias} dias`
    blocos.set('ruptura', `📦 *${titulo}*\n${um ? `Este produto está girando rápido: vende cerca de *${brl(tot)} por semana*` : `Estes produtos estão girando rápido: juntos vendem cerca de *${brl(tot)} por semana*`}. No ritmo atual, ${onde} dura ${dura}. Quando um campeão zera, o anúncio pausa e sai da busca até ${chegada} chegar, e as vendas desses dias não voltam. Com ${chegada} chegando *até ${dm(limite)}*, a vitrine segue cheia e o ritmo continua:\n` +
      urg.slice(0, 5).map(i => linhaRuptura(i, nm, { todosFull, avisado: avisado.has(String(i.id)), sug: sugDe(i) })).join('\n') + (premUrg ? `\n${premUrg.premissa}` : '') + (algumGrupo(urg.slice(0, 5)) ? `\n${PREMISSA_PRODUTO}` : ''))
  }
  if (prox.length) {
    // prazo = o MESMO do ponto de reposição (v1.6.0): o informado pelo cliente/equipe vence a premissa; lista com prazos ou fontes diferentes = o prazo de cada um na linha
    const leadDe = i => i.lead_time_dias ?? L.lead_time_reposicao_dias, inf = i => i.lead_time_fonte === 'cliente' || i.lead_time_fonte === 'equipe'
    const leads = [...new Set(prox.map(leadDe))], misto = leads.length > 1 || new Set(prox.map(inf)).size > 1, informado = prox.every(inf)
    const prazo = misto ? `Usamos o prazo de cada produto entre o pedido e a chegada (o que temos registrado; sem registro, a referência de ${L.lead_time_reposicao_dias} dias); se mudou, conta pra gente que ajustamos o cálculo:`
      : informado ? `Usamos o prazo de ${leads[0]} dias entre o pedido e a chegada que temos registrado; se mudou, conta pra gente que ajustamos o cálculo:` : `Consideramos ${leads[0]} dias entre o pedido e a chegada; se o seu fornecedor entrega mais rápido ou mais devagar, conta pra gente que ajustamos o cálculo:`
    blocos.set('ciclo', `🔄 *Já deixar o próximo pedido ao fornecedor encaminhado*\nPara o estoque não acabar antes de a reposição chegar, vale incluir ${prox.length === 1 ? 'este' : 'estes'} no próximo pedido. ${prazo}\n` +
      prox.map(i => `• ${nm(i)}${sufixoAnuncios(i)}: ${estoqueDe(i).estoque} un (${diasTxt(i.cobertura)}) · vende ~${brl(semana(i))}/semana${misto ? ` · prazo ${leadDe(i)} dias${inf(i) ? '' : ' (referência)'}` : ''}${i.permalink ? `\n  ${i.permalink}` : ''}`).join('\n') + (algumGrupo(prox) && !algumGrupo(urg.slice(0, 5)) ? `\n${PREMISSA_PRODUTO}` : ''))
  }
  if (parado.length) {
    const un = parado.reduce((s, x) => s + x.disponivel, 0)
    blocos.set('parado', `💡 *Transformar o estoque parado do Full em venda (ou em espaço)*\n${un} ${un === 1 ? 'unidade' : 'unidades'} em ${parado.length} ${parado.length === 1 ? 'anúncio' : 'anúncios'} ${un === 1 ? 'está' : 'estão'} sem vender há ${Math.min(...parado.map(x => x.dias))} dias ou mais${parado.some(x => x.idade_dias == null) ? ' (contando pela última venda)' : ''}. ${un === 1 ? 'Ela ocupa' : 'Elas ocupam'} espaço no Full e ${un === 1 ? 'pode' : 'podem'} virar caixa: dá para montar um kit com um produto que vende bem, fazer uma ação de giro ou retirar. Se quiser, a gente monta a proposta com você:\n` +
      parado.slice(0, 4).map(x => `• ${nm(x) || 'Produto no Full'}: ${x.disponivel} un, ${x.dias} dias sem venda`).join('\n'))
  }
  if (!custosInformados && livre('cadastrar_custos', '')) blocos.set('custos', `📊 *Compartilhar a planilha de custos para darmos o próximo passo*\nCom o custo de cada produto, a gente passa a calcular a sua margem real, define até quanto dá para descontar numa promoção sem perder dinheiro e qual retorno mínimo os anúncios pagos precisam trazer. É o que permite acelerar com segurança.`)
  // linhas de gatilho: até maxLinhas por bloco (+ «e mais N»); só as que entraram no texto são marcadas como enviadas (usados) — o resto espera a próxima segunda
  for (const tipo of ORDEM.filter(t => BLOCOS[t])) {
    const ex = extras.filter(e => e.tipo === tipo && e.texto); if (!ex.length) continue
    const vai = ex.slice(0, maxLinhas), resto = ex.length - vai.length
    blocos.set(tipo, blocoDe(tipo, [...vai.map(e => e.texto), ...(resto ? [`• e mais ${resto} ${resto === 1 ? 'ponto' : 'pontos'} do mesmo tipo`] : [])], { lembrete: vai.every(e => e.lembrete) }))
    idsDe.set(tipo, vai.map(e => e.id).filter(x => x != null))
  }
  const ordem = ORDEM.filter(k => blocos.has(k)).slice(0, MAX_ACOES)
  if (!perfil && !ordem.length) return { texto: '', n_acoes: 0, blocos: [], usados: [] }

  const varp = Number.isFinite(resumo.variacao_pct) ? Math.round(resumo.variacao_pct) : null
  const abertura = varp != null && varp >= 3 ? `Os últimos 28 dias foram bons: *${brl(resumo.gmv)}* em vendas e ${resumo.pedidos} pedidos, *${varp}% acima* do período anterior. Para manter e acelerar esse ritmo, separei o que vale priorizar agora:`
    : varp != null && varp <= -3 ? `Nos últimos 28 dias foram *${brl(resumo.gmv)}* em vendas e ${resumo.pedidos} pedidos, ${Math.abs(varp)}% abaixo do período anterior. Separei o que vale priorizar agora para proteger o faturamento e retomar o ritmo:`
    : varp != null ? `Nos últimos 28 dias foram *${brl(resumo.gmv)}* em vendas e ${resumo.pedidos} pedidos, um ritmo estável em relação ao período anterior. Para crescer a partir daqui, separei o que vale priorizar agora:`
    : `Nos últimos 28 dias foram *${brl(resumo.gmv)}* em vendas${Number.isFinite(resumo.pedidos) ? ` e ${resumo.pedidos} pedidos` : ''}. Separei o que vale priorizar agora:`   // dia sem coleta não é zero: sem as duas janelas inteiras, nada de «acima/abaixo»
  const blocoEntregas = ent.length ? `✅ *O que já fizemos e está dando resultado*\n` + ent.map(e => linhaEntrega(e, nm)).join('\n') : ''
  const cabeca = (previa ? `_PRÉVIA — exemplo com dados reais de ${rotulo}. Não foi enviado ao cliente._\n\n` : '') + `${ABERTURA}\n\n` +
    `*${varp != null && varp <= -3 ? 'Plano para proteger e retomar as vendas' : 'Plano para manter o ritmo de vendas'} · ${rotulo} · ${dm(hoje)}*\n\n${abertura}`
  const planoTxt = ordem.length ? '🎯 *O plano da semana*\n\n' + ordem.map((k, n) => `*${n + 1}.* ${blocos.get(k)}`).join('\n\n') : ''
  const rodape = `${FECHO}\n${ASSINATURA}\n${premUrg?.premissas && ordem.includes('ruptura') ? NOTA_COMPRAS : NOTA}`
  const usados = ordem.flatMap(k => idsDe.get(k) || [])
  if (!perfil) return { texto: `${cabeca}\n\n${blocoEntregas ? blocoEntregas + '\n\n' : ''}${planoTxt}\n\n${rodape}`, n_acoes: ordem.length, blocos: ordem, usados }

  // ── relatório PERSONALIZADO (Etapa 3, 13/10/2026): a ordem do perfil (base fixa + pedidos no topo) decide quais blocos entram e em que posição ──
  const R = cfgRel || lerCfgRelatorio(), pedidos = new Set(perfil.temas || []), didatico = perfil.nivel === 'didatico'
  const max = perfil.nivel === 'completo' || didatico ? R.max_linhas_completo : R.max_linhas
  const urgIds = new Set(urg.map(i => String(i.id)))
  const ctx = { R, L, itens, resumo, hoje, info, ok, max, urgIds, parado, livre, pedido: k => pedidos.has(k), planoTxt, blocoEntregas, noPlano: k => ordem.includes(k) }
  const chaves = [], visto = new Set()
  for (const t of perfil.ordem || []) for (const k of (pedidos.has(t) ? R.pedido[t] : R.base[t]) || []) if (!visto.has(k)) { visto.add(k); chaves.push({ chave: k, tema: t, pedido: pedidos.has(t) }) }
  // conferir = aviso INTERNO (prévia/lote), nunca vai ao texto do cliente; um bloco pode ter só isso (texto '')
  let secoes = chaves.map(s => ({ ...s, ...(SECOES[s.chave]?.(ctx, s) || {}) })).filter(s => s.texto || s.conferir?.length)
  if (!secoes.some(s => s.conteudo)) return { texto: '', n_acoes: 0, blocos: [], usados: [], secoes: [] }
  const comPlano = secoes.some(s => s.chave === 'plano' && s.conteudo)          // linha de gatilho só conta como enviada se o 🎯 entrou no texto
  // ponto URGENTE no 🎯 (ruptura, despacho vencido, reclamação, reputação): o plano vem logo depois do cabeçalho, antes dos pedidos — nunca na 2ª mensagem do WhatsApp
  if (comPlano && ordem.some(k => URGENTES_TOPO.includes(k))) secoes = [...secoes.filter(s => s.chave === 'plano'), ...secoes.filter(s => s.chave !== 'plano')]
  // bloco PEDIDO sem dado novo: nada de um cabeçalho por bloco com «nenhum…» repetido — uma seção só, no fim, uma linha por frase (blocos com a mesma frase juntos)
  const vazios = secoes.filter(s => s.texto && s.pedido && !s.conteudo && s.falta), cheios = secoes.filter(s => s.texto && !vazios.includes(s))
  const porFrase = new Map(); for (const s of vazios) porFrase.set(s.falta, [...(porFrase.get(s.falta) || []), rotuloDe(R, s.chave)])
  const blocoVazios = vazios.length ? `${R.sem_dado_titulo}\n` + [...porFrase].map(([f, ns]) => `• ${juntarE(ns)}: ${f}`).join('\n') : ''
  const sig = s => didatico && R.blocos[s.chave]?.significa ? `\n${R.significa_prefixo} ${R.blocos[s.chave].significa}` : ''
  const glossario = didatico ? `\n\n${R.glossario_titulo}\n` + R.glossario.map(([t, d]) => `• *${t}*: ${d}`).join('\n') : ''
  const nota = secoes.some(s => s.chave === 'compras' && s.conteudo && s.premissas) || (comPlano && premUrg?.premissas && ordem.includes('ruptura')) ? NOTA_COMPRAS : NOTA    // a compra soma tendência/data comercial: a nota não diz só «28 dias»
  const texto = `${cabeca}\n\n` + [...cheios.map(s => s.texto + sig(s)), blocoVazios].filter(Boolean).join('\n\n') + `\n\n${FECHO}\n${ASSINATURA}\n${nota}${glossario}`
  return { texto, n_acoes: comPlano ? ordem.length : 0, blocos: comPlano ? ordem : [], usados: comPlano ? usados : [],
    secoes: secoes.map(s => ({ chave: s.chave, tema: s.tema, pedido: s.pedido, conteudo: !!s.conteudo, ...(vazios.includes(s) ? { junto: true } : {}), ...(s.conferir?.length ? { conferir: s.conferir } : {}) })) }
}

// ── blocos do relatório personalizado (Etapa 3). Cada um: (ctx, { pedido }) → { texto, conteudo, falta?, conferir? } | null. conteudo = traz dado novo para o cliente (o
// relatório só sai com pelo menos um bloco com conteúdo); bloco sem dado nunca vira número: frase honesta (conteudo:false; `falta` = a mesma frase curta, que o bloco PEDIDO
// usa na seção única do fim) ou nada. conferir = aviso só interno. Nomes de produto passam pelo tituloOk (auditor do título).
const URGENTES_TOPO = ['ruptura', 'envio_atrasado', 'reclamacao_mediacao', 'reputacao_em_risco']
const APROVADAS = ['aprovada', 'distribuida']
const SEM_APROVADA = 'nenhuma ação aprovada no plano ainda; seu consultor traz na próxima conversa.'
const brl2 = n => 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const sinal = n => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}%`
const pct1 = n => String(Math.round(n * 10) / 10).replace('.', ',')
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`
const cap = t => t.charAt(0).toUpperCase() + t.slice(1)
const juntarE = l => l.length > 1 ? `${l.slice(0, -1).join(', ')} e ${l.at(-1)}` : l[0] || ''
const diasAte = (de, ate) => Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000)
const tituloDe = (R, k) => R.blocos[k]?.titulo || k
const rotuloDe = (R, k) => tituloDe(R, k).replace(/^\S+\s+/, '').replace(/\*/g, '').trim()
const regraBase = r => String(r || '').replace(/^anuncio_/, '')
const porIdDe = itens => new Map(itens.map(i => [String(i.id), i]))
// nomes de uma LISTA de produtos de um bloco: nome curto, título completo quando o curto se repete (variações) — o mesmo critério do 📦 (nomesDe)
const nomesNoBloco = l => { const ns = nomesDe(l).map(n => n.trim()); return x => ns[l.indexOf(x)] ?? nome(x.titulo) }
// uma linha por NOME exibido: variações que continuam com o mesmo nome (título idêntico até onde ele é cortado) não viram linhas repetidas — fica a 1ª (a lista já vem
// ordenada pela relevância); quem chama conta as demais no «e mais N». → { nm, lista }
const unicosPorNome = (l, de = x => x) => { const nm = nomesNoBloco(l.map(de)), vistos = new Set(); return { nm, lista: l.filter(x => { const k = nm(de(x)).toLowerCase(); return !vistos.has(k) && vistos.add(k) }) } }
// até 2 nomes e «e mais N anúncios»; títulos idênticos (variações sem diferença no título) viram um nome só, com a contagem. nm = nomes resolvidos no bloco inteiro
const nomesCurtos = (l, nm = nomesNoBloco(l)) => {
  const g = new Map(); for (const x of l) g.set(nm(x), (g.get(nm(x)) || 0) + 1)
  const gs = [...g], txt = ([n, k]) => k > 1 ? `${n} (${k} anúncios)` : n, resto = gs.slice(2).reduce((t, [, k]) => t + k, 0)
  return gs.length <= 2 ? gs.map(txt).join(' e ') : `${gs.slice(0, 2).map(txt).join(', ')} e mais ${plural(resto, 'anúncio', 'anúncios')}`
}
// ações do plano que têm frase ao cliente, agrupadas pela frase: «• frase: Produto A e Produto B». Quem chama filtra o status (proposta nunca é «em andamento»).
// Os nomes são resolvidos no bloco INTEIRO: dois anúncios diferentes com o mesmo título cortado em linhas diferentes confundiam o cliente.
function linhasDeAcoes(acoes, frases, { itens, ok, max }) {
  const porId = porIdDe(itens), grupos = new Map()
  for (const a of acoes) {
    const f = frases[regraBase(a.regra)]; if (!f) continue
    const it = a.item_id ? porId.get(String(a.item_id)) : null
    if (a.item_id && (!it || !ok(it))) continue                       // anúncio fora do diagnóstico ou título barrado: a linha não entra
    const g = grupos.get(f) || grupos.set(f, []).get(f); if (it && !g.includes(it)) g.push(it)
  }
  const nm = nomesNoBloco([...new Set([...grupos.values()].flat())])
  return [...grupos].slice(0, max).map(([f, its]) => `• ${f}${its.length ? `: ${nomesCurtos(its, nm)}` : ''}`)
}
const vazio = (T, frase) => ({ texto: `${T}\n${cap(frase)}`, conteudo: false, falta: frase })
const ASSOCIACAO = 'É associação no tempo, não prova de causa.'
const linhaTarefa = x => `• ${x.familia}: ${plural(x.n, 'tarefa concluída', 'tarefas concluídas')}`
// medições do Merovíngio → linhas ao cliente (🔍 e ✅ do relatório focado): só medição com o anúncio identificado (tarefa sem anúncio vinculado não diz ao cliente de
// qual produto se trata) e título aprovado; linha repetida sai uma vez. Quem chama corta no teto.
const rotConfianca = sc => sc == null ? 'confiança não calculada' : sc >= 80 ? 'confiança alta' : sc >= 60 ? 'confiança média' : 'confiança baixa'
// Medição de um GRUPO de anúncios (n_itens > 1) diz «e mais N anúncios»: o efeito é do grupo, nunca só do 1º nome. nm = nomes resolvidos fora (relatório focado).
function linhasMedidas(medidas, { itens, ok, nm: nmFora }) {
  const porId = porIdDe(itens), med = medidas.map(m => ({ m, it: porId.get(String(m.item_id)) })).filter(x => x.it && ok(x.it)), nm = nmFora || nomesNoBloco(med.map(x => x.it))
  const quem = (m, it) => `${nm(it)}${m.n_itens > 1 ? ` e mais ${plural(m.n_itens - 1, 'anúncio', 'anúncios')}` : ''}`
  return [...new Set(med.map(({ m, it }) => m.estado === 'lancamento'
    ? `• ${m.familia} em ${dm(m.data)} · ${quem(m, it)}: passou a vender (${m.unidades} un em ${m.dias} dias); observação direta, sem comparação`
    : `• ${m.familia} em ${dm(m.data)} · ${quem(m, it)}: ${m.metrica} ${sinal(Math.round(m.efeito_pct))} (${rotConfianca(m.confianca)})${m.preco_junto ? '; o preço mudou junto' : ''}${m.reversao ? '; pode ser volta ao nível normal' : ''}`))]
}
// próximos pedidos (🛒 e 📦 do relatório focado) → { vazio, indisponivel? } | { linhas, premissa, premissas, resto }
// Só o relatório focado passa: nm (nomes resolvidos na mensagem inteira), link(x) (título idêntico a outro anúncio: a linha leva o link) e junto (pedidos dos campeões
// não-Full do «perto de acabar», cuja quantidade sai daqui: entram nas premissas, não nas linhas).
function comprasDe({ R, info, urgIds, ok, hoje, max, nm: nmFora, link = () => false, junto = [] }) {
  const c = info.compras
  if (!c?.disponivel) return { vazio: 'ainda sem a previsão de compras desta conta (falta a leitura de vendas e estoque).', indisponivel: true }
  // só o que pede compra já no cenário conservador (ritmo dos 28 dias): «pedir» com conservador 0 seria pedir pela alta recente ou pela data comercial
  const todos = (c.itens || []).filter(x => x.quando_pedir && x.quanto_pedir?.conservador > 0 && x.quanto_pedir.base >= (R.compras_min_un ?? 3) && x.quando_pedir.dias <= c.ciclo_dias && !urgIds.has(String(x.id)) && ok(x)), l = todos.slice(0, max)
  if (!l.length && !junto.length) return { vazio: `pelo ritmo atual, nenhum ${urgIds.size ? 'outro ' : ''}produto chega ao ponto de pedido nos próximos ${c.ciclo_dias} dias.` }
  const nm = nmFora || nomesNoBloco(l), q = ({ quanto_pedir: { conservador: lo, base: hi } }) => lo === hi ? hi : `${lo} a ${hi}`
  const nA = x => (x.produto?.n_anuncios > 1 ? ` (${x.produto.n_anuncios} anúncios)` : '')     // F3: 1 linha por produto; o estoque é o total dos anúncios dele
  const pc = premissaCompras([...l, ...junto], c, hoje), grupo = [...l, ...junto].some(x => x.produto?.n_anuncios > 1)
  return { linhas: l.map(x => `• ${nm(x)}${nA(x)}: pedir ${x.quando_pedir.agora ? '*agora*' : `*até ${dm(x.quando_pedir.data)}*`} · *${q(x)} un* (tem ${x.estoque} un${x.produto?.n_anuncios > 1 ? ' no total' : ''}${x.ruptura ? '; ficou sem estoque, usamos o ritmo de antes da falta' : ''})${link(x) && x.permalink ? `\n  ${x.permalink}` : ''}`),
    ...pc, premissa: grupo ? `${pc.premissa} ${PREMISSA_PRODUTO}` : pc.premissa, resto: todos.length - l.length }
}
// premissa da QUANTIDADE do pedido ao fornecedor (preverCompras.quanto_pedir): a MESMA frase no relatório focado, no 📦 do plano semanal e no aviso de estoque (gatilhos.js;
// achado de 14/10: o aviso usava a conta de envio ao Full e saía com outro número para o mesmo produto). pl = itens de preverCompras que estão na mensagem;
// c = { ciclo_dias, seguranca_dias, data_comercial } → { premissa, premissas } (premissas = o maior número inclui alta recente, data comercial ou o ritmo de antes da falta)
export function premissaCompras(pl, c, hoje) {
  const leads = [...new Set(pl.map(x => x.lead_time.dias))].sort((a, b) => a - b), lead = leads.length > 1 ? `${leads[0]} a ${leads.at(-1)}` : leads[0]
  const informado = pl.every(x => x.lead_time.fonte !== 'premissa')
  // premissas do MAIOR número (cenário base), declaradas só para quem tem faixa (conservador < base): alta recente, data comercial no pedido, ritmo de antes da falta
  const DC = c.data_comercial, fx = pl.filter(x => x.quanto_pedir.conservador < x.quanto_pedir.base), evs = [...new Set(fx.flatMap(x => (x.datas_comerciais || []).filter(e => diasAte(hoje, e.data) <= (x.quanto_pedir.cobre_dias ?? Infinity)).map(e => e.evento)))]   // só as datas que entram no pedido
  const maior = [fx.some(x => x.tendencia?.fator > 1) ? 'a alta recente das vendas' : '', evs.length && DC ? `${Math.round((DC.fator - 1) * 100)}% a mais de venda por ${DC.dias_efeito} dias em ${juntarE(evs)} (premissa da casa)` : '',
    fx.some(x => x.ruptura) ? 'o ritmo de antes da falta, para quem ficou sem estoque' : ''].filter(Boolean)
  return { premissa: `Prazo usado: ${lead} dias entre o pedido e a chegada ${informado ? '(o que temos registrado)' : '(premissa: se o seu fornecedor entrega em outro prazo, conta pra gente que ajustamos)'} + ${c.seguranca_dias} dias de folga. A quantidade cobre esse prazo e o próximo ciclo de compra de ${c.ciclo_dias} dias pelo ritmo dos últimos 28 dias${maior.length ? `; o maior número inclui ${juntarE(maior)}` : ''}. Se houver pedido a caminho ou estoque fora do Mercado Livre, desconte.`,
    premissas: maior.length > 0 }
}
const SECOES = {
  plano: ({ R, planoTxt, pedido }) => planoTxt ? { texto: planoTxt, conteudo: true }
    : pedido('estoque_reposicao') ? vazio(tituloDe(R, 'plano'), 'nada urgente de estoque ou da conta nesta semana; seguimos acompanhando.') : null,
  entregas: ({ R, blocoEntregas }, s) => blocoEntregas ? { texto: blocoEntregas, conteudo: true }
    : s.pedido ? vazio(tituloDe(R, 'entregas'), 'ainda não há entrega com venda medida nas últimas semanas; seguimos acompanhando.') : null,
  estatisticas({ R, itens, resumo, ok, max }) {
    const T = tituloDe(R, 'estatisticas'), vend = itens.filter(i => (i.r || 0) > 0).sort((a, b) => b.r - a.r)
    if (!vend.length) return vazio(T, 'sem vendas registradas nos últimos 28 dias.')
    const comp = Number.isFinite(resumo.variacao_pct), tot = vend.reduce((t, i) => t + i.r, 0)
    const u = unicosPorNome(vend.filter(ok)), l = u.lista.slice(0, max), nm = u.nm
    const top = l.map(i => `• ${nm(i)}: ${brl(i.r)} (${i.u} un)${!comp ? '' : i.r0 > 0 ? ` · ${sinal(Math.round((i.r / i.r0 - 1) * 100))} sobre os 28 dias anteriores` : ' · começou a vender no período'}`)
    const abc = ['A', 'B', 'C'].map(c => { const l = vend.filter(i => i.curva === c); return { c, n: l.length, p: Math.round(100 * l.reduce((t, i) => t + i.r, 0) / tot) } }).filter(x => x.n)
    // ticket = receita ÷ PEDIDOS (diagnóstico); o 🔍 usa o valor médio por UNIDADE — rótulos diferentes para contas diferentes
    const cab = [Number.isFinite(resumo.unidades) ? `${resumo.unidades} unidades vendidas` : '', resumo.ticket > 0 ? `ticket médio por pedido ${brl2(resumo.ticket)}` : ''].filter(Boolean).join(' · ')
    return { texto: `${T}\n${cab ? cab + '. ' : ''}Os mais vendidos nos últimos 28 dias:\n${top.join('\n')}\nCurva ABC: ${abc.map(x => `${plural(x.n, 'anúncio', 'anúncios')} na curva ${x.c} (${x.p}% do faturamento)`).join(', ')}.`, conteudo: true }
  },
  compras({ R, info, urgIds, ok, hoje }) {
    const T = tituloDe(R, 'compras'), x = comprasDe({ R, info, urgIds, ok, hoje, max: R.compras_max })
    return x.vazio ? vazio(T, x.vazio) : { texto: `${T}\nPelo ritmo de vendas, os próximos pedidos ao fornecedor:\n${x.linhas.join('\n')}\n${x.premissa}`, conteudo: true, premissas: x.premissas }
  },
  acoes_semana({ R, info, max }) {
    const T = tituloDe(R, 'acoes_semana'), t = info.tarefas
    if (!Array.isArray(t)) return vazio(T, 'sem a leitura das tarefas desta semana (não quer dizer que nada foi feito).')
    // zero CONFIRMADO (Notion lido na janela): nenhuma frase ao cliente — só o aviso interno na prévia
    if (!t.length) return { texto: '', conteudo: false, conferir: [`nenhuma tarefa do Mercado Livre concluída nos últimos ${R.acoes_semana_dias} dias (Notion lido): conferir com a equipe`] }
    return { texto: `${T}\n` + t.slice(0, max).map(linhaTarefa).join('\n'), conteudo: true }
  },
  causa({ R, info, itens, ok, max }) {
    const T = tituloDe(R, 'causa'), c = info.causa || {}, linhas = []
    const f = c.funil
    const lm = linhasMedidas(c.medidas || [], { itens, ok }).slice(0, max)
    if (!f && !lm.length) return vazio(T, 'sem a comparação completa dos 28 dias nesta semana (dia sem coleta não é venda zero).')
    // valor médio por UNIDADE (faturamento ÷ unidades): é o que fecha vendas = visitas × conversão (unidades ÷ visitas) × valor por unidade; o ticket do 📈 é por pedido
    if (f) linhas.push('Comparando os últimos 28 dias com os 28 anteriores: ' + [f.visitas_pct != null ? `visitas ${sinal(Math.round(f.visitas_pct))}` : '', f.conv_antes != null && f.conv_depois != null ? `conversão de ${pct1(f.conv_antes)}% para ${pct1(f.conv_depois)}%` : '', f.ticket_pct != null ? `valor médio por unidade ${sinal(Math.round(f.ticket_pct))}` : ''].filter(Boolean).join(', ') + '.')
    else linhas.push('As duas janelas de 28 dias não estão completas (dia sem coleta não é venda zero): sem a comparação do funil nesta semana.')
    if (lm.length) linhas.push(`Ações medidas nos últimos ${R.causa_janela_dias} dias, comparando o anúncio com os que não mexemos no mesmo período:`, ...lm)
    const o = c.outras || {}, outra = lm.length ? 'outra ' : '', outras = lm.length ? 'outras ' : ''      // «outras» só quando há ação listada antes
    if (o.sem_alta || o.em_medicao) linhas.push(cap([o.sem_alta ? `${plural(o.sem_alta, `${outra}ação ainda não mostrou`, `${outras}ações ainda não mostraram`)} alta medida` : '', o.em_medicao ? `${plural(o.em_medicao, 'ação segue', 'ações seguem')} em medição` : ''].filter(Boolean).join(' e ')) + '.')
    linhas.push(ASSOCIACAO)
    return { texto: `${T}\n${linhas.join('\n')}`, conteudo: true }
  },
  atencao({ R, L = {}, info, itens, resumo, ok, max, livre, noPlano = () => false }) {
    const T = tituloDe(R, 'atencao'), porId = porIdDe(itens), comp = Number.isFinite(resumo.variacao_pct), vistos = new Set(), achados = []
    const add = (i, txt) => { if (!i || vistos.has(String(i.id)) || !ok(i)) return; vistos.add(String(i.id)); achados.push([i, txt]) }
    // anúncio que vendia e está fora do ar (foraDoAr: a MESMA condição do gatilho anuncio_restrito). Mais de 2 = UMA linha com a contagem
    const fora = foraDoAr(itens, L, { livre, ok })
    let linhaFora = ''
    // ponytail (13/10): o 🎯 já lista os mesmos anúncios com link → aqui só a contagem (LS Importados saía com os 5 nomes duas vezes)
    if (fora.length && noPlano('anuncio_restrito')) { for (const i of fora) vistos.add(String(i.id)); const se = fora.filter(i => i.estoque === 0).length
      linhaFora = `• ${plural(fora.length, 'anúncio que vendia está fora do ar', 'anúncios que vendiam estão fora do ar')}${se ? ` (${se === fora.length ? (fora.length === 1 ? 'sem estoque' : 'todos sem estoque') : `${se} sem estoque`})` : ''}: ${fora.length === 1 ? 'está' : 'estão'} no plano da semana, com o link` }
    else if (fora.length > 2) { for (const i of fora) vistos.add(String(i.id)); const se = fora.filter(i => i.estoque === 0).length
      linhaFora = `• ${plural(fora.length, 'anúncio que vendia está fora do ar', 'anúncios que vendiam estão fora do ar')}${se ? ` (${se === fora.length ? 'todos' : se} sem estoque)` : ''}: ${nomesCurtos(fora)}` }
    else for (const i of fora) add(i, `fora do ar (${FORA[i.status]}${i.estoque === 0 ? ', sem estoque' : ''}); estava vendendo`)
    // queda das regras do plano SÓ se continua nos números de hoje (a ação dura o mês); «mais que o resto da conta» só com a comparação recalculada agora
    const cob = itens.filter(i => i.v != null && i.v0 != null), sv = k => cob.reduce((t, i) => t + (i[k] || 0), 0)
    const rV = sv('v0') > 0 ? sv('v') / sv('v0') : null, rC = sv('v0') > 0 && sv('v') > 0 && sv('u0') > 0 ? (sv('u') / sv('v')) / (sv('u0') / sv('v0')) : null
    const maisQue = (r, conta) => conta != null && r < conta ? ' (mais que o resto da conta)' : ''
    for (const a of info.acoes || []) {
      const i = porId.get(String(a.item_id)), r = regraBase(a.regra); if (!i) continue
      if (r === 'queda_conversao_anuncio' && i.v > 0 && i.v0 > 0 && i.u0 > 0) { const c0 = i.u0 / i.v0, c1 = i.u / i.v; if (c1 < c0) add(i, `a conversão caiu de ${pct1(100 * c0)}% para ${pct1(100 * c1)}%${maisQue(c1 / c0, rC)}`) }
      if (r === 'queda_exposicao_anuncio' && i.v0 > 0 && i.v != null && i.v < i.v0) add(i, `as visitas caíram ${Math.round((1 - i.v / i.v0) * 100)}%${maisQue(i.v / i.v0, rV)}`)
    }
    if (comp) for (const i of itens.filter(i => i.curva === 'A' && i.r0 > 0 && (i.r / i.r0 - 1) * 100 <= -R.curva_a_queda_pct).sort((a, b) => (b.r0 - b.r) - (a.r0 - a.r))) add(i, `campeão de vendas com faturamento ${Math.abs(Math.round((i.r / i.r0 - 1) * 100))}% abaixo dos 28 dias anteriores`)
    for (const i of itens.filter(i => i.status === 'active' && !(i.u > 0) && i.v >= R.visitas_sem_venda_min).sort((a, b) => b.v - a.v)) add(i, `${i.v} visitas e nenhuma venda em 28 dias`)
    // «nenhum» só com a comparação feita: janelas inteiras E visitas lidas; senão, ausente ≠ zero
    if (!achados.length && !linhaFora) return vazio(T, comp && cob.length ? 'nenhum anúncio com queda fora do normal nos últimos 28 dias.' : 'sem a comparação completa dos 28 dias nesta semana (dia sem coleta não é venda zero).')
    const u = unicosPorNome(achados, ([i]) => i), vis = u.lista.slice(0, Math.max(0, max - (linhaFora ? 1 : 0))), nm = u.nm
    return { texto: `${T}\n${[linhaFora, ...vis.map(([i, txt]) => `• ${nm(i)}: ${txt}`)].filter(Boolean).join('\n')}${achados.length > vis.length ? `\n• e mais ${plural(achados.length - vis.length, 'anúncio', 'anúncios')} com queda` : ''}`, conteudo: true }
  },
  ads({ R, info, itens, ok }) {
    // só ação APROVADA/distribuída é «aprovado no plano» (mexe na verba do cliente); proposta = «em análise», sem nome nem promessa
    const T = tituloDe(R, 'ads'), a = info.ads, acs = (info.acoes || []).filter(x => R.frases_ads[regraBase(x.regra)])
    const ajustes = linhasDeAcoes(acs.filter(x => APROVADAS.includes(x.status)), R.frases_ads, { itens, ok, max: 3 })
    const analise = !ajustes.length && acs.some(x => x.status === 'proposta')
    const fim = ajustes.length ? `\nAprovado no plano do mês para os anúncios pagos:\n${ajustes.join('\n')}` : analise ? '\nAjustes nos anúncios pagos seguem em análise no plano do mês; nada foi mudado ainda.' : ''
    if (!a) return ajustes.length ? { texto: `${T}\nAinda não temos a leitura dos anúncios pagos desta conta.${fim}`, conteudo: true } : vazio(T, 'ainda não temos a leitura dos anúncios pagos desta conta.')
    if (!(a.custo > 0)) return ajustes.length ? { texto: `${T}\nSem investimento em anúncios pagos nos últimos 28 dias.${fim}`, conteudo: true } : vazio(T, 'sem investimento em anúncios pagos nos últimos 28 dias.')
    const roas = x => x == null ? '' : String(Math.round(x * 100) / 100).replace('.', ',')
    return { texto: `${T}\nInvestimento de ${brl(a.custo)} nos últimos 28 dias; o Mercado Livre registrou ${brl(a.receita)} em vendas nos anúncios pagos${a.roas != null ? ` (ROAS ${roas(a.roas)})` : ''}.` +
      (a.anterior?.custo > 0 ? ` Nos 28 dias anteriores: ${brl(a.anterior.custo)} investidos${a.anterior.roas != null ? `, ROAS ${roas(a.anterior.roas)}` : ''}.` : '') + fim, conteudo: true }
  },
  promocoes({ R, info, hoje, parado, ok }) {
    const T = tituloDe(R, 'promocoes'), p = info.promocoes
    if (!p) return vazio(T, 'ainda não temos a leitura das promoções desta conta.')
    const itensAr = [...new Map((p.no_ar || []).map(o => [String(o.item_id), o])).values()], campanhas = [...new Set(itensAr.map(o => o.nome).filter(Boolean))]
    const limite = mais(hoje, R.promocao_terminando_dias), term = itensAr.filter(o => o.fim && o.fim.slice(0, 10) <= limite).filter(o => ok(o))
    const giro = parado.reduce((t, x) => t + x.disponivel, 0), linhas = []
    if (itensAr.length) linhas.push(`No ar: ${plural(itensAr.length, 'anúncio', 'anúncios')} em promoção${campanhas.length ? ` (${campanhas.slice(0, 3).join(', ')}${campanhas.length > 3 ? ' e outras' : ''})` : ''}.`)
    if (term.length) linhas.push(`Terminando até ${dm(limite)}: ${nomesCurtos(term)}.`)
    if (p.elegiveis > 0) linhas.push(`${plural(p.elegiveis, 'anúncio está elegível', 'anúncios estão elegíveis')} para campanhas do Mercado Livre agora: dá para avaliar com a margem de cada um.`)
    if (giro > 0) linhas.push(`${plural(giro, 'unidade parada', 'unidades paradas')} no Full ${giro === 1 ? 'pode' : 'podem'} girar com uma ação de giro.`)
    const lida = `_(leitura das promoções de ${dm(p.lida_em)}${p.parcial ? ', parcial' : ''})_`
    if (!linhas.length) return { ...vazio(T, `nenhuma promoção no ar nem campanha elegível na última leitura (${dm(p.lida_em)}${p.parcial ? ', parcial' : ''}).`), texto: `${T}\nNenhuma promoção no ar nem campanha elegível na última leitura. ${lida}` }
    return { texto: `${T}\n${linhas.join('\n')}\n${lida}`, conteudo: true }
  },
  concorrencia({ R, info, itens, ok, max, hoje }) {
    const T = tituloDe(R, 'concorrencia'), porId = porIdDe(itens), achados = [], comDado = new Set(), conferir = []
    const ST = { winning: 'sua oferta é a principal da página do catálogo', sharing_first_place: 'sua oferta divide a página principal do catálogo', competing: 'disputando a página do catálogo' }
    // preço para ganhar (Mercado Livre, price_to_win): ao cliente só com leitura de até ptw_max_dias e diferença de até ptw_max_dif_pct; acima disso (frete, Full, condição
    // ou variação diferentes do vencedor costumam explicar) fica fora do texto e vai para «conferir» na prévia. Sempre com a ressalva de margem.
    for (const i of itens.filter(i => i.catalogo && ok(i)).sort((a, b) => b.r - a.r)) {
      const p = i.ptw, abaixo = p?.status === 'competing' && p.preco_para_ganhar != null && i.preco != null && p.preco_para_ganhar < i.preco - 0.01
      const dif = abaixo ? Math.round((1 - p.preco_para_ganhar / i.preco) * 100) : 0, fresco = !!p?.lido_em && diasAte(p.lido_em, hoje) <= R.ptw_max_dias
      if (abaixo && !(fresco && dif <= R.ptw_max_dif_pct)) conferir.push(`${nome(i.titulo)}: preço para ganhar ${brl2(p.preco_para_ganhar)} × seu preço ${brl2(i.preco)} (−${dif}%${p.lido_em ? `, lido em ${dm(p.lido_em)}` : ', sem data de leitura'}) — conferir condição, frete e variação antes de falar com o cliente`)
      const txt = abaixo && fresco && dif <= R.ptw_max_dif_pct ? `no catálogo, o Mercado Livre indica ${brl2(p.preco_para_ganhar)} para a sua oferta ser a principal da página (seu preço: ${brl2(i.preco)}; lido em ${dm(p.lido_em)}). Só vale se couber na sua margem; avaliamos com você`
        : ST[p?.status] || (i.buy_box === false ? 'no catálogo, sem a caixa de compra' : '')
      if (txt) { comDado.add(String(i.id)); achados.push([i, txt]) }
    }
    const cad = new Map(); for (const c of info.concorrentes || []) (cad.get(String(c.item_id)) || cad.set(String(c.item_id), []).get(String(c.item_id))).push(c)
    for (const [id, l] of cad) {
      const i = porId.get(id); if (!i || !ok(i)) continue
      const precos = l.map(x => x.preco).sort((a, b) => a - b), ult = l.map(x => x.observado_em).sort().at(-1)
      comDado.add(id); achados.push([i, `${plural(l.length, 'concorrente acompanhado', 'concorrentes acompanhados')}, ${precos.length > 1 ? `de ${brl2(precos[0])} a ${brl2(precos.at(-1))}` : `a ${brl2(precos[0])}`} (visto em ${dm(ult)})${i.preco != null ? `; seu preço: ${brl2(i.preco)}` : ''}`])
    }
    const u = unicosPorNome(achados, ([i]) => i), nm = u.nm, linhas = u.lista.slice(0, max).map(([i, txt]) => `• ${nm(i)}: ${txt}`)
    const sem = itens.filter(i => i.curva === 'A' && i.r > 0 && !comDado.has(String(i.id)) && ok(i)).sort((a, b) => b.r - a.r).slice(0, 3)
    const semTxt = sem.length ? `• ${nomesCurtos(sem)}: ainda não acompanhamos concorrentes ${sem.length === 1 ? 'deste anúncio' : 'destes anúncios'}. Seu consultor pode cadastrar.` : ''
    return { texto: `${T}\n${[...linhas, semTxt].filter(Boolean).join('\n')}${!linhas.length && !semTxt ? 'Ainda não acompanhamos concorrentes destes anúncios. Seu consultor pode cadastrar.' : ''}\nA comparação ampla de preços na busca do Mercado Livre ainda não é coletada.`, conteudo: linhas.length > 0, ...(conferir.length ? { conferir } : {}) }
  },
  acoes_vendas({ R, info, itens, ok, max }) {
    // distribuída = virou tarefa da equipe (em andamento); aprovada = decidida, ainda não iniciada; proposta nunca entra
    const T = tituloDe(R, 'acoes_vendas'), de = st => linhasDeAcoes((info.acoes || []).filter(a => a.status === st), R.frases_acoes, { itens, ok, max })
    const and = de('distribuida'), apr = de('aprovada').slice(0, Math.max(0, max - and.length))
    const linhas = [...(and.length ? ['Em andamento (já viraram tarefa da equipe):', ...and] : []), ...(apr.length ? ['Aprovadas no plano, ainda não iniciadas:', ...apr] : [])]
    return linhas.length ? { texto: `${T}\n${linhas.join('\n')}`, conteudo: true } : vazio(T, SEM_APROVADA)
  },
  criacao({ R, info, itens, ok, max }) {
    const T = tituloDe(R, 'criacao'), regras = new Set(R.regras_criacao), fams = new Set(R.familias_criacao)
    const l = linhasDeAcoes((info.acoes || []).filter(a => APROVADAS.includes(a.status) && regras.has(regraBase(a.regra))), R.frases_acoes, { itens, ok, max })
    const t = Array.isArray(info.tarefas) ? info.tarefas.filter(x => fams.has(x.id)) : []
    const linhas = [...(t.length ? [`Concluído nos últimos ${R.acoes_semana_dias} dias: ${t.map(x => `${x.familia.toLowerCase()} (${x.n})`).join(', ')}.`] : []), ...(l.length ? ['No plano, aprovado:', ...l] : [])]
    return linhas.length ? { texto: `${T}\n${linhas.join('\n')}`, conteudo: true } : vazio(T, SEM_APROVADA)
  },
}

// config do relatório personalizado (config/perfil-informacao.json → relatorio); lido a cada chamada (barato; mudar o config não exige reiniciar)
export const lerCfgRelatorio = () => JSON.parse(readFileSync(join(ROOT, 'config', 'perfil-informacao.json'), 'utf-8')).relatorio

// WhatsApp: acima de ~max caracteres a mensagem sai em partes, na ordem, cortando SÓ entre parágrafos (linha em branco) — nunca no meio de um bloco; título sozinho
// numa linha (termina em «*») vai junto do parágrafo seguinte. Cada parte, menos a última, ganha a linha `continua`. Sem as linhas `continua`, partes.join('\n\n') === texto.
// ponytail: guloso equilibrado (o menor teto que mantém o número de partes); um parágrafo maior que o teto sai inteiro numa parte só
export function dividirMensagem(texto, { max = 4000, continua = '' } = {}) {
  const t = String(texto ?? ''); if (t.length <= max) return [t]
  const titulo = p => !p.includes('\n') && /\*\s*$/.test(p), pars = []
  for (const p of t.split('\n\n')) { const u = pars.at(-1); if (u && titulo(u)) pars[pars.length - 1] = `${u}\n\n${p}`; else pars.push(p) }
  const extra = continua ? continua.length + 2 : 0
  const guloso = lim => { const out = []; let atual = ''; for (const p of pars) { const junto = atual ? `${atual}\n\n${p}` : p; if (atual && junto.length + extra > lim) { out.push(atual); atual = p } else atual = junto } if (atual) out.push(atual); return out }
  // equilibra: o menor teto (a partir de total ÷ partes) que mantém o MESMO número de partes — nada de uma 2ª mensagem só com a assinatura
  let partes = guloso(max)
  for (let lim = Math.ceil(t.length / partes.length) + extra; partes.length > 1 && lim < max; lim += 100) { const p = guloso(lim); if (p.length <= partes.length) { partes = p; break } }
  return partes.map((p, k) => continua && k < partes.length - 1 ? `${p}\n\n${continua}` : p)
}

// ── RELATÓRIO FOCADO (pedido do David, 14/10/2026): «estoque e ruptura, o que a equipe fez e o que já está dando resultado», ao grupo do Mercado Livre do cliente, só
// depois de ele aprovar a prévia (scripts/relatorio-foco.mjs; dados de gatilhos-real.relatorioFoco). PURO e projeção — os MESMOS construtores do semanal: 📦 rupturaDe +
// linhaRuptura (fora do Full, a quantidade do pedido ao fornecedor de preverCompras), fora do ar = foraDoAr pela venda dos ÚLTIMOS 28 dias, pausado com estoque 0 (fato:
// R$ e unidades, nunca um ritmo inventado), próximos pedidos = comprasDe; 🛠️ linhaTarefa por família (familiaCliente, sem analista, sem tipo cru) em R.foco_tarefas_dias;
// ✅ linhaEntrega + linhasMedidas só do que VENDE hoje (venda nos 28 dias, fora do «já fora do ar», nos últimos causa_janela_dias) e só medição que subiu de fato (efeito
// ajustado E bruto > 0, vendas depois ≥ antes, confiança ≥ média). Ausente ≠ zero: Notion não lido = «sem a leitura» (sem conteúdo); zero confirmado = a seção some e vira
// CONFERIR (interno); nada medido = ⏳ «em medição» só com medição de fato em curso, senão a seção some. Abertura e título citam só as seções que entraram; sem linha no 📦
// o fecho é o curto. Nomes resolvidos contra a CONTA inteira (o mesmo anúncio, o mesmo nome; título idêntico a outro anúncio = o pedido leva o link). Até 5 linhas por
// lista («e mais N»); acima de maxCaracteres o teto de linhas desce até caber — o corte é sempre de linha inteira. → { texto, secoes [{ chave, conteudo }], conferir, tem_conteudo }
export const FOCO_MAX_CARACTERES = 3800
export const FOCO_CONFIANCA_MIN = 60                                     // a faixa «confiança média» de rotConfianca: abaixo disso não é «dando resultado»
const FOCO_NADA_URG = 'Nenhum campeão de vendas perto de acabar pelo ritmo dos últimos 28 dias ✅'
const eMais = (n, um, varios) => n > 0 ? [`• e mais ${plural(n, um, varios)}`] : []
// os cabeçalhos possíveis da mensagem (o envio confere que o texto é do cliente certo)
export const cabecalhosFoco = (rotulo, hoje) => ['Estoque, ações e resultados', 'Estoque e ações', 'Estoque e resultados', 'Estoque'].map(t => `*${t} · ${rotulo} · ${dm(hoje)}*`)
export function montarRelatorioFoco({ rotulo, hoje, itens = [], entregas = [], limiares: L = {}, info = {}, livre = () => true, tituloOk = () => true, cfgRel = null, maxCaracteres = FOCO_MAX_CARACTERES }) {
  const R = cfgRel || lerCfgRelatorio(), ok = x => tituloOk(limpo(x.titulo)), dias = R.foco_tarefas_dias, t = info.tarefas, conferir = []
  const compra = mapaCompras(info.compras?.itens)
  const urg = rupturaDe(itens, L, { livre, ok }).urg.map(i => ehFull(i) ? i : { ...i, sug: compra.get(String(i.id))?.quanto_pedir || null }), urgIds = new Set(urg.flatMap(i => [String(i.id), ...(compra.get(String(i.id))?.produto?.itens || [])].map(String)))
  const fora = foraDoAr(itens, L, { livre, ok, campo: 'r' }).filter(i => i.status === 'paused' && i.estoque === 0)     // a ruptura RECENTE que já aconteceu
  // ponytail (14/10): entrega que AINDA vende conta por foco_entregas_dias (120) com a data no texto; medição segue em causa_janela_dias
  const porId = porIdDe(itens), foraIds = new Set(fora.map(i => String(i.id))), desde = mais(hoje, -(R.foco_entregas_dias ?? R.causa_janela_dias))
  const vende = id => (porId.get(String(id))?.u || 0) > 0 && !foraIds.has(String(id))
  const ent = entregas.filter(e => ok(e) && String(e.dia) >= desde && vende(e.item_id)), entIds = new Set(ent.map(e => String(e.item_id ?? '')))
  const uni = [...new Map([...itens, ...ent].map(x => [String(x.id ?? x.item_id), x])).values()], ns = nomesDe(uni), nomeId = new Map(uni.map((x, k) => [String(x.id ?? x.item_id), ns[k]]))
  const nm = x => nomeId.get(String(x.id ?? x.item_id)) ?? nome(x.titulo), vezes = ns.reduce((m, n) => m.set(n, (m.get(n) || 0) + 1), new Map()), link = x => vezes.get(nm(x)) > 1
  const lm = linhasMedidas((info.causa?.medidas || []).filter(m => m.estado === 'melhorou' && m.efeito_pct > 0 && m.bruto_pct > 0 && m.vendas_ok === true && (m.confianca ?? 0) >= FOCO_CONFIANCA_MIN &&
    vende(m.item_id) && !entIds.has(String(m.item_id))), { itens, ok, nm })
  // ponytail (14/10): poucas tarefas registradas (1 a foco_tarefas_min − 1 em 30 dias) não vão ao cliente — pode ser quadro incompleto e soa como pouco trabalho;
  // a seção sai e o caso volta como nota_interna (NÃO retém o envio, ao contrário do conferir)
  const nTar = Array.isArray(t) ? t.reduce((s, x) => s + (x.n || 0), 0) : null, poucas = nTar != null && nTar > 0 && nTar < (R.foco_tarefas_min ?? 4)
  const emMedicao = info.causa?.outras?.em_medicao || 0, comTarefas = !(Array.isArray(t) && !t.length) && !poucas
  const nota_interna = poucas ? [`só ${plural(nTar, 'tarefa concluída', 'tarefas concluídas')} no Notion em ${dias} dias: a seção de tarefas saiu da mensagem; conferir o quadro com a equipe`] : []
  if (!info.compras?.disponivel) conferir.push('previsão de compras indisponível (falta a leitura de vendas e estoque): os próximos pedidos ficaram fora')
  if (Array.isArray(t) && !t.length) conferir.push(`nenhuma tarefa do Mercado Livre concluída nos últimos ${dias} dias (Notion lido): conferir com a equipe`)
  const montar = max => {
    const urgV = urg.slice(0, max), junto = urgV.filter(i => !ehFull(i) && compra.has(String(i.id))).map(i => compra.get(String(i.id)))
    const cp = comprasDe({ R, info, urgIds, ok, hoje, max, nm, link, junto }), pedidos = cp.linhas || [], premissa = cp.premissa ? [cp.premissa] : []
    const est = [...(urg.length ? ['Campeões de venda perto de acabar:', ...urgV.map(i => linhaRuptura(i, nm)), ...eMais(urg.length - max, 'produto', 'produtos'), ...(pedidos.length ? [] : premissa), ...(algumGrupo(urgV) && !pedidos.length && !premissa.length ? [PREMISSA_PRODUTO] : [])] : []),
      ...(fora.length ? ['Já fora do ar por falta de estoque:', ...fora.slice(0, max).map(i => `• ${nm(i)}${sufixoAnuncios(i)}: sem estoque e pausado; nos últimos 28 dias vendeu *${brl(estoqueDe(i).r)}* (${plural(estoqueDe(i).u || 0, 'unidade', 'unidades')})${i.permalink ? `\n  ${i.permalink}` : ''}`), ...eMais(fora.length - max, 'anúncio', 'anúncios')] : []),
      ...(pedidos.length ? ['Próximos pedidos ao fornecedor:', ...pedidos, ...eMais(cp.resto, 'produto', 'produtos'), ...premissa] : [])]
    const temEst = est.length > 0
    if (!temEst) est.push(FOCO_NADA_URG)                           // o ✅ só quando o 📦 inteiro está vazio (nunca ao lado de um anúncio que já parou)
    const g = Math.min(6, max + 1), tar = !Array.isArray(t) ? ['Sem a leitura das tarefas (não quer dizer que nada foi feito).']
      : [`Tarefas concluídas no Mercado Livre nos últimos ${dias} dias:`, ...t.slice(0, g).map(linhaTarefa), ...eMais(t.slice(g).reduce((s, x) => s + x.n, 0), 'tarefa em outras frentes', 'tarefas em outras frentes')]
    const res = [...ent.slice(0, max).map(e => linhaEntrega(e, nm)), ...eMais(ent.length - max, 'entrega', 'entregas'),
      ...(lm.length ? [`Ações medidas nos últimos ${R.causa_janela_dias} dias, comparando o anúncio com os que não mexemos no mesmo período:`, ...lm.slice(0, max), ...eMais(lm.length - max, 'ação com alta medida', 'ações com alta medida'), ASSOCIACAO] : [])]
    const fim = res.length ? ['resultados', '✅ *O que já está dando resultado*', res, true]
      : emMedicao > 0 ? ['medicao', '⏳ *Resultados em medição*', [`${plural(emMedicao, 'ação segue', 'ações seguem')} em medição; quando houver venda medida, ela aparece aqui.`], false] : null
    const secs = [['estoque', '📦 *Estoque e ruptura*', est, temEst], ...(comTarefas ? [['tarefas', '🛠️ *O que a nossa equipe fez na sua conta*', tar, Array.isArray(t)]] : []), ...(fim ? [fim] : [])]
    const tit = ['Estoque', ...(comTarefas ? ['ações'] : []), ...(fim ? ['resultados'] : [])]
    const rodape = `${PERGUNTA_FOCO}\n\n` + (temEst ? `${FECHO}\n${ASSINATURA}${urg.length || pedidos.length ? `\n${cp.premissas ? NOTA_COMPRAS : NOTA}` : ''}` : `${FECHO_CURTO}\n${ASSINATURA}`)   // fora do ar = fato (R$ e un), sem estimativa
    const texto = `${aberturaFoco(secs.map(s => s[0]))}\n\n*${tit.length > 1 ? `${tit.slice(0, -1).join(', ')} e ${tit.at(-1)}` : tit[0]} · ${rotulo} · ${dm(hoje)}*\n\n` +
      secs.map(([, T, l]) => `${T}\n${l.join('\n')}`).join('\n\n') + `\n\n${rodape}`
    return { texto, secoes: secs.map(([chave, , , conteudo]) => ({ chave, conteudo })) }
  }
  // ponytail: teto de linhas descendo 5 → 1 até caber; com 1 linha por lista o texto fica perto de 2.500 caracteres (títulos cortados em 70), então o aviso abaixo é só guarda
  let r; for (const max of [5, 4, 3, 2, 1]) { r = montar(max); if (r.texto.length <= maxCaracteres) break }
  if (r.texto.length > maxCaracteres) conferir.push(`texto com ${r.texto.length} caracteres mesmo com 1 linha por lista: revisar antes de enviar`)
  return { ...r, conferir, nota_interna, tem_conteudo: r.secoes.some(s => s.conteudo) }
}

// urgente (na hora): abertura curta no mesmo tom, até `max` pontos (cabeçalho + fato com número e link), fecho e assinatura; a nota de estimativa só quando há quantidade estimada.
// 14/10/2026 (estoque e preço): item.impacto { c, b, dias } (previsão da regra do plano, gatilhos.js) vira «💰 Impacto estimado: cerca de R$ c a R$ b em vendas nos próximos N dias se
// nada for feito»; com 2+ pontos com número, o total vai no topo; a premissa da estimativa sai UMA vez no rodapé; preço que acabou de subir sem número = «ainda cedo para medir»;
// sem número (sem dado suficiente) = nenhuma linha de R$ (nunca zero inventado). resto = pontos que ficaram para o próximo aviso («e mais N»).
const valorAprox = v => 'R$ ' + (v >= 1000 ? Math.round(v / 100) * 100 : v >= 100 ? Math.round(v / 10) * 10 : Math.round(v)).toLocaleString('pt-BR')   // arredondamento explícito: «cerca de»
export const faixaImpacto = ({ c, b }) => { const x = valorAprox(c), y = valorAprox(b); return x === y ? `cerca de ${y}` : `cerca de ${x} a ${y}` }
export function montarUrgente({ rotulo, itens = [], max = 3, resto = 0 }) {
  const l = itens.filter(i => i && i.texto).slice(0, max)
  if (!l.length) return { texto: '', n: 0 }
  const com = l.filter(i => i.impacto?.b > 0), total = com.length ? { c: com.reduce((t, i) => t + i.impacto.c, 0), b: com.reduce((t, i) => t + i.impacto.b, 0) } : null
  const linhaR = i => i.impacto?.b > 0 ? `\n💰 *Impacto estimado:* ${faixaImpacto(i.impacto)} em vendas nos próximos ${i.impacto.dias} dias se nada for feito.` : i.tipo === 'preco_alterado_drastico' ? `\n${IMPACTO_CEDO}` : ''
  // a mesma premissa do pedido ou a mesma data de leitura em dois pontos (📦 e 🛒 do aviso de estoque) sai uma vez só, no primeiro
  const vistas = new Set(), REPETE = /^(Prazo usado: |Estoque conforme a leitura de )/
  const corpo = l.map((i, k) => `${l.length > 1 ? `*${k + 1}.* ` : ''}${blocoDe(i.tipo, [i.texto])}${linhaR(i)}`).join('\n\n').split('\n').filter(x => !REPETE.test(x) || (!vistas.has(x) && !!vistas.add(x))).join('\n')
  // o total soma pontos com prazos diferentes (zerado 7 d, ruptura = prazo de reposição, compra = prazo + folga): o topo diz isso (achado de 14/10)
  const dd = [...new Set(com.map(i => i.impacto.dias))].sort((a, b) => a - b)
  const topo = com.length > 1 ? `💰 No total, *${faixaImpacto(total)}* em vendas em jogo nestes pontos${dd.length === 1 ? ` nos próximos ${dd[0]} dias` : ` (somando o prazo de cada um: ${juntarE(dd.map(String))} dias)`}.\n\n` : ''
  const mais = resto > 0 ? `\n\n• E mais ${resto} ${resto === 1 ? 'ponto' : 'pontos'} de estoque e preço, que trazemos no próximo aviso.` : ''
  const nota = com.length ? IMPACTO_PREMISSA : l.some(i => ['ruptura_curva_a', 'queda_por_preco'].includes(i.tipo)) ? NOTA : ''
  return { texto: `${URG_ABRE}${rotulo}${l.length > 1 || resto > 0 ? URG_VARIOS : URG_UM}\n\n${topo}${corpo}${mais}\n\n${URG_FECHO}\n${ASSINATURA}${nota ? `\n${nota}` : ''}`, n: l.length, total }
}

// ── MICRO-RELATÓRIO DE COMPRAS (pedido do David, 15/10/2026: «MLB, título, preço de venda e o quanto iremos perder de faturamento se o ciclo de compras não acontecer») ──
// Itens DIRETO do diagnóstico do dia (sem depender de ação no plano, aprovação ou Notion): ruptura e abaixo do ponto de reposição (os MESMOS predicados do plano e do aviso —
// emRuptura, estoque ≤ ponto_reposicao, curva A/B ativa) + «pedir agora / até dd/mm» da previsão de compras (quando_pedir dentro do ciclo de compra). Um por produto (chave
// produto.diagnostico_ligado; desligada = um por anúncio, como hoje). Perda = riscoRuptura com a folga de segurança (prazo + folga dias, a do «hora de pedir»), conservador–base;
// sem a janela de 28 dias inteira coletada, sem número (dia sem coleta não é zero).
export const janelaInteira = diag => { const pd = diag?.data_quality?.cobertura?.pedidos; return !!(pd?.de && diag.periodo?.de && pd.de <= diag.periodo.de && Array.isArray(pd.lacunas) && !pd.lacunas.some(d => d >= diag.periodo.de && d <= diag.periodo.ate)) }
export function itensMicroCompras(diag, compras, { limiares: L, ciclo_dias }) {
  if (!diag?.disponivel) return { disponivel: false, motivo: String(diag?.motivo || 'diagnostico_indisponivel').slice(0, 60) }
  const its = (diag.itens || []).filter(i => i && i.id), porId = new Map(its.map(i => [String(i.id), i])), janela = janelaInteira(diag), folga = L.estoque_seguranca_dias, out = new Map()
  const add = (i, origem, pedir_ate = null) => {
    const k = i.produto?.chave || String(i.id); if (out.has(k)) return
    const r = riscoRuptura(i, L, { folga }), cob = Number.isFinite(i.cobertura) ? i.cobertura : null
    out.set(k, { id: String(i.id), titulo: i.titulo || '', preco: Number.isFinite(i.preco) ? i.preco : null, estoque: Number.isFinite(estoqueDe(i).estoque) ? estoqueDe(i).estoque : null,
      cobertura: cob == null ? null : Math.round(cob), curva: i.curva || '', full: ehFull(i), sufixo: sufixoAnuncios(i), lead: r.lead, origem, pedir_ate,
      impacto: janela && cob != null ? { c: Math.max(0, Math.round(r.cenarios.conservador)), b: Math.max(0, Math.round(r.cenarios.base)), dias: r.lead + folga } : null })
  }
  const ab = its.filter(i => ['A', 'B'].includes(i.curva) && i.status === 'active' && representaEstoque(i))
  for (const i of ab) if (emRuptura(i, L)) add(i, 'ruptura')
  for (const i of ab) if (Number.isFinite(i.ponto_reposicao) && Number.isFinite(estoqueDe(i).estoque) && estoqueDe(i).estoque <= i.ponto_reposicao) add(i, 'ponto')
  for (const x of compras?.disponivel ? compras.itens || [] : []) {
    const q = x.quando_pedir; if (!q || !(q.agora || q.dias <= ciclo_dias)) continue
    const i = [x.id, ...(x.produto?.itens || [])].map(id => porId.get(String(id))).find(Boolean); if (i) add(i, q.agora ? 'pedir_agora' : 'pedir_ate', q.agora ? null : q.data)
  }
  return { disponivel: true, itens: [...out.values()] }
}
// texto curto, uma linha por produto (curva A/B primeiro, maior perda primeiro), até `max` linhas + «e mais N», total no topo, premissa + resposta + assinatura; ≤ maxCaracteres.
// → { texto, n, resto, total, avisar: [{ id, snap }] } (avisar = os produtos DITOS, para a memória gatilho_avisado) | { texto: '' }
const brlC = n => 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export function montarMicroCompras({ rotulo, itens = [], max = 8, maxCaracteres = 2000, folga = 7, tituloOk = () => true }) {
  const rank = i => ['A', 'B'].includes(i.curva) ? 0 : 1
  const l = itens.filter(i => i && i.id && tituloOk(i.titulo)).sort((a, b) => rank(a) - rank(b) || (b.impacto?.b ?? -1) - (a.impacto?.b ?? -1) || (a.cobertura ?? Infinity) - (b.cobertura ?? Infinity))
  if (!l.length) return { texto: '', n: 0, resto: 0, total: null, avisar: [] }
  const com = l.filter(i => i.impacto), total = com.some(i => i.impacto.b > 0) ? { c: com.reduce((t, i) => t + i.impacto.c, 0), b: com.reduce((t, i) => t + i.impacto.b, 0) } : null
  const dd = [...new Set(com.filter(i => i.impacto.b > 0).map(i => i.impacto.dias))]
  const perda = i => i.impacto?.b > 0 ? `se não repor: −${valorAprox(i.impacto.c)}${valorAprox(i.impacto.c) === valorAprox(i.impacto.b) ? '' : ` a −${valorAprox(i.impacto.b)}`} em vendas nos próximos ${i.impacto.dias} dias`
    : `pedir ${i.pedir_ate ? `até ${dm(i.pedir_ate)}` : 'agora'} para não faltar`
  const linha = i => `• ${i.id} · ${nome(i.titulo)}${i.sufixo || ''}${i.preco != null ? ` · ${brlC(i.preco)}` : ''}${i.estoque === 0 ? ` · sem estoque${i.full ? ' no Full' : ''}` : i.estoque != null ? ` · estoque ${i.estoque} un${i.full ? ' no Full' : ''}${i.cobertura != null ? ` (${diasTxt(i.cobertura)})` : ''}` : ''} → ${perda(i)}`
  const leads = [...new Set(l.map(i => i.lead))].sort((a, b) => a - b), leadTxt = leads.length > 1 ? `${leads[0]} a ${leads.at(-1)}` : leads[0]
  const topo = `${URG_ABRE}${rotulo}${MICRO_UM}${total ? `\n\n💰 *Total em jogo:* ${valorAprox(total.c)}${valorAprox(total.c) === valorAprox(total.b) ? '' : ` a ${valorAprox(total.b)}`}${dd.length === 1 ? ` em vendas nos próximos ${dd[0]} dias` : ''}` : ''}`
  const fim = `_Estimativa pelo ritmo de vendas dos últimos 28 dias e prazo de reposição de ${leadTxt} dias + ${folga} de folga${MICRO_GARANTIA}\n${MICRO_RESPOSTA}\n${ASSINATURA}`
  let n = Math.min(max, l.length), texto
  for (;; n--) {
    const resto = l.length - n, oc = l.slice(n), todosNoTotal = oc.every(i => i.impacto)
    const mais = resto ? `\n• e mais ${resto} ${resto === 1 ? 'produto' : 'produtos'}${total && todosNoTotal ? `, já ${resto === 1 ? 'somado' : 'somados'} no total` : ''}` : ''
    texto = `${topo}\n\n${l.slice(0, n).map(linha).join('\n')}${mais}\n\n${fim}`
    if (texto.length <= maxCaracteres || n <= 1) break
  }
  return { texto, n, resto: l.length - n, total, avisar: l.slice(0, n).map(i => ({ id: i.id, snap: { estoque: i.estoque, cobertura: i.cobertura } })) }
}
