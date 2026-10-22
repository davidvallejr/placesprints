// Filtros avançados (estilo Pipedrive) para TODOS os painéis: condições combináveis com E/OU, operadores por tipo de campo, período com
// presets e data filtrada EXPLÍCITA, comparação com o período anterior e com o mesmo período do ano passado, filtros salvos (favoritos) e
// serialização na URL (?f=) para que exportações e documentos respeitem o filtro ativo.
// Núcleo puro: a definição dos campos por painel, a validação, o compilador para SQL (lista fechada de colunas, sempre parametrizado) e o
// compilador para predicado em memória. O banco entra só pela fábrica criarFiltrosSalvos(handle) — testável sem data/db.sqlite.

import { ROTULOS as ROTULOS_STATUS } from './status-tarefa.js'   // constantes puras: o núcleo continua sem banco
import { ROTULO_PRODUTO } from './produto.js'                    // idem (só lê config/produtos.json)

export const OPERADORES = {
  igual: { rotulo: 'é igual a', tipos: ['texto', 'enum', 'numero', 'data', 'bool'], arid: 1 },
  diferente: { rotulo: 'é diferente de', tipos: ['texto', 'enum', 'numero', 'data', 'bool'], arid: 1 },
  em: { rotulo: 'é um de', tipos: ['texto', 'enum'], arid: 'lista' },
  contem: { rotulo: 'contém', tipos: ['texto', 'enum'], arid: 1 },
  nao_contem: { rotulo: 'não contém', tipos: ['texto', 'enum'], arid: 1 },
  maior: { rotulo: 'é maior que', tipos: ['numero', 'data'], arid: 1 },
  menor: { rotulo: 'é menor que', tipos: ['numero', 'data'], arid: 1 },
  entre: { rotulo: 'está entre', tipos: ['numero', 'data'], arid: 2 },
  vazio: { rotulo: 'está vazio', tipos: ['texto', 'enum', 'numero', 'data'], arid: 0 },
  nao_vazio: { rotulo: 'está preenchido', tipos: ['texto', 'enum', 'numero', 'data'], arid: 0 },
}
export const PRESETS = ['hoje', 'ontem', 'este_mes', 'mes_passado', 'este_ano', 'ano_passado', 'ultimos_3_meses', 'ultimos_90_dias', 'personalizado']
export const ROTULO_PRESET = { hoje: 'Hoje', ontem: 'Ontem', este_mes: 'Este mês', mes_passado: 'Mês passado', este_ano: 'Este ano', ano_passado: 'Ano passado', ultimos_3_meses: 'Últimos 3 meses', ultimos_90_dias: 'Últimos 90 dias', personalizado: 'Período personalizado' }
export const COMPARACOES = { anterior: 'Período anterior', ano_anterior: 'Mesmo período do ano passado' }
// rótulos legíveis dos valores de enum (a chave é o nome da lista em `opcoes`): a tela e os chips nunca mostram o valor cru
export const ROTULOS = {
  status_tarefa: ROTULOS_STATUS,
  status_acao: { proposta: 'Proposta', aprovada: 'Aprovada', distribuida: 'No Notion', descartada: 'Descartada', obsoleta: 'Obsoleta' },
  horizontes: { '72h': '72 horas', '7d': '7 dias', '30d': '30 dias', '90d': '90 dias' },
  status_anuncio: { active: 'Ativo', paused: 'Pausado', closed: 'Encerrado', under_review: 'Em revisão' },
  etapas_comercial: { aguardando: 'Aguardando conexão', erro: 'Com erro', conectado: 'Conectado sem dados', pronto: 'Pronto para apresentar', pediu_contato: 'Pediu contato' },
  logistica: { fulfillment: 'Full', cross_docking: 'Coleta (cross docking)', drop_off: 'Postagem (drop off)', xd_drop_off: 'Postagem (cross docking)', self_service: 'Flex', not_specified: 'Não informada' },
  canais: { ML: 'Mercado Livre', SHO: 'Shopee', AMZ: 'Amazon', TTK: 'TikTok Shop' },
  sim_nao: { 1: 'Sim', 0: 'Não' },
  produtos: ROTULO_PRODUTO,                               // Performance × Prime (config/produtos.json) + sem produto mapeado                        // campos bool: o chip diz "é igual a Sim", nunca "é igual a 1"
}
export const rotuloValor = (campo, v) => (campo?.opcoes && ROTULOS[campo.opcoes]?.[v]) || String(v)

// ── campos por painel ───────────────────────────────────────────────────────
// tipo: texto | enum | numero | data | bool. opcoes: nome da lista que a rota resolve (clientes, consultores, analistas, canais…).
// coluna: coluna SQL quando o painel consulta a tabela direto; sem coluna, o campo é avaliado em memória (predicado) sobre as linhas calculadas.
const CAMPOS_COMUNS = {
  cliente: { rotulo: 'Cliente', tipo: 'enum', opcoes: 'clientes' },
  canal: { rotulo: 'Canal / marketplace', tipo: 'enum', opcoes: 'canais' },
  consultor: { rotulo: 'Consultor responsável', tipo: 'enum', opcoes: 'consultores' },
  analista: { rotulo: 'Analista responsável', tipo: 'enum', opcoes: 'analistas' },
  produto: { rotulo: 'Produto (Performance × Prime)', tipo: 'enum', opcoes: 'produtos' },   // dimensão do tier da central; recorta o que se vê, nunca o que o algoritmo vê
}
export const PAINEIS = {
  execucao: {
    rotulo: 'Painel executivo (tarefas do Notion)', tabela: 'tarefas',
    campos: {
      cliente: { ...CAMPOS_COMUNS.cliente, coluna: 'cliente' },
      canal: { ...CAMPOS_COMUNS.canal, coluna: 'processo', opcoes: 'processos' },      // no Notion o canal vive em "Processo"
      consultor: { ...CAMPOS_COMUNS.consultor, expande: 'clientes_do_consultor' },      // vira "cliente é um de [clientes do consultor]"
      produto: { ...CAMPOS_COMUNS.produto, expande: 'clientes_do_produto' },            // idem: "cliente é um de [clientes do produto]"
      analista: { ...CAMPOS_COMUNS.analista, coluna: 'responsavel', opcoes: 'responsaveis' },
      projeto: { rotulo: 'Projeto', tipo: 'enum', coluna: 'projeto', opcoes: 'projetos' },
      sprint: { rotulo: 'Sprint', tipo: 'enum', coluna: 'sprint', opcoes: 'sprints' },
      status: { rotulo: 'Status da tarefa', tipo: 'enum', coluna: 'status', opcoes: 'status_tarefa' },
      tipo_demanda: { rotulo: 'Tipo de demanda', tipo: 'texto', coluna: 'tipo_demanda' },
      titulo: { rotulo: 'Título da tarefa', tipo: 'texto', coluna: 'titulo' },
      esforco: { rotulo: 'Esforço (peso)', tipo: 'numero', coluna: 'esforco' },
      prazo: { rotulo: 'Prazo', tipo: 'data', coluna: 'prazo' },
      data_conclusao: { rotulo: 'Data de conclusão', tipo: 'data', coluna: 'data_conclusao' },
    },
    datas: {
      data_conclusao: { rotulo: 'Data de conclusão da tarefa', curto: 'Conclusão', coluna: 'data_conclusao' },
      prazo: { rotulo: 'Prazo da tarefa', curto: 'Prazo', coluna: 'prazo' },
      data_inicio: { rotulo: 'Data de início da tarefa', curto: 'Início', coluna: 'data_inicio' },
      atividade: { rotulo: 'Última atividade no Notion (conclusão, prazo, início ou edição)', curto: 'Atividade', coluna: 'COALESCE(data_conclusao, prazo, data_inicio, substr(last_edited,1,10))' },
    },
    data_padrao: 'atividade',
  },
  cliente: {
    rotulo: 'Painel do cliente (anúncios e vendas do Mercado Livre)', tabela: null,
    campos: {
      canal: { ...CAMPOS_COMUNS.canal },
      anuncio_id: { rotulo: 'Anúncio (MLB)', tipo: 'texto' },
      titulo: { rotulo: 'Título do anúncio', tipo: 'texto' },
      sku: { rotulo: 'SKU', tipo: 'texto' },
      status_anuncio: { rotulo: 'Status do anúncio', tipo: 'enum', opcoes: 'status_anuncio' },
      curva: { rotulo: 'Curva (A/B/C por faturamento)', tipo: 'enum', opcoes: 'curvas' },
      logistica: { rotulo: 'Logística', tipo: 'enum', opcoes: 'logistica' },
      preco: { rotulo: 'Preço (R$)', tipo: 'numero' },
      estoque: { rotulo: 'Estoque', tipo: 'numero' },
      vendas_unidades: { rotulo: 'Vendas no período (unidades)', tipo: 'numero' },
      faturamento: { rotulo: 'Faturamento no período (R$)', tipo: 'numero' },
      visitas: { rotulo: 'Visitas no período', tipo: 'numero' },
      conversao: { rotulo: 'Conversão no período (%)', tipo: 'numero' },
      ads_custo: { rotulo: 'Investimento em Ads no período (R$)', tipo: 'numero' },
      criado_em: { rotulo: 'Criação do anúncio', tipo: 'data' },
      preco_mudou: { rotulo: 'Preço mudou no período', tipo: 'bool' },                       // histórico do anúncio (meli_item_mudanca), campo preço
      variacao_preco_pct: { rotulo: 'Variação do preço no período (%)', tipo: 'numero' },     // do 1º "de" ao último "para" no período
    },
    datas: {
      data_venda: { rotulo: 'Data da venda (dia do pedido no Mercado Livre)', curto: 'Data da venda' },
      criado_em: { rotulo: 'Data de criação do anúncio', curto: 'Criação do anúncio' },
    },
    data_padrao: 'data_venda',
  },
  folha: {                                                 // Folha do anúncio (Resumo do cliente): linhas compostas em memória por lib/folha-anuncio.js; na URL vai em ?ff= (o ?f= da mesma tela é do painel 'cliente')
    rotulo: 'Folha do anúncio (Resumo do cliente)', tabela: null,
    campos: {
      curva: { rotulo: 'Curva (A/B/C por faturamento)', tipo: 'enum', opcoes: 'curvas' },
      em_promocao: { rotulo: 'Em promoção agora', tipo: 'bool', opcoes: 'sim_nao' },                              // null (—) sem coleta de promoções: nunca casa
      com_ads: { rotulo: 'Com investimento em Ads (28 dias)', tipo: 'bool', opcoes: 'sim_nao' },
      roas: { rotulo: 'ROAS de Ads (28 dias)', tipo: 'numero' },
      no_full: { rotulo: 'No Full', tipo: 'bool', opcoes: 'sim_nao' },
      risco_ruptura: { rotulo: 'Risco de ruptura (menos de 10 dias de estoque)', tipo: 'bool', opcoes: 'sim_nao' },
      tem_acao_plano: { rotulo: 'Com ação no plano', tipo: 'bool', opcoes: 'sim_nao' },
      faturamento: { rotulo: 'Faturamento no período (R$)', tipo: 'numero' },
      variacao_pct: { rotulo: 'Variação do faturamento vs período anterior (%)', tipo: 'numero' },
      conversao: { rotulo: 'Conversão no período (%)', tipo: 'numero' },
    },
    datas: { data_venda: { rotulo: 'Data da venda (dia do pedido no Mercado Livre)', curto: 'Data da venda' } },
    data_padrao: 'data_venda',
  },
  gmv: {
    rotulo: 'GMV da carteira', tabela: null,
    campos: { cliente: CAMPOS_COMUNS.cliente, canal: CAMPOS_COMUNS.canal, consultor: CAMPOS_COMUNS.consultor, analista: CAMPOS_COMUNS.analista,
      faturamento: { rotulo: 'Faturamento no período (R$)', tipo: 'numero' }, variacao_pct: { rotulo: 'Variação vs período anterior (%)', tipo: 'numero' } },
    datas: { data_venda: { rotulo: 'Data da venda (dia do pedido no Mercado Livre)', curto: 'Data da venda' } }, data_padrao: 'data_venda',
  },
  analistas: {
    rotulo: 'Analistas', tabela: 'tarefas',
    campos: { analista: { ...CAMPOS_COMUNS.analista, coluna: 'responsavel', opcoes: 'responsaveis' }, cliente: { ...CAMPOS_COMUNS.cliente, coluna: 'cliente' }, canal: { ...CAMPOS_COMUNS.canal, coluna: 'processo', opcoes: 'processos' }, status: { rotulo: 'Status da tarefa', tipo: 'enum', coluna: 'status', opcoes: 'status_tarefa' } },
    datas: {}, data_padrao: null, sem_periodo: 'As visões de Analistas usam janelas fixas (28 e 90 dias); o recorte por período não se aplica aqui.',
  },
  distribuicao: {
    rotulo: 'Distribuição (ações dos planos)', tabela: 'acoes_plano',
    campos: { cliente: { ...CAMPOS_COMUNS.cliente, coluna: 'cliente' }, canal: { ...CAMPOS_COMUNS.canal, coluna: 'canal', opcoes: 'canais_rotulo' }, consultor: { ...CAMPOS_COMUNS.consultor, coluna: 'responsavel' },
      regra: { rotulo: 'Regra do algoritmo', tipo: 'texto', coluna: 'regra' }, status: { rotulo: 'Status da ação', tipo: 'enum', coluna: 'status', opcoes: 'status_acao' }, horizonte: { rotulo: 'Horizonte', tipo: 'enum', coluna: 'horizonte', opcoes: 'horizontes' },
      prioridade: { rotulo: 'Prioridade (0–100)', tipo: 'numero', coluna: 'score' }, titulo: { rotulo: 'Título da ação', tipo: 'texto', coluna: 'titulo' }, delegado_a: { rotulo: 'Delegada a', tipo: 'texto', coluna: 'delegado_a' } },
    datas: { prazo: { rotulo: 'Prazo da ação', curto: 'Prazo', coluna: 'prazo' }, criado_em: { rotulo: 'Criação da ação', curto: 'Criação', coluna: 'substr(criado_em,1,10)' } }, data_padrao: 'prazo',
  },
  ofertas: {                                               // módulo Ofertas Estratégicas: linhas calculadas em memória (lib/ofertas-fluxo.js listaAnuncios)
    rotulo: 'Ofertas estratégicas (produtos, anúncios e jobs por cliente)', tabela: null,
    campos: {
      cliente: CAMPOS_COMUNS.cliente, canal: CAMPOS_COMUNS.canal, conta: { rotulo: 'Conta no canal', tipo: 'texto' }, consultor: CAMPOS_COMUNS.consultor, analista: CAMPOS_COMUNS.analista,
      anuncio_id: { rotulo: 'Anúncio (id no canal)', tipo: 'texto' }, sku: { rotulo: 'SKU', tipo: 'texto' }, categoria: { rotulo: 'Categoria no canal', tipo: 'texto' },
      status: { rotulo: 'Estado do job', tipo: 'enum', opcoes: 'estados_job' }, escopo: { rotulo: 'Escopo da otimização', tipo: 'enum', opcoes: 'escopos_oferta' }, prioridade: { rotulo: 'Prioridade', tipo: 'enum', opcoes: 'prioridades_oferta' },
      vendas_unidades: { rotulo: 'Vendas no período (unidades)', tipo: 'numero' }, faturamento: { rotulo: 'Faturamento no período (R$)', tipo: 'numero' }, margem_pct: { rotulo: 'Margem estimada atual (%)', tipo: 'numero' },
    },
    datas: {
      data_venda: { rotulo: 'Data da venda (dia do pedido no canal)' }, criado_em: { rotulo: 'Data de criação do anúncio' },
      otimizado_em: { rotulo: 'Data da última proposta (otimização)' }, publicado_em: { rotulo: 'Data da publicação conferida' },
    },
    data_padrao: 'data_venda',
  },
  comercial: { rotulo: 'Comercial', tabela: null, campos: { etapa: { rotulo: 'Etapa', tipo: 'enum', opcoes: 'etapas_comercial' }, origem: { rotulo: 'Origem', tipo: 'texto' }, nome: { rotulo: 'Prospect', tipo: 'texto' } }, datas: { criado_em: { rotulo: 'Cadastro do prospect', curto: 'Cadastro' } }, data_padrao: 'criado_em' },
  resultados: { rotulo: 'O que funciona', tabela: null, campos: { canal: CAMPOS_COMUNS.canal, cliente: CAMPOS_COMUNS.cliente, analista: CAMPOS_COMUNS.analista, tipo: { rotulo: 'Tipo de tarefa', tipo: 'texto' },
    produto: CAMPOS_COMUNS.produto, nicho: { rotulo: 'Nicho do cliente', tipo: 'enum', opcoes: 'nichos' }, uf: { rotulo: 'UF do vendedor (Mercado Livre)', tipo: 'enum', opcoes: 'ufs' }, regiao: { rotulo: 'Região do vendedor', tipo: 'enum', opcoes: 'regioes' } },
    datas: { data_conclusao: { rotulo: 'Data de conclusão da tarefa', curto: 'Conclusão' } }, data_padrao: 'data_conclusao' },
}

// ── período ─────────────────────────────────────────────────────────────────
const dia = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const addMeses = (iso, n) => { const d = new Date(iso + 'T12:00:00'); const dd = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + n); const ult = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); d.setDate(Math.min(dd, ult)); return d.toISOString().slice(0, 10) }
const ultimoDiaMes = iso => { const [y, m] = iso.split('-').map(Number); return dia(y, m, new Date(y, m, 0).getDate()) }
const br = iso => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—'
const diasEntre = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000) + 1
const ehISO = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && new Date(s + 'T12:00:00').toISOString().slice(0, 10) === s   // estrito: 29/02 em ano comum NÃO passa
const erro = (msg, status = 400) => Object.assign(new Error(msg), { status, filtro: true })

// resolve o preset num intervalo fechado [de, ate] e nos dois intervalos de comparação, sempre com rótulo explícito
export function resolverPeriodo({ preset = 'ultimos_90_dias', de = '', ate = '' } = {}, hoje) {
  if (!ehISO(hoje)) throw erro('hoje inválido')
  const [y, m] = hoje.split('-').map(Number)
  let r
  switch (preset) {
    case 'hoje': r = { de: hoje, ate: hoje }; break
    case 'ontem': r = { de: addDias(hoje, -1), ate: addDias(hoje, -1) }; break
    case 'este_mes': r = { de: dia(y, m, 1), ate: hoje }; break
    case 'mes_passado': { const ini = addMeses(dia(y, m, 1), -1); r = { de: ini, ate: ultimoDiaMes(ini) }; break }
    case 'este_ano': r = { de: dia(y, 1, 1), ate: hoje }; break
    case 'ano_passado': r = { de: dia(y - 1, 1, 1), ate: dia(y - 1, 12, 31) }; break
    case 'ultimos_3_meses': r = { de: addMeses(dia(y, m, 1), -2), ate: hoje }; break           // 3 meses CIVIS: do dia 1 de dois meses atrás até hoje (inclui o mês atual)
    case 'ultimos_90_dias': r = { de: addDias(hoje, -89), ate: hoje }; break                   // 90 dias corridos, hoje incluído
    case 'personalizado':
      if (!ehISO(de) || !ehISO(ate)) throw erro('período personalizado exige data inicial e final no formato AAAA-MM-DD')
      if (de > ate) throw erro('a data inicial não pode ser depois da final')
      if (diasEntre(de, ate) > 1100) throw erro('período personalizado limitado a 3 anos')
      r = { de, ate }; break
    default: throw erro('preset de período desconhecido')
  }
  const n = diasEntre(r.de, r.ate)
  const civil = ['este_mes', 'mes_passado', 'este_ano', 'ano_passado', 'ultimos_3_meses'].includes(preset)
  // período anterior: para presets civis, o mesmo recorte deslocado (mês → mês anterior; ano → ano anterior; 3 meses → os 3 meses civis antes);
  // para corridos/personalizado, o mesmo número de dias imediatamente antes
  let anterior
  if (preset === 'este_mes' || preset === 'mes_passado') { const ini = addMeses(r.de, -1); anterior = { de: ini, ate: preset === 'este_mes' ? addMeses(r.ate, -1) : ultimoDiaMes(ini) } }
  else if (preset === 'este_ano' || preset === 'ano_passado') anterior = { de: dia(Number(r.de.slice(0, 4)) - 1, 1, 1), ate: preset === 'este_ano' ? `${Number(r.ate.slice(0, 4)) - 1}${r.ate.slice(4)}` : dia(Number(r.de.slice(0, 4)) - 1, 12, 31) }
  else if (preset === 'ultimos_3_meses') anterior = { de: addMeses(r.de, -3), ate: addDias(r.de, -1) }
  else anterior = { de: addDias(r.de, -n), ate: addDias(r.de, -1) }
  const anoAnterior = { de: `${Number(r.de.slice(0, 4)) - 1}${r.de.slice(4)}`, ate: `${Number(r.ate.slice(0, 4)) - 1}${r.ate.slice(4)}` }
  for (const x of [anterior, anoAnterior]) { if (!ehISO(x.de)) x.de = addDias(x.de.slice(0, 8) + '01', 27); if (!ehISO(x.ate)) x.ate = ultimoDiaMes(x.ate.slice(0, 8) + '01') }   // 29/02 → 28/02
  const rot = x => `${br(x.de)}–${br(x.ate)}`
  return {
    preset, de: r.de, ate: r.ate, dias: n, civil,
    rotulo: `${ROTULO_PRESET[preset]}: ${rot(r)}${preset === 'ultimos_3_meses' ? ' (meses civis, inclui o mês atual)' : preset === 'ultimos_90_dias' ? ' (dias corridos)' : ''}`,
    anterior: { ...anterior, dias: diasEntre(anterior.de, anterior.ate), rotulo: `${COMPARACOES.anterior}: ${rot(anterior)}` },
    ano_anterior: { ...anoAnterior, dias: diasEntre(anoAnterior.de, anoAnterior.ate), rotulo: `${COMPARACOES.ano_anterior}: ${rot(anoAnterior)}` },
  }
}

// ── definição do filtro: { painel, arvore: { op:'E'|'OU', itens:[ condicao | arvore ] }, periodo: { campo, preset, de, ate, comparar } } ──
const MAX_CONDICOES = 30, MAX_PROFUNDIDADE = 3
const texto = v => String(v ?? '').trim().slice(0, 200)
const numero = v => { const n = Number(String(v).replace(',', '.')); if (!Number.isFinite(n)) throw erro('valor numérico inválido'); return n }
const valorDoTipo = (tipo, v) => tipo === 'numero' ? numero(v) : tipo === 'data' ? (ehISO(v) ? v : (() => { throw erro('data inválida (AAAA-MM-DD)') })()) : tipo === 'bool' ? (v === true || v === 'true' || v === 1 || v === '1' ? 1 : 0) : texto(v)

export function validar(def, { hoje } = {}) {
  if (!def || typeof def !== 'object') throw erro('filtro inválido')
  const painel = PAINEIS[def.painel]
  if (!painel) throw erro('painel desconhecido')
  let n = 0
  const arvore = (no, prof) => {
    if (prof > MAX_PROFUNDIDADE) throw erro('grupos aninhados demais (máximo 3 níveis)')
    if (!no || typeof no !== 'object') throw erro('condição inválida')
    if (Array.isArray(no.itens)) {
      const op = no.op === 'OU' ? 'OU' : 'E'
      const itens = no.itens.map(x => arvore(x, prof + 1)).filter(Boolean)
      return itens.length ? { op, itens } : null
    }
    if (++n > MAX_CONDICOES) throw erro(`no máximo ${MAX_CONDICOES} condições`)
    const campo = painel.campos[no.campo]
    if (!campo || !Object.hasOwn(painel.campos, no.campo)) throw erro('campo desconhecido para este painel')
    const op = OPERADORES[no.operador]
    if (!op || !Object.hasOwn(OPERADORES, no.operador)) throw erro('operador desconhecido')
    if (!op.tipos.includes(campo.tipo)) throw erro(`o operador "${op.rotulo}" não vale para ${campo.rotulo}`)
    let valor = null
    if (op.arid === 1) valor = valorDoTipo(campo.tipo, no.valor)
    else if (op.arid === 2) { const v = Array.isArray(no.valor) ? no.valor : []; if (v.length !== 2) throw erro('"está entre" exige dois valores'); valor = v.map(x => valorDoTipo(campo.tipo, x)); if (valor[0] > valor[1]) valor = [valor[1], valor[0]] }
    else if (op.arid === 'lista') { const v = Array.isArray(no.valor) ? no.valor : String(no.valor ?? '').split(','); valor = [...new Set(v.map(x => texto(x)).filter(Boolean))].slice(0, 100); if (!valor.length) throw erro('"é um de" exige ao menos um valor') }
    if (op.arid === 1 && campo.tipo !== 'numero' && campo.tipo !== 'bool' && valor === '') throw erro(`informe um valor para ${campo.rotulo}`)
    return { campo: no.campo, operador: no.operador, valor }
  }
  const raiz = def.arvore ? arvore(def.arvore, 1) : null
  let periodo = null
  if (def.periodo && typeof def.periodo === 'object' && Object.keys(painel.datas).length) {
    const campo = def.periodo.campo && Object.hasOwn(painel.datas, def.periodo.campo) ? def.periodo.campo : painel.data_padrao
    const preset = PRESETS.includes(def.periodo.preset) ? def.periodo.preset : null
    if (!preset) throw erro('preset de período desconhecido')
    const comparar = def.periodo.comparar && Object.hasOwn(COMPARACOES, def.periodo.comparar) ? def.periodo.comparar : null
    periodo = { campo, preset, de: preset === 'personalizado' ? texto(def.periodo.de) : '', ate: preset === 'personalizado' ? texto(def.periodo.ate) : '', comparar }
    if (hoje) periodo.resolvido = resolverPeriodo(periodo, hoje)
  }
  return { painel: def.painel, arvore: raiz, periodo }
}

// ── compilador SQL: só colunas da definição (lista fechada), tudo parametrizado; LIKE com escape ──
const escLike = s => String(s).replace(/[\\%_]/g, c => '\\' + c)
export function compilarSQL(def, { colunaExtra = {} } = {}) {
  const painel = PAINEIS[def.painel]
  const cond = [], args = []
  const col = campo => painel.campos[campo]?.coluna || colunaExtra[campo] || null
  const no = n => {
    if (n.itens) { const partes = n.itens.map(no).filter(Boolean); return partes.length ? '(' + partes.join(n.op === 'OU' ? ' OR ' : ' AND ') + ')' : null }
    const c = col(n.campo)
    if (!c) throw erro(`o campo "${n.campo}" não pode ser filtrado direto no banco`)
    const tipo = painel.campos[n.campo].tipo
    const numCol = tipo === 'numero' ? `CAST(${c} AS REAL)` : c
    switch (n.operador) {
      case 'igual': args.push(n.valor); return `${numCol} = ?`
      case 'diferente': args.push(n.valor); return `(${numCol} IS NULL OR ${numCol} != ?)`
      case 'em': args.push(...n.valor); return `${c} IN (${n.valor.map(() => '?').join(',')})`
      case 'contem': args.push(`%${escLike(n.valor)}%`); return `${c} LIKE ? ESCAPE '\\'`
      case 'nao_contem': args.push(`%${escLike(n.valor)}%`); return `(${c} IS NULL OR ${c} NOT LIKE ? ESCAPE '\\')`
      case 'maior': args.push(n.valor); return `${numCol} > ?`
      case 'menor': args.push(n.valor); return `${numCol} < ?`
      case 'entre': args.push(n.valor[0], n.valor[1]); return `${numCol} BETWEEN ? AND ?`
      case 'vazio': return `(${c} IS NULL OR ${c} = '')`
      case 'nao_vazio': return `(${c} IS NOT NULL AND ${c} != '')`
      default: throw erro('operador desconhecido')
    }
  }
  if (def.arvore) { const w = no(def.arvore); if (w) cond.push(w) }
  if (def.periodo?.resolvido) {
    const dc = painel.datas[def.periodo.campo]?.coluna
    if (!dc) throw erro('a data escolhida não pode ser filtrada direto no banco')
    cond.push(`${dc} >= ?`, `${dc} <= ?`); args.push(def.periodo.resolvido.de, def.periodo.resolvido.ate)
  }
  return { where: cond.length ? cond.join(' AND ') : '1=1', args }
}

// ── compilador para memória: avalia a árvore sobre um objeto (campo → valor via acessor) ──
export function compilarPredicado(def, acessor = (obj, campo) => obj[campo]) {
  const painel = PAINEIS[def.painel]
  const normT = v => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const no = n => {
    if (n.itens) { const fs = n.itens.map(no); return n.op === 'OU' ? o => fs.some(f => f(o)) : o => fs.every(f => f(o)) }
    const tipo = painel.campos[n.campo].tipo, v = n.valor
    const get = o => acessor(o, n.campo)
    const vazio = x => x == null || x === ''
    const cmp = tipo === 'numero' ? (a => Number(a)) : tipo === 'texto' || tipo === 'enum' ? normT : (a => String(a ?? ''))
    switch (n.operador) {
      case 'igual': return o => !vazio(get(o)) && cmp(get(o)) === cmp(v)
      case 'diferente': return o => vazio(get(o)) || cmp(get(o)) !== cmp(v)
      case 'em': { const s = new Set(v.map(normT)); return o => s.has(normT(get(o))) }
      case 'contem': return o => normT(get(o)).includes(normT(v))
      case 'nao_contem': return o => !normT(get(o)).includes(normT(v))
      case 'maior': return o => !vazio(get(o)) && cmp(get(o)) > cmp(v)
      case 'menor': return o => !vazio(get(o)) && cmp(get(o)) < cmp(v)
      case 'entre': return o => !vazio(get(o)) && cmp(get(o)) >= cmp(v[0]) && cmp(get(o)) <= cmp(v[1])
      case 'vazio': return o => vazio(get(o))
      case 'nao_vazio': return o => !vazio(get(o))
      default: return () => false
    }
  }
  return def.arvore ? no(def.arvore) : () => true
}

// "consultor" não é coluna de tarefa: vira "cliente é um de [clientes daquele consultor]" (expansão antes do SQL)
export function expandir(def, resolvedores = {}) {
  const painel = PAINEIS[def.painel]
  const no = n => {
    if (n.itens) return { ...n, itens: n.itens.map(no) }
    const campo = painel.campos[n.campo]
    if (!campo?.expande || !resolvedores[campo.expande]) return n
    const lista = resolvedores[campo.expande](n)            // devolve a lista de clientes (ou null para "não dá para expandir")
    if (!lista) return n
    if (n.operador === 'igual' || n.operador === 'em' || n.operador === 'contem') return { campo: 'cliente', operador: 'em', valor: lista.length ? lista : ['__nenhum__'] }
    if (n.operador === 'diferente' || n.operador === 'nao_contem') return { op: 'E', itens: lista.map(c => ({ campo: 'cliente', operador: 'diferente', valor: c })) }
    return n
  }
  return def.arvore ? { ...def, arvore: no(def.arvore) } : def
}

// ── chips (o que está aplicado, legível) ───────────────────────────────────
export function chips(def) {
  const painel = PAINEIS[def.painel], out = []
  const fmt = (campo, v) => campo.tipo === 'data' ? br(v) : campo.tipo === 'numero' ? Number(v).toLocaleString('pt-BR') : rotuloValor(campo, v)
  const no = (n, caminho) => {
    if (n.itens) { n.itens.forEach((x, i) => no(x, [...caminho, i])); return }
    const campo = painel.campos[n.campo], op = OPERADORES[n.operador]
    const val = op.arid === 0 ? '' : op.arid === 2 ? ` ${fmt(campo, n.valor[0])} e ${fmt(campo, n.valor[1])}` : op.arid === 'lista' ? ' ' + n.valor.map(v => fmt(campo, v)).join(', ') : ' ' + fmt(campo, n.valor)
    out.push({ caminho, texto: `${campo.rotulo} ${op.rotulo}${val}`, detalhe: `${campo.rotulo} ${op.rotulo}${val}` })
  }
  if (def.arvore) no(def.arvore, [])
  if (def.periodo) {
    const r = def.periodo.resolvido
    const d = painel.datas[def.periodo.campo] || {}
    const curto = x => `${br(x.de).slice(0, 5)}–${br(x.ate)}`                 // 01/08–07/10/2026: cabe no chip; o detalhe completo vai no title
    out.push({ caminho: 'periodo', texto: `${d.curto || d.rotulo || def.periodo.campo} · ${ROTULO_PRESET[def.periodo.preset]}${r ? ' ' + curto(r) : ''}`, detalhe: `${d.rotulo || def.periodo.campo} · ${r ? r.rotulo : ROTULO_PRESET[def.periodo.preset]}` })
    if (def.periodo.comparar && r) out.push({ caminho: 'comparar', texto: `${COMPARACOES[def.periodo.comparar]} ${curto(r[def.periodo.comparar])}`, detalhe: r[def.periodo.comparar].rotulo })
  }
  return out
}
// remove uma condição pelo caminho (índices na árvore) ou o período/comparação
export function removerCondicao(def, caminho) {
  if (caminho === 'periodo') return { ...def, periodo: null }
  if (caminho === 'comparar') return { ...def, periodo: def.periodo ? { ...def.periodo, comparar: null } : null }
  const poda = (n, c) => {
    if (!c.length) return null
    const itens = n.itens.map((x, i) => i === c[0] ? (c.length === 1 ? null : poda(x, c.slice(1))) : x).filter(Boolean)
    return itens.length ? { ...n, itens } : null
  }
  return { ...def, arvore: def.arvore ? poda(def.arvore, caminho) : null }
}

// ── URL: ?f=<base64url do JSON> — curto, copiável, e vale para exportações ──
export const serializar = def => Buffer.from(JSON.stringify({ p: def.painel, a: def.arvore, t: def.periodo ? { c: def.periodo.campo, s: def.periodo.preset, d: def.periodo.de, a: def.periodo.ate, x: def.periodo.comparar } : null })).toString('base64url')
export function desserializar(str, { painel, hoje } = {}) {
  if (!str) return null
  let j
  try { j = JSON.parse(Buffer.from(String(str).slice(0, 8000), 'base64url').toString('utf8')) } catch { throw erro('filtro da URL ilegível') }
  const def = { painel: painel || j.p, arvore: j.a || null, periodo: j.t ? { campo: j.t.c, preset: j.t.s, de: j.t.d, ate: j.t.a, comparar: j.t.x } : null }
  if (painel && j.p && j.p !== painel) throw erro('o filtro da URL é de outro painel')
  return validar(def, { hoje })
}

// ── filtros salvos (favoritos) ─────────────────────────────────────────────
export const SCHEMA_FILTROS = `CREATE TABLE IF NOT EXISTS filtros_salvos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, painel TEXT NOT NULL, nome TEXT NOT NULL, definicao_json TEXT NOT NULL,
  por TEXT NOT NULL DEFAULT '', criado_em TEXT NOT NULL, usado_em TEXT NOT NULL DEFAULT '',
  UNIQUE (painel, nome)
)`
export function criarFiltrosSalvos(h) {
  const agora = () => new Date().toISOString()
  return {
    listar(painel) {
      if (!PAINEIS[painel]) throw erro('painel desconhecido')
      return h.prepare('SELECT id, painel, nome, definicao_json, por, criado_em, usado_em FROM filtros_salvos WHERE painel = ? ORDER BY usado_em DESC, nome').all(painel)
        .map(r => ({ id: r.id, painel: r.painel, nome: r.nome, por: r.por, criado_em: r.criado_em, usado_em: r.usado_em, definicao: JSON.parse(r.definicao_json) }))
    },
    salvar({ painel, nome, definicao, por }) {
      const n = texto(nome).slice(0, 60)
      if (!n) throw erro('dê um nome ao filtro')
      if (!texto(por)) throw erro('informe "por" (seu nome)')
      const def = validar({ ...definicao, painel })
      if (!def.arvore && !def.periodo) throw erro('o filtro está vazio')
      const r = h.prepare(`INSERT INTO filtros_salvos (painel, nome, definicao_json, por, criado_em) VALUES (?,?,?,?,?)
        ON CONFLICT(painel, nome) DO UPDATE SET definicao_json = excluded.definicao_json, por = excluded.por, criado_em = excluded.criado_em`).run(painel, n, JSON.stringify({ arvore: def.arvore, periodo: def.periodo && { campo: def.periodo.campo, preset: def.periodo.preset, de: def.periodo.de, ate: def.periodo.ate, comparar: def.periodo.comparar } }), texto(por).slice(0, 80), agora())
      return { id: r.lastInsertRowid, painel, nome: n }
    },
    usar(id) { h.prepare('UPDATE filtros_salvos SET usado_em = ? WHERE id = ?').run(agora(), Number(id)) },
    remover(id, painel) { return h.prepare('DELETE FROM filtros_salvos WHERE id = ? AND painel = ?').run(Number(id), painel).changes },
  }
}

// o que a tela precisa para montar o construtor: campos, operadores válidos por campo, datas e presets
export function definicao(painel) {
  const p = PAINEIS[painel]
  if (!p) throw erro('painel desconhecido')
  return {
    painel, rotulo: p.rotulo,
    campos: Object.entries(p.campos).map(([id, c]) => ({ id, rotulo: c.rotulo, tipo: c.tipo, opcoes: c.opcoes || null, rotulos: (c.opcoes && ROTULOS[c.opcoes]) || null, operadores: Object.entries(OPERADORES).filter(([, o]) => o.tipos.includes(c.tipo)).map(([k, o]) => ({ id: k, rotulo: o.rotulo, arid: o.arid })) })),
    datas: Object.entries(p.datas).map(([id, d]) => ({ id, rotulo: d.rotulo, curto: d.curto || d.rotulo })), data_padrao: p.data_padrao, sem_periodo: p.sem_periodo || null,
    presets: PRESETS.map(id => ({ id, rotulo: ROTULO_PRESET[id] })), comparacoes: Object.entries(COMPARACOES).map(([id, rotulo]) => ({ id, rotulo })),
  }
}
