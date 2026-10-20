// Motor do Plano de Ação por cliente (roteiro do estrategista Place2u — config/prompt-estrategista.md).
// Regra de ouro herdada do roteiro: NÃO inventar número, separar fato × hipótese × projeção × pendente,
// e dizer o que falta. Aqui o diagnóstico usa o que existe (Notion + API do Mercado Livre quando conectada);
// vendas por SKU, Ads, estoque e margem viram PENDÊNCIA de dados, não ação nem palpite.
// 100% determinístico (zero token de IA). Limiares e textos: config/playbook.json.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { db, agora, hojeLocal, getEstado } from './db.js'
import { ROOT, env } from './env.js'
import { carregarClientes, CANAIS, normNome, validarLiderOuConsultor } from './equipe.js'
import { planosDoMes, sincronizarPlanos } from './plano-informacoes.js'
import { planoDoMes } from './metricas.js'
import { statusConexao } from './meli-contas.js'
import { comComparativo, relatorioNegocio } from './meli-api.js'
import { notionReq } from './notion.js'
import { mapeamento } from './extrair.js'
import { criarDependencias } from './dependencia-cliente.js'
import { ehAberta } from './status-tarefa.js'
import { pendenciasReal } from './pendencias-cliente-real.js'
import { alinhamentosReal } from './alinhamentos-real.js'

export const playbook = JSON.parse(readFileSync(join(ROOT, 'config', 'playbook.json'), 'utf-8'))
const DESDE = JSON.parse(readFileSync(join(ROOT, 'config', 'fontes.json'), 'utf-8')).sync_inicial_desde || '2026-06-01'
const PB = playbook, L = PB.limiares

// dependência do cliente (status dependencia_cliente): o núcleo não importa banco, então a fiação de LEITURA fica aqui
// (mesma fábrica do server.js, que monta a rota de escrita). Usado pelo contexto do plano, pelo Merovíngio e pelo aprendizado.
const nucleoDependencias = criarDependencias({ handle: db, notion: { req: notionReq }, agora, hoje: hojeLocal, validarPor: validarLiderOuConsultor, mapeamento,
  limiares: { atencao: L.dependencia_atencao_dias, revisar: L.dias_parada } })
export function dependenciasDe(cliente, hoje) {
  const todas = nucleoDependencias.listar({ cliente, hoje })
  return { todas, vencidas: todas.filter(d => d.dias >= L.dependencia_atencao_dias) }   // vencida = aguarda o cliente há 14+ dias (régua do playbook)
}

const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
export const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const diasEntre = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000)
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const rotuloMes = ym => `${MESES[Number(ym.slice(5, 7)) - 1]}/${ym.slice(0, 4)}`
const brData = iso => iso ? iso.split('-').reverse().join('/') : '—'
const pct1 = n => Math.round(n * 10) / 10
const fmtMoeda = v => 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const atividade = t => (t.last_edited || '').slice(0, 10)
const entregaEm = t => t.status === 'concluida' ? (t.data_conclusao || atividade(t) || null) : null

// ── contexto do cliente (tudo vem do banco local — sem chamar API) ─────────
function contexto(cli, hoje) {
  const tarefas = db.prepare("SELECT * FROM tarefas WHERE arquivada = 0 AND cliente = ? AND titulo NOT LIKE '%· PS-%'").all(cli.cliente)
  const abertas = tarefas.filter(ehAberta)
  const entregas = tarefas.map(t => entregaEm(t)).filter(Boolean).sort()
  const ultimaEntrega = entregas.at(-1) || null
  const noIntervalo = (a, b) => entregas.filter(d => d >= a && d <= b).length
  const limParada = addDias(hoje, -L.dias_parada)
  const idade = t => atividade(t) ? diasEntre(atividade(t), hoje) : 0
  const bloqueadas = abertas.filter(t => t.status === 'bloqueada')          // só impedimento interno: dependência do cliente não é aberta
  const { todas: dependencias, vencidas: dependenciasVencidas } = dependenciasDe(cli.cliente, hoje)
  const janela = addDias(hoje, -L.janela_alavanca_dias)
  const recentes = tarefas.filter(t => atividade(t) >= janela)
  const alavancas = {}
  for (const [k, a] of Object.entries(PB.alavancas)) {
    if (k.startsWith('$')) continue
    const rx = new RegExp(a.padroes.join('|'))
    alavancas[k] = recentes.filter(t => rx.test(semAcento(`${t.titulo} ${t.tipo_demanda}`))).length
  }
  const concluidas = tarefas.filter(t => t.status === 'concluida')
  const semDataConclusao = concluidas.filter(t => !t.data_conclusao).length
  return {
    tarefas, abertas, bloqueadas, dependencias, dependenciasVencidas, ultimaEntrega,
    concluidas: concluidas.length, semDataConclusao,
    entregaEstimada: concluidas.length ? semDataConclusao / concluidas.length : 0,
    c28: noIntervalo(addDias(hoje, -27), hoje), p28: noIntervalo(addDias(hoje, -55), addDias(hoje, -28)),
    paradas: abertas.filter(t => atividade(t) && atividade(t) < limParada && t.status !== 'bloqueada'),
    semResponsavel: abertas.filter(t => !t.responsavel), semPrazo: abertas.filter(t => !t.prazo).length,
    atividadeRecente: recentes.length, alavancas, idade,
    comTipoDemanda: tarefas.filter(t => t.tipo_demanda).length,
  }
}

// ── construtor de ação: ID estável, score explicável, responsável/squad ────
// ID estável pela CONDIÇÃO (cliente|regra|alvo) — o mês NÃO entra: a mesma pendência no mês
// seguinte é a MESMA ação (não duplica tarefa no Notion nem perde decisão aprovada/descartada).
// Regras mensais passam o mês no alvo; calendário passa a data do evento. 10 hex = 40 bits (PK global).
export const idAcao = (cliente, regra, alvo) => 'PS-' + createHash('sha1').update([cliente, regra, alvo || ''].join('|')).digest('hex').slice(0, 10)
function acao(cli, hoje, d) {
  const mes = hoje.slice(0, 7)
  const id = idAcao(cli.cliente, d.regra, d.alvo)
  const confianca = PB.confianca[d.tipo]
  const score = Math.round((d.impacto * confianca * d.urgencia / d.esforco) / 125 * 100)
  const canalK = d.canalK || ''
  const responsavel = (canalK ? cli.responsavelDoCanal(canalK) : cli.principal) || ''
  const squad = (canalK ? cli.squadDoCanal(canalK) : '') || cli.squadPrincipal || ''
  return {
    id, cliente: cli.cliente, canal: canalK ? CANAIS[canalK] : '', canalK, regra: d.regra, mes, titulo: d.titulo,
    horizonte: d.horizonte, prazo: d.prazo || addDias(hoje, PB.horizontes[d.horizonte]), responsavel, squad, score,
    dados: {
      dimensao: d.dimensao, problema: d.problema, acao: d.acaoTexto, evidencia_tipo: d.tipo, evidencia: d.evidencia,
      fonte: d.fonte, periodo: d.periodo, dependencia: d.dependencia, indicador_inicial: d.indicador, meta: d.meta,
      criterio_aceite: d.aceite, impacto: d.impacto, confianca, urgencia: d.urgencia, esforco: d.esforco,
      logica: `Impacto ${d.impacto}/5 × confiança ${confianca}/5 (${d.tipo}) × urgência ${d.urgencia}/5 ÷ esforço ${d.esforco}/5 = ${score}/100`,
      demanda_notion: d.demanda || '', refs: d.refs || [],
    },
  }
}

const refsDe = ts => ts.slice(0, 8).map(t => ({ titulo: t.titulo, url: t.url }))
const K_DO_PROCESSO = Object.fromEntries(Object.entries(CANAIS).map(([k, v]) => [v, k]))
const canalDominante = ts => {
  const f = {}
  for (const t of ts) { const k = K_DO_PROCESSO[t.processo]; if (k) f[k] = (f[k] || 0) + 1 }
  return Object.entries(f).sort((a, b) => b[1] - a[1])[0]?.[0] || ''
}
const listaTitulos = ts => ts.slice(0, 5).map(t => `"${t.titulo}"`).join('; ') + (ts.length > 5 ? ` e mais ${ts.length - 5}` : '')

// pendência do cliente → canal/dimensão da ação (Magalu e "geral" não têm chave em CANAIS: ação sem canal)
const CANAL_K_PEND = { ml: 'ML', shopee: 'SHO', amazon: 'AMZ', tiktok: 'TTK' }
const DIM_PEND = { estoque_curva_a: 'Estoque e logística', remessa_fba_full: 'Estoque e logística', despacho_prazo: 'Estoque e logística', preco_custo: 'Rentabilidade' }
// ── regras (cada uma: evidência → ação) ────────────────────────────────────
function regras(cli, ctx, hoje, extra) {
  const out = [], A = d => out.push(acao(cli, hoje, d))
  const FONTE_N = 'Notion — tarefas do cliente', POS = `posição em ${brData(hoje)}`
  const { ml, planoStatus } = extra

  // 1. bloqueio interno ("Bloqueada" / "Problemas na tarefa") — o que depende do cliente é a regra 1b
  if (ctx.bloqueadas.length) {
    const n = ctx.bloqueadas.length, maisAntiga = Math.max(...ctx.bloqueadas.map(ctx.idade))
    const porStatus = {}
    for (const t of ctx.bloqueadas) porStatus[t.status_raw || 'Bloqueada'] = (porStatus[t.status_raw || 'Bloqueada'] || 0) + 1
    A({ regra: 'bloqueio_interno', titulo: `Destravar ${n} tarefa(s) com impedimento interno`, horizonte: '72h', canalK: canalDominante(ctx.bloqueadas),
      dimensao: 'Qualidade operacional', problema: `${n} tarefa(s) abertas estão travadas por impedimento interno`,
      acaoTexto: `Para cada tarefa, confirmar o que falta, quem entrega e até quando; destravar ou replanejar/cancelar. Tarefas: ${listaTitulos(ctx.bloqueadas)}.`,
      tipo: 'fato', evidencia: `${n} tarefa(s) travadas — ${Object.entries(porStatus).map(([k, v]) => `${v}× "${k}"`).join(', ')}; a mais antiga sem edição há ${maisAntiga} dia(s).`,
      fonte: FONTE_N, periodo: POS, dependencia: 'Destrave interno', indicador: `${n} tarefa(s) bloqueadas`,
      meta: '0 tarefas bloqueadas sem plano de destrave datado', aceite: 'Cada tarefa bloqueada com causa, responsável pelo destrave e nova data registrados no card',
      impacto: 4, urgencia: maisAntiga >= 14 ? 5 : 4, esforco: 2, refs: refsDe(ctx.bloqueadas) })
  }

  // 1b. dependência do cliente vencida (14+ dias): a cobrança é do consultor — mesmo id de antes, não duplica ação
  if (ctx.dependenciasVencidas.length) {
    const v = ctx.dependenciasVencidas, n = v.length, maisAntiga = Math.max(...v.map(d => d.dias)), D = L.dependencia_atencao_dias
    const porTipo = {}
    for (const d of v) { const k = d.tipo_rotulo || 'sem motivo registrado'; porTipo[k] = (porTipo[k] || 0) + 1 }
    const tipos = Object.entries(porTipo).sort((a, b) => b[1] - a[1]).map(([k, c]) => `${c}× ${k}`).join(', ')
    A({ regra: 'bloqueio_cliente', titulo: `Cobrar o cliente: ${n} tarefa(s) aguardam retorno há ${D}+ dias (${tipos})`, horizonte: '72h', canalK: canalDominante(v),
      dimensao: 'Qualidade operacional', problema: 'A entrega não depende da equipe: falta informação ou decisão do cliente',
      acaoTexto: `Para cada tarefa, o consultor envia ao cliente o que falta, combina data de retorno e registra no card; com ${L.dias_parada}+ dias, decidir com o cliente: manter, replanejar ou cancelar. O contato é do consultor — o sistema não envia mensagens. Tarefas: ${listaTitulos(v)}.`,
      tipo: 'fato', evidencia: `${n} tarefa(s) aguardam retorno do cliente há ${D}+ dias (a mais antiga: ${maisAntiga} dias); ${ctx.dependencias.length} em dependência do cliente no total.`,
      fonte: FONTE_N, periodo: POS, dependencia: 'Retorno do cliente', indicador: `${n} aguardando o cliente há ${D}+ dias`,
      meta: `0 tarefas aguardando o cliente há ${D}+ dias sem data combinada`, aceite: 'Cada tarefa com o pedido enviado ao cliente e a data de retorno registrada no card',
      impacto: 3, urgencia: maisAntiga >= L.dias_parada ? 5 : 4, esforco: 1, refs: refsDe(v) })
  }

  // 1c. pendência do cliente MEDIDA ou REGISTRADA (08/10): uma ação por pendência do avaliador único (src/lib/pendencias-cliente.js), no máximo 5 por cliente
  // (o avaliador já ordena por gravidade e impacto). Tarefa parada em dependência fica SÓ na 1b (não duplica); leitura medida de gravidade 'info' (pouca mídia) fica só no Resumo. R$ só como texto da evidência, quando o avaliador mede/prevê.
  // (custo não informado medido já tem a ação `cadastrar_custos` do plano por anúncio: não duplica aqui)
  for (const p of (extra.pendCliente || []).filter(x => x.fonte !== 'tarefa' && !(x.fonte === 'medido' && x.gravidade === 'info') && !(x.fonte === 'medido' && x.item === 'preco_custo')).slice(0, 5)) {
    const imp = { critico: 4, atencao: 3, info: 2 }[p.gravidade] ?? 2, urg = { critico: 5, atencao: 4, info: 3 }[p.gravidade] ?? 3
    const comValor = p.impacto.tipo !== 'sem_estimativa'
    A({ regra: 'pendencia_cliente', alvo: p.id, titulo: `Cobrar o cliente: ${p.rotulo}${p.canal === 'geral' ? '' : ` (${p.canal_rotulo})`}`, horizonte: '72h', canalK: CANAL_K_PEND[p.canal] || '',
      dimensao: DIM_PEND[p.item] || 'Qualidade operacional', problema: p.por_que_importa,
      acaoTexto: `Combinar com o cliente o que falta e registrar o retorno. ${p.o_que_precisamos} Ao receber: ${p.o_que_fazemos} O contato é do consultor — o sistema não envia mensagens.`,
      tipo: p.fonte === 'medido' ? 'fato' : 'hipotese',
      evidencia: `${p.evidencia} ${comValor ? `${p.impacto.rotulo}. Premissa: ${p.impacto.premissa}` : `${p.impacto.rotulo}.`}${p.fonte === 'registro' ? ' Informado pela equipe; o sistema não confirma.' : ''}`,
      fonte: p.fonte === 'medido' ? 'Place Sprints — dados do canal (leitura local)' : 'Place Sprints — registro da equipe', periodo: POS, dependencia: 'Retorno do cliente',
      indicador: `${p.rotulo}: pendente`, meta: 'Pendência resolvida e retorno do cliente registrado', aceite: 'Retorno do cliente recebido e registrado no card, ou pendência marcada como resolvida',
      impacto: imp, urgencia: urg, esforco: 1 })
  }

  // 2. cadência de entregas
  const diasSemEntrega = ctx.ultimaEntrega ? diasEntre(ctx.ultimaEntrega, hoje) : null
  const semEntrega = ctx.abertas.length > 0 && (diasSemEntrega === null || diasSemEntrega >= L.dias_sem_entrega)
  if (semEntrega) {
    A({ regra: 'sem_entrega', titulo: diasSemEntrega === null ? 'Retomar cadência: nenhuma entrega concluída registrada' : `Retomar cadência: sem entrega concluída há ${diasSemEntrega} dias`, horizonte: '72h',
      dimensao: 'Qualidade operacional', problema: 'Um ciclo quinzenal inteiro sem execução — sem execução não há resultado, e cliente sem resultado raramente renova (playbook da consultoria, §10/§12)',
      acaoTexto: `Seguir o protocolo de acompanhamento do playbook (mensagem nos dias 3–5; nos dias 7–8 verificar o Notion e acionar pelo WhatsApp para entender o motivo — o contato é do consultor, o sistema não envia mensagens). Escolher 1–2 entregas de maior impacto, concluí-las nesta quinzena e registrar o resultado no card.`,
      tipo: ctx.entregaEstimada > 0.3 ? 'hipotese' : 'fato',
      evidencia: (diasSemEntrega === null ? `Nenhuma tarefa concluída desde o início da base sincronizada (${brData(DESDE)}); ${ctx.abertas.length} aberta(s).` : `Última entrega concluída em ${brData(ctx.ultimaEntrega)} (${diasSemEntrega} dias); ${ctx.abertas.length} tarefa(s) aberta(s).`) +
        (ctx.entregaEstimada > 0.3 ? ` Atenção: ${ctx.semDataConclusao} de ${ctx.concluidas} concluída(s) sem o campo "Concluído em" — datas estimadas pela última edição do card.` : ''),
      fonte: FONTE_N, periodo: POS, dependencia: 'Capacidade do responsável', indicador: `${ctx.c28} entrega(s) nos últimos 28 dias`,
      meta: 'Pelo menos 1 entrega concluída em 7 dias (meta operacional sugerida, ajustável)', aceite: '1 entrega concluída e registrada com evidência no card',
      impacto: diasSemEntrega === null || diasSemEntrega >= 28 ? 5 : 4, urgencia: 5, esforco: 2 })
  } else if (ctx.p28 >= L.queda_cadencia_base_minima && ctx.c28 <= ctx.p28 * (1 - L.queda_cadencia_pct / 100)) {
    A({ regra: 'queda_cadencia', titulo: `Investigar queda de cadência: ${ctx.c28} entregas em 28 dias vs ${ctx.p28} nos 28 anteriores`, horizonte: '7d',
      dimensao: 'Qualidade operacional', problema: 'O ritmo de entregas caiu de forma relevante',
      acaoTexto: 'Comparar os dois períodos por tipo de tarefa e responsável; identificar se a queda vem de bloqueio, mudança de prioridade, capacidade ou ausência de plano. Hipótese a testar — não tratar como causa comprovada.',
      tipo: 'hipotese', evidencia: `Entregas concluídas: ${ctx.c28} nos últimos 28 dias vs ${ctx.p28} nos 28 anteriores (−${Math.round((1 - ctx.c28 / ctx.p28) * 100)}%, períodos completos e equivalentes).` +
        (ctx.entregaEstimada > 0.3 ? ` Atenção: ${ctx.semDataConclusao} de ${ctx.concluidas} concluída(s) sem o campo "Concluído em" — datas estimadas pela última edição do card.` : ''),
      fonte: FONTE_N, periodo: `${brData(addDias(hoje, -55))} a ${brData(hoje)}`, dependencia: '—', indicador: `${ctx.c28} entregas/28 dias`,
      meta: 'Causa da queda identificada e plano de recuperação registrado', aceite: 'Causa (ou hipótese a testar) documentada com responsável e data',
      impacto: 3, urgencia: 3, esforco: 2 })
  }

  // 3. backlog parado
  if (ctx.paradas.length >= L.min_paradas) {
    const maisAntiga = Math.max(...ctx.paradas.map(ctx.idade))
    A({ regra: 'backlog_parado', titulo: `Revisar ${ctx.paradas.length} tarefas abertas paradas há ${L.dias_parada}+ dias`, horizonte: '7d', canalK: canalDominante(ctx.paradas),
      dimensao: 'Qualidade operacional', problema: 'Tarefas abertas sem movimento ocupam a fila de trabalho e escondem o que é prioridade',
      acaoTexto: `Para cada tarefa decidir: executar agora, reprogramar com data ou cancelar com ciência do cliente. Tarefas: ${listaTitulos(ctx.paradas)}.`,
      tipo: 'fato', evidencia: `${ctx.paradas.length} tarefa(s) abertas sem nenhuma edição há ${L.dias_parada}+ dias (a mais antiga: ${maisAntiga} dias).`,
      fonte: FONTE_N, periodo: POS, dependencia: '—', indicador: `${ctx.paradas.length} tarefa(s) paradas`,
      meta: '0 tarefas paradas sem decisão', aceite: 'Cada tarefa executada, reprogramada com data ou cancelada',
      impacto: 3, urgencia: 3, esforco: 2, refs: refsDe(ctx.paradas) })
  }

  // 4. tarefas sem dono
  if (ctx.semResponsavel.length) {
    A({ regra: 'sem_responsavel', titulo: `Atribuir responsável a ${ctx.semResponsavel.length} tarefa(s) abertas sem dono`, horizonte: '72h', canalK: canalDominante(ctx.semResponsavel),
      dimensao: 'Qualidade operacional', problema: 'Tarefa sem responsável não tem quem a mova',
      acaoTexto: `Definir responsável para cada tarefa: ${listaTitulos(ctx.semResponsavel)}.`,
      tipo: 'fato', evidencia: `${ctx.semResponsavel.length} de ${ctx.abertas.length} tarefa(s) abertas sem responsável.`,
      fonte: FONTE_N, periodo: POS, dependencia: '—', indicador: `${ctx.semResponsavel.length} sem responsável`,
      meta: '0 tarefas abertas sem responsável', aceite: 'Todas as tarefas abertas com responsável',
      impacto: 3, urgencia: 4, esforco: 1, refs: refsDe(ctx.semResponsavel) })
  }

  // 5. plano do mês (a existência vem da base "Informações" do cliente)
  const mes = hoje.slice(0, 7), dia = Number(hoje.slice(8, 10))
  const planos = planosDoMes(cli.cliente, mes)
  const semBase = planoStatus && planoStatus.ok === false && /Informa/.test(planoStatus.motivo || '')
  const consultaOk = semBase || planoStatus?.ok === true
  if (!planos.length) {
    A({ regra: 'sem_plano_mes', alvo: mes, titulo: `Montar o plano de ação de ${rotuloMes(mes)}`, horizonte: dia <= 7 ? '7d' : '72h',
      dimensao: 'Qualidade operacional', problema: `Não há plano de ação de ${rotuloMes(mes)} registrado para o cliente`,
      acaoTexto: semBase
        ? 'Criar a base "Informações" na página do cliente (modelo dos demais) e registrar o plano do mês por canal (5W2H: o quê, por quê, onde, quando, quem, como). Usar as ações propostas neste plano como ponto de partida.'
        : 'Registrar o plano do mês por canal na base "Informações" (5W2H: o quê, por quê, onde, quando, quem, como), usando as ações propostas neste plano como ponto de partida.',
      tipo: consultaOk ? 'fato' : 'pendente',
      evidencia: semBase ? 'A página do cliente não tem a base "Informações".'
        : consultaOk ? `Nenhuma linha de plano de ${rotuloMes(mes)} na base "Informações" (consulta à página do cliente em ${brData(hoje)}). Se já existir, descartar esta ação.`
        : `Nenhuma linha de ${rotuloMes(mes)} na cópia local, mas a consulta à página do cliente ${planoStatus ? 'falhou' : 'não rodou nesta geração'} — confirmar manualmente antes de agir.`,   // o motivo bruto da falha fica só em fontes[].nota
      fonte: 'Notion — base Informações', periodo: rotuloMes(mes), dependencia: 'Reunião de planejamento com o cliente', indicador: 'Plano do mês registrado: não',
      meta: `Plano de ${rotuloMes(mes)} publicado com ações, responsáveis e prazos`, aceite: 'Linha do plano por canal criada na base Informações com ações, responsáveis e prazos',
      impacto: 4, urgencia: 4, esforco: 3, demanda: 'Montar Plano de Ação' })
  } else if (dia >= L.plano_mes_atrasado_dia) {
    const ex = planoDoMes({ cliente: cli.cliente, anoMes: mes, interno: true })
    if (ex.total && ex.pct < L.plano_mes_atrasado_pct)
      A({ regra: 'plano_mes_atrasado', alvo: mes, titulo: `Plano de ${rotuloMes(mes)} com baixa execução (${ex.pct}% no dia ${dia})`, horizonte: '7d',
        dimensao: 'Qualidade operacional', problema: 'Metade do mês passou e o plano está pouco executado',
        acaoTexto: 'Revisar o plano do mês: o que está bloqueado, o que não é mais prioridade e o que cabe concluir até o fim do mês; replanejar com datas.',
        tipo: 'fato', evidencia: `${ex.concluidas} de ${ex.total} ações do mês concluídas (${ex.pct}%) no dia ${dia}.`,
        fonte: 'Notion — tarefas do mês', periodo: rotuloMes(mes), dependencia: '—', indicador: `${ex.pct}% do plano do mês`,
        meta: 'Plano replanejado com datas realistas', aceite: 'Ações do mês reclassificadas (executar/mover/cancelar) e comunicadas ao cliente',
        impacto: 3, urgencia: 4, esforco: 2 })
  }

  // 6. alavancas sem ação recente (só em cliente ativo — cliente parado é outro problema, tratado acima)
  if (ctx.atividadeRecente >= L.min_tarefas_ativas_para_alavanca) {
    for (const [k, a] of Object.entries(PB.alavancas)) {
      if (k.startsWith('$') || ctx.alavancas[k] > 0) continue
      A({ regra: `alavanca_${k}`, alvo: k, titulo: `${a.rotulo}: nenhuma ação nos últimos ${L.janela_alavanca_dias} dias`, horizonte: a.horizonte,
        dimensao: a.dimensao, problema: `Nenhuma tarefa de ${a.rotulo.toLowerCase()} registrada em ${L.janela_alavanca_dias} dias, embora o cliente esteja ativo`,
        acaoTexto: a.acao,
        tipo: 'hipotese', evidencia: `Fato: ${ctx.atividadeRecente} tarefa(s) com atividade em ${L.janela_alavanca_dias} dias e nenhuma de ${a.rotulo.toLowerCase()} (por tipo de demanda/título). Hipótese: a alavanca está sem cobertura — confirmar que não é feita fora do quadro de tarefas da equipe.`,
        fonte: FONTE_N, periodo: `${brData(addDias(hoje, -L.janela_alavanca_dias))} a ${brData(hoje)}`, dependencia: a.dependencia,
        indicador: a.indicador, meta: a.meta, aceite: a.aceite, impacto: a.impacto, urgencia: 3, esforco: a.esforco, demanda: a.demanda })
    }
  }

  // 7. calendário sazonal (retroativo: consumo → reposição → campanha → conteúdo). Lead times = premissas.
  for (const ev of PB.calendario) {
    if (!ev.universal) continue
    const dias = diasEntre(hoje, ev.data)
    if (dias < PB.acao_calendario_min_dias || dias > PB.acao_calendario_ate_dias) continue
    const lt = PB.lead_times, prazo = addDias(ev.data, -lt.conteudo)
    const restam = diasEntre(hoje, prazo)
    A({ regra: 'calendario', alvo: ev.data, titulo: `Preparar ${ev.nome} (${brData(ev.data)})`, horizonte: restam <= 7 ? '7d' : restam <= 30 ? '30d' : '90d', prazo: prazo > hoje ? prazo : addDias(hoje, 3),
      dimensao: 'Demanda e visibilidade', problema: `${ev.nome} se aproxima: sem planejamento, estoque, conteúdo e campanha chegam tarde`,
      acaoTexto: (() => { const ate = d => d >= hoje ? `até ${brData(d)}` : 'imediatamente (o prazo de referência já passou)'
        return `Montar o calendário retroativo da data: conteúdo e anúncios prontos ${ate(addDias(ev.data, -lt.conteudo))}; reposição confirmada ${ate(addDias(ev.data, -lt.reposicao))}; campanha no ar ${ate(addDias(ev.data, -lt.campanha_no_ar))} (premissas padrão — ajustar ao prazo real de fornecimento do cliente). Definir produtos, estoque necessário e desconto máximo que preserva a margem; confirmar elegibilidade da campanha no canal.` })(),
      tipo: 'fato', evidencia: `${ev.nome} em ${brData(ev.data)} (daqui a ${dias} dias) — data do calendário comercial. Prazos de preparação são premissas, não dados do cliente.`,
      fonte: 'Calendário comercial (config/playbook.json)', periodo: brData(ev.data), dependencia: 'Prazo de fornecimento e estoque do cliente', indicador: 'Planejamento da data: não iniciado',
      meta: `Calendário retroativo de ${ev.nome} definido e validado com o cliente`, aceite: 'Produtos, estoque, oferta e datas de conteúdo/reposição/campanha registrados',
      impacto: 5, urgencia: restam <= 14 ? 4 : 3, esforco: 3, demanda: 'Campanha de Oferta' })
  }

  // 8.5 renovação de contrato (Venc Contrato <canal> na central; playbook §10: evolução com dados + CS ~20 dias antes)
  for (const [k, data] of Object.entries(cli.vencimentos || {})) {
    const dias = diasEntre(hoje, data)
    if (dias > (PB.renovacao_janela_dias ?? 30) || dias < -15) continue
    A({ regra: 'renovacao', alvo: `${k}|${data}`, canalK: k,
      titulo: dias < 0 ? `Contrato ${CANAIS[k]} vencido há ${-dias} dia(s) — tratar a renovação` : `Preparar a renovação: contrato ${CANAIS[k]} vence em ${dias} dia(s)`,
      horizonte: dias <= 7 ? '72h' : dias <= 20 ? '7d' : '30d',
      dimensao: 'Qualidade operacional', problema: 'Renovação sem preparo derruba a receita recorrente; o playbook pede a evolução mostrada com dados e o CS acionado ~20 dias antes do fim',
      acaoTexto: 'Montar a revisão de evolução com dados (ritual de métricas: antes × agora), listar o que ainda pode ser aprofundado no próximo ciclo e acionar o CS para a conversa formal (~20 dias antes do fim). O contato com o cliente é do consultor/CS — o sistema não envia mensagens.',
      tipo: 'fato', evidencia: `Venc Contrato ${k} na central: ${brData(data)} (${dias >= 0 ? `em ${dias} dia(s)` : `${-dias} dia(s) atrás`}).`,
      fonte: 'Notion — central de clientes (Venc Contrato)', periodo: POS, dependencia: 'Evolução com dados do ciclo; agenda do CS', indicador: `Contrato ${k} até ${brData(data)}`,
      meta: 'Proposta de renovação apresentada antes do vencimento', aceite: 'Revisão de evolução feita com o cliente e CS acionado, com registro no card',
      impacto: 5, urgencia: dias <= 7 ? 5 : 4, esforco: 2, demanda: 'Reunião de Alinhamento' })
  }

  // 8. Mercado Livre: conexão (só quando a infraestrutura de conexão existe) e métricas reais (se conectada)
  const conexao = statusConexao(cli.cliente)
  const infraML = !!(env.MELI_CLIENT_ID && env.PUBLIC_BASE_URL)
  if (cli.canais.includes('ML') && infraML && (!conexao || conexao.erro)) {
    A({ regra: 'ml_conectar', titulo: conexao?.erro ? 'Reconectar a conta do Mercado Livre' : 'Conectar a conta do Mercado Livre ao Place Sprints', horizonte: '7d', canalK: 'ML',
      dimensao: 'Demanda e visibilidade', problema: 'Sem a conta conectada o plano não enxerga vendas, visitas, conversão nem Ads reais',
      acaoTexto: 'Pedir ao cliente que clique no botão "Conectar conta do Mercado Livre" na página dele no Notion e autorize o acesso de leitura; conferir que o selo ficou verde.',
      tipo: 'fato', evidencia: conexao?.erro ? `A conexão expirou ou foi revogada: ${String(conexao.erro).slice(0, 120)}` : 'Nenhuma conta do Mercado Livre conectada para este cliente.',
      fonte: 'Place Sprints — conexões', periodo: POS, dependencia: 'Autorização do cliente', indicador: 'Conta conectada: não', meta: 'Conta conectada', aceite: 'Callout verde "Mercado Livre conectado" na página do cliente',
      impacto: 4, urgencia: 3, esforco: 1 })
  }
  if (ml?.atual && ml?.anterior) {
    const n = ml.atual, p = ml.anterior, J = L.ml, per = `${brData(ml.janela_atual.de)} a ${brData(ml.janela_atual.ate)} vs ${brData(ml.janela_anterior.de)} a ${brData(ml.janela_anterior.ate)}`
    const parcial = n.parcial || p.parcial   // janela com 1000+ pedidos: a API devolve amostra — nada aqui vira "fato"
    const FONTE_ML = parcial ? 'API do Mercado Livre (AMOSTRA: janela com mais de 1000 pedidos — comparação parcial)' : 'API do Mercado Livre (dias completos, períodos equivalentes)'
    const dPct = (a, b) => b ? pct1((a - b) / Math.abs(b) * 100) : null
    const dFat = dPct(n.faturamento, p.faturamento)
    if (p.vendas >= J.min_pedidos_base && dFat !== null && dFat <= -J.queda_faturamento_pct)
      A({ regra: 'ml_queda_faturamento', titulo: `Faturamento no Mercado Livre caiu ${Math.abs(dFat)}% em 28 dias`, horizonte: '72h', canalK: 'ML',
        dimensao: 'Demanda e visibilidade', problema: 'Queda relevante de receita no canal',
        acaoTexto: 'Diagnosticar pelo funil antes de agir: visitas → conversão → preço/frete/prazo → estoque/ruptura → Ads → sazonalidade/promoções do período. Registrar a causa comprovada ou a hipótese a testar; não presumir.',
        tipo: parcial ? 'projecao' : 'fato', evidencia: `Faturamento ${fmtMoeda(n.faturamento)} vs ${fmtMoeda(p.faturamento)} (${dFat}%); pedidos ${n.vendas} vs ${p.vendas}. Hipótese (não comprovada): a queda vem de visitas, conversão, preço ou ruptura.`,
        fonte: FONTE_ML, periodo: per, dependencia: 'Visitas por anúncio, estoque e histórico de alterações', indicador: `Faturamento 28d ${fmtMoeda(n.faturamento)}`,
        meta: 'Causa identificada e plano de recuperação com indicador', aceite: 'Diagnóstico por etapa do funil registrado com evidência', impacto: 5, urgencia: 5, esforco: 3 })
    // referência de conversão = benchmark A/B da PRÓPRIA conta (diagnosticarConta, em ml.benchmark); queda = RELATIVA ao período anterior (como causalidadeVendas). Nenhum número universal.
    const bench = ml.benchmark?.conv ?? null, refBaixa = bench != null ? pct1(bench * (1 - J.conversao_abaixo_benchmark_pct / 100)) : null
    const quedaRel = n.conversao != null && p.conversao > 0 ? pct1((n.conversao - p.conversao) / p.conversao * 100) : null
    const caiuConversao = quedaRel != null && (p.visitas || 0) >= J.min_visitas_base && (n.visitas || 0) >= J.min_visitas_base && quedaRel <= -J.queda_conversao_rel_pct
    if (!caiuConversao && n.conversao != null && (n.visitas || 0) >= J.min_visitas_base && refBaixa != null && n.conversao < refBaixa)
      A({ regra: 'ml_conversao_baixa', titulo: `Conversão no Mercado Livre abaixo da referência da própria conta (${refBaixa}%)`, horizonte: '7d', canalK: 'ML',
        dimensao: 'Conversão e oferta', problema: `Conversão ${J.conversao_abaixo_benchmark_pct}% ou mais abaixo da taxa dos anúncios A/B da própria conta indica problema no anúncio, preço ou oferta`,
        acaoTexto: 'Rodada de otimização pela estratégia ímã: priorizar os anúncios com mais visitas e conversão abaixo da referência; para cada um, identificar a objeção provável (conteúdo, oferta, preço, entrega ou confiança) e testar uma alteração concreta.',
        tipo: parcial ? 'projecao' : 'fato', evidencia: `Conversão ${n.conversao}% nos últimos 28 dias com ${n.visitas} visitas vs referência ${refBaixa}% (benchmark ${bench}% da própria conta — ${ml.benchmark.regra || 'anúncios A/B'} — menos ${J.conversao_abaixo_benchmark_pct}%, premissa do playbook). Definição: pedidos ÷ visitas totais da conta; benchmark = unidades ÷ visitas dos anúncios A/B.`,
        fonte: FONTE_ML, periodo: `${brData(ml.janela_atual.de)} a ${brData(ml.janela_atual.ate)}`, dependencia: 'Visitas e conversão por anúncio', indicador: `Conversão 28d ${n.conversao}%`,
        meta: `Conversão da conta acima de ${refBaixa}% (referência da própria conta)`, aceite: 'Anúncios priorizados com objeção, alteração e hipótese de teste registradas', impacto: 4, urgencia: 3, esforco: 3, demanda: 'Otimizar Anúncios' })
    if (caiuConversao)
      A({ regra: 'ml_queda_conversao', titulo: `Conversão no Mercado Livre caiu ${Math.abs(quedaRel)}% em 28 dias`, horizonte: '7d', canalK: 'ML',
        dimensao: 'Conversão e oferta', problema: (n.visitas || 0) >= (p.visitas || 0) ? 'Mais gente visita e menos gente compra — oferta, preço, entrega ou confiança podem estar falhando' : 'A conversão caiu junto com as visitas — oferta, preço, entrega ou confiança podem estar falhando',
        acaoTexto: 'Localizar os anúncios com mais visitas e conversão abaixo do próprio histórico; para cada um, levantar a objeção provável (perguntas, avaliações, devoluções) e testar uma alteração concreta (capa, título, atributos, kit, preço/frete).',
        tipo: parcial ? 'projecao' : 'fato', evidencia: `Conversão ${n.conversao}% vs ${p.conversao}% da própria conta no período anterior (${quedaRel}% relativo; limiar ${J.queda_conversao_rel_pct}%, premissa do playbook); visitas ${n.visitas} vs ${p.visitas}. Definição: pedidos ÷ visitas totais da conta.`,
        fonte: FONTE_ML, periodo: per, dependencia: 'Visitas e conversão por anúncio', indicador: `Conversão 28d ${n.conversao}%`,
        meta: 'Anúncios priorizados com objeção e alteração propostas', aceite: 'Lista de anúncios com objeção, alteração e hipótese de teste registrada', impacto: 4, urgencia: 4, esforco: 3, demanda: 'Otimizar Anúncios' })
    const txCanc = x => (x.vendas + x.vendas_canceladas) ? x.vendas_canceladas / (x.vendas + x.vendas_canceladas) : 0
    if ((n.vendas_canceladas || 0) >= J.min_cancelamentos && p.vendas_canceladas > 0 && dPct(n.vendas_canceladas, p.vendas_canceladas) >= J.alta_cancelamento_pct && txCanc(n) > txCanc(p))
      A({ regra: 'ml_alta_cancelamento', titulo: `Cancelamentos no Mercado Livre subiram ${dPct(n.vendas_canceladas, p.vendas_canceladas)}%`, horizonte: '7d', canalK: 'ML',
        dimensao: 'Estoque e logística', problema: 'Mais vendas canceladas — ruptura, prazo de despacho ou divergência de anúncio são causas comuns',
        acaoTexto: 'Abrir os pedidos cancelados do período e classificar o motivo (ruptura, atraso, erro de anúncio, desistência); corrigir a causa mais frequente.',
        tipo: parcial ? 'projecao' : 'fato', evidencia: `Vendas canceladas ${n.vendas_canceladas} vs ${p.vendas_canceladas} (taxa ${pct1(txCanc(n) * 100)}% vs ${pct1(txCanc(p) * 100)}% dos pedidos); valor cancelado ${fmtMoeda(n.valor_cancelado)} vs ${fmtMoeda(p.valor_cancelado)}.`,
        fonte: FONTE_ML, periodo: per, dependencia: 'Motivo de cancelamento por pedido', indicador: `${n.vendas_canceladas} cancelamentos/28 dias`,
        meta: 'Motivo principal identificado e corrigido', aceite: 'Cancelamentos classificados por motivo e ação corretiva registrada', impacto: 4, urgencia: 4, esforco: 2 })
  }
  return out
}

// ── pendências (dados que mudam a decisão) e fontes ────────────────────────
function pendencias(cli, ctx, ml) {
  const P = []
  const add = (item, mudaDecisao, comoObter) => P.push({ item, muda_decisao: mudaDecisao, como_obter: comoObter })
  if (!ml?.atual) add('Vendas, visitas e conversão por anúncio/SKU', 'Define quais anúncios otimizar, onde há tráfego sem conversão e o potencial de ganho', 'Conectar a conta do Mercado Livre (botão no Notion) ou exportar do painel do canal')
  if (ml?.atual && ml.benchmark?.conv == null) add('Referência de conversão da conta (benchmark A/B) ainda não disponível', 'Sem ela a regra de conversão baixa (ml_conversao_baixa) não dispara: a conta só é comparada com ela mesma, nunca com um número universal', 'Manter a coleta diária do Mercado Livre até existir anúncio curva A/B com visitas suficientes nos 28 dias (config/algoritmo.json → benchmark_min_visitas)')
  add('Metas de faturamento, margem e investimento do cliente', 'Define ROAS alvo, desconto máximo e prioridade entre produtos', 'Registrar na reunião de resultados com o cliente')
  // tarefa de renovação JÁ no Notion cuja data não é mais a vigente (cliente renovou e a central mudou):
  // o ID é hash(cliente|regra|alvo), então recomputamos os IDs vigentes e qualquer 'renovacao' distribuída
  // fora deles é órfã — vira pendência declarada (nunca apagamos tarefa do Notion sozinhos).
  const idsVigentes = new Set(Object.entries(cli.vencimentos || {}).map(([k, d]) => idAcao(cli.cliente, 'renovacao', `${k}|${d}`)))
  for (const r of db.prepare("SELECT id, titulo FROM acoes_plano WHERE cliente = ? AND regra = 'renovacao' AND status = 'distribuida'").all(cli.cliente))
    if (!idsVigentes.has(r.id))
      add(`Tarefa de renovação no Notion com data antiga ("${r.titulo}")`, 'A data de vencimento mudou na central — a tarefa antiga pode confundir o consultor', 'Concluir ou arquivar a tarefa antiga no quadro do cliente (ou desfazer pelo painel de distribuição)')
  if (!Object.keys(cli.vencimentos || {}).length) add('Vencimento do contrato (Venc Contrato <canal> na central)', 'Define a pauta das reuniões restantes e a preparação da renovação (semente a partir da R4; o CS aciona ~20 dias antes do fim)', 'Preencher Venc Contrato na central de clientes')
  add('Custo por SKU, tarifas, tributos, frete suportado e embalagem', 'Sem margem pré-Ads não há ACOS/ROAS de equilíbrio nem desconto seguro', 'Planilha de custos fornecida pelo cliente (ou ERP/Bling)')
  add('Dados de mercado da categoria (demanda, preço médio, concorrentes, tendência)', 'Calibra preço, ancoragem "de/por", campanhas e a escolha do que anunciar — sem mercado o plano olha só para dentro', 'Conectar a conta do canal (insights da API) ou pesquisa de mercado da categoria (método MIRA)')
  add('Dados de Ads (investimento, receita atribuída, ACOS, ROAS, TACOS por campanha)', 'Define quais produtos entram, mantêm, aumentam ou pausam em Ads', 'Painel de Ads do canal ou API')
  add('Estoque por SKU e localização (próprio, Bling, Full), reservas e prazo de reposição', 'Define cobertura em dias, alerta de ruptura e quantidade a enviar ao Full', 'Exportação do Bling/ERP e do painel Full, com a definição de cada campo')
  if (ctx.abertas.length >= 5 && ctx.semPrazo / ctx.abertas.length >= 0.8) add('Prazo nas tarefas abertas', `${Math.round(100 * ctx.semPrazo / ctx.abertas.length)}% das tarefas abertas não têm prazo — nenhum painel consegue sinalizar atraso`, 'Preencher o campo Prazo ao criar a tarefa (tornar obrigatório no template)')
  const semMotivo = ctx.dependencias.filter(d => !d.tipo).length
  if (semMotivo) add(`Tipo da dependência não registrado em ${semMotivo} tarefa(s)`, 'Sem o motivo, o consultor não sabe o que cobrar e o cliente não vê o que falta dele no semanal', 'Registrar pela tela Painel executivo (Encerrar por dependência do cliente): tipo, detalhe e evidência')
  if (!cli.principal) add('Consultor responsável pelo cliente', 'Sem responsável, as ações ficam "a definir" e ninguém é cobrado', 'Preencher Consultor / Consultor <canal> na central de clientes')
  if (cli.canais.some(k => !cli.lideres[k])) add('Líder do canal', 'Sem líder o squad do cliente não é identificado', 'Preencher Líder <canal> na central de clientes')
  return P
}

function fontes(cli, ctx, ml, planoStatus, hoje) {
  const conexao = statusConexao(cli.cliente)
  return [
    { fonte: 'Notion — tarefas do cliente', status: ctx.tarefas.length ? 'disponivel' : 'indisponivel', periodo: `tarefas tocadas desde ${brData(DESDE)} (${ctx.tarefas.length} na base local)`, atualizado_em: (getEstado('ultimo_sync') || '').slice(0, 16).replace('T', ' ') || '—', confianca: ctx.comTipoDemanda ? 'média-alta' : 'média', nota: ctx.comTipoDemanda ? '' : 'tipo de demanda não preenchido — classificação por título' },
    { fonte: 'Notion — plano mensal (base Informações)', status: planoStatus ? (planoStatus.ok ? 'disponivel' : 'parcial') : 'parcial', periodo: rotuloMes(hoje.slice(0, 7)), atualizado_em: planoStatus ? agora().slice(0, 16).replace('T', ' ') : 'cache local', confianca: planoStatus?.ok ? 'alta' : 'baixa', nota: planoStatus && !planoStatus.ok ? planoStatus.motivo : (planoStatus ? '' : 'plano não reconsultado nesta geração') },
    { fonte: 'Notion — central de clientes (equipe, canais, tier)', status: cli.principal ? 'disponivel' : 'parcial', periodo: 'atual', atualizado_em: '—', confianca: cli.principal ? 'média' : 'baixa', nota: 'consultor/líder em texto livre; nomes normalizados por config/equipe.json' },
    { fonte: 'API do Mercado Livre', status: ml?.atual ? 'disponivel' : 'indisponivel', periodo: ml?.atual ? `${brData(ml.janela_atual.de)} a ${brData(ml.janela_atual.ate)}` : '—', atualizado_em: ml?.atual ? agora().slice(0, 16).replace('T', ' ') : '—', confianca: ml?.atual ? 'alta' : '—', nota: ml?.atual ? '' : conexao ? (conexao.erro ? 'conexão com erro' : 'sem dados no período') : 'conta não conectada' },
    { fonte: 'Ads (Mercado Livre/Shopee)', status: 'indisponivel', periodo: '—', atualizado_em: '—', confianca: '—', nota: 'sem integração ativa neste sistema' },
    { fonte: 'ERP/Bling e estoque (próprio e Full)', status: 'indisponivel', periodo: '—', atualizado_em: '—', confianca: '—', nota: 'sem integração ativa neste sistema' },
  ]
}

// ── calendário retroativo (seção sazonalidade do plano) ────────────────────
function calendario(hoje) {
  const lt = PB.lead_times
  return PB.calendario.filter(e => e.data >= hoje).map(e => ({
    nome: e.nome, data: e.data, dias: diasEntre(hoje, e.data),
    conteudo: addDias(e.data, -lt.conteudo), reposicao: addDias(e.data, -lt.reposicao), campanha: addDias(e.data, -lt.campanha_no_ar),
    estagio: diasEntre(hoje, e.data) > PB.acao_calendario_ate_dias ? 'a monitorar' : diasEntre(hoje, e.data) < PB.acao_calendario_min_dias ? 'janela curta' : 'preparar agora',
  }))
}

// ── geração do plano de UM cliente (pura: sem escrita) ─────────────────────
export function gerarPlanoCliente(cli, { hoje = hojeLocal(), ml = null, planoStatus = null } = {}) {
  const ctx = contexto(cli, hoje)
  let pendCliente = [], falhaPendCliente = false
  try { pendCliente = pendenciasReal().avaliar(cli.cliente, { hoje, paraCliente: false }).itens } catch { falhaPendCliente = true }   // só leitura local; falha não derruba o plano e vira pendência declarada
  // alinhamentos com o cliente (src/lib/alinhamentos.js) no ponto equivalente ao filtro central do plano por anúncio: regra de conta alinhada não nasce (conta em
  // omitidas.alinhado); vencida nasce com "observar: alinhado em dd/mm, revisar"; descartada no banco não ocupa vaga no top 5
  const alinhado = alinhamentosReal().predicado(cli.cliente, { hoje }), omitidas = {}
  const descartadas = new Set(db.prepare("SELECT id FROM acoes_plano WHERE cliente = ? AND status = 'descartada'").all(cli.cliente).map(r => r.id))
  const acoes = regras(cli, ctx, hoje, { ml, planoStatus, pendCliente }).filter(a => {
    if (descartadas.has(a.id)) { omitidas.descartada = (omitidas.descartada || 0) + 1; return false }
    const al = alinhado({ regra: a.regra, acao: a.id })
    if (al.sim) { omitidas.alinhado = (omitidas.alinhado || 0) + 1; return false }
    if (al.vencido) {
      const texto = `observar: alinhado em ${al.vencido.desde.slice(8, 10)}/${al.vencido.desde.slice(5, 7)}, revisar`
      a.dados.alinhamento_vencido = { tipo: al.vencido.tipo, rotulo: al.vencido.rotulo, desde: al.vencido.desde, revisar_em: al.vencido.revisar_em, texto }
      a.dados.problema = `${a.dados.problema} — ${texto}`
    }
    return true
  }).sort((a, b) => b.score - a.score || (a.prazo < b.prazo ? -1 : 1))
  const top5 = acoes.filter(a => ['72h', '7d'].includes(a.horizonte)).slice(0, 5).map(a => a.id)
  const por = h => acoes.filter(a => a.horizonte === h).length
  const pend = pendencias(cli, ctx, ml)
  if (falhaPendCliente) pend.push({ item: 'Pendências do cliente por canal (não avaliadas nesta geração)', muda_decisao: 'Sem a avaliação, estoque baixo, custos ausentes e acesso à conta não viram ação neste plano', como_obter: 'Gerar o plano de novo; se persistir, conferir config/dependencias-cliente.json' })

  const faltaML = !ml?.atual
  const dimensoes = [
    { nome: 'Demanda e visibilidade', situacao: ml?.atual ? 'parcial' : 'sem_dados', fatos: ml?.atual ? [`Visitas 28d: ${ml.atual.visitas ?? '—'} (anterior: ${ml.anterior?.visitas ?? '—'})`] : [], dados_faltantes: ['Impressões e visitas por anúncio', 'Posição/indexação por categoria'] },
    { nome: 'Clique e atração', situacao: 'sem_dados', fatos: [], dados_faltantes: ['Impressões, cliques e CTR por produto'] },
    { nome: 'Conversão e oferta', situacao: ml?.atual ? 'parcial' : 'sem_dados', fatos: ml?.atual ? [`Conversão 28d: ${ml.atual.conversao ?? '—'}% (anterior: ${ml.anterior?.conversao ?? '—'}%)`, `Pedidos: ${ml.atual.vendas} (anterior: ${ml.anterior?.vendas ?? '—'})`] : [], dados_faltantes: faltaML ? ['Pedidos, visitas e conversão por anúncio'] : ['Conversão por anúncio'] },
    { nome: 'Rentabilidade', situacao: 'sem_dados', fatos: ml?.atual ? [`Faturamento 28d: ${fmtMoeda(ml.atual.faturamento)} (anterior: ${ml.anterior ? fmtMoeda(ml.anterior.faturamento) : '—'}) — sem custo não há margem`] : [], dados_faltantes: ['Custo por SKU, tarifas, tributos, frete, embalagem'] },
    { nome: 'Estoque e logística', situacao: 'sem_dados', fatos: ml?.atual ? [`Cancelamentos 28d: ${ml.atual.vendas_canceladas ?? '—'} (anterior: ${ml.anterior?.vendas_canceladas ?? '—'})`] : [], dados_faltantes: ['Estoque por SKU/localização, reposição, Full'] },
    { nome: 'Qualidade operacional', situacao: 'observado', dados_faltantes: [],
      fatos: [
        `${ctx.abertas.length} tarefa(s) abertas; ${ctx.bloqueadas.length} bloqueada(s) por impedimento interno; ${ctx.dependencias.length} aguardando o cliente (${ctx.dependenciasVencidas.length} há ${L.dependencia_atencao_dias}+ dias); ${ctx.paradas.length} parada(s) há ${L.dias_parada}+ dias; ${ctx.semResponsavel.length} sem responsável`,
        ctx.ultimaEntrega ? `Última entrega concluída: ${brData(ctx.ultimaEntrega)} (${diasEntre(ctx.ultimaEntrega, hoje)} dias)` : 'Nenhuma entrega concluída registrada na base sincronizada',
        `Cadência: ${ctx.c28} entrega(s) nos últimos 28 dias vs ${ctx.p28} nos 28 anteriores`,
        `Plano de ${rotuloMes(hoje.slice(0, 7))}: ${planosDoMes(cli.cliente, hoje.slice(0, 7)).length ? 'registrado' : 'não registrado'}`,
      ] },
  ]
  // achado = primeira frase da evidência (o fato observado), não a frase do "problema"
  const achado = a => a.dados.evidencia.split(/(?<=\.)\s/)[0].replace(/\.$/, '')
  const gargalos = acoes.filter(a => a.dados.evidencia_tipo === 'fato' && !a.regra.startsWith('calendario')).slice(0, 3).map(achado)
  const oportunidades = acoes.filter(a => a.horizonte === '30d' || a.horizonte === '90d').slice(0, 3).map(a => a.titulo)
  const riscos = acoes.filter(a => a.horizonte === '72h').map(a => a.titulo)

  const resumo = `${cli.cliente}${cli.tier ? ` (${cli.tier})` : ''}${cli.canais.length ? `, canais: ${cli.canais.map(k => CANAIS[k]).join(', ')}` : ''}. ` +
    `${acoes.length} ação(ões) proposta(s), ${por('72h')} para as próximas 72 horas. ` +
    (gargalos.length ? `Fatos observados nos dados conectados: ${gargalos.map(g => g.charAt(0).toLowerCase() + g.slice(1)).join('; ')}. ` : 'A operação não mostra bloqueios relevantes nos dados conectados. ') +
    `Este plano usa os dados disponíveis (tarefas, plano mensal e equipe do Notion${ml?.atual ? ' e API do Mercado Livre' : ''}); ` +
    `${faltaML ? 'vendas, ' : ''}Ads, estoque e margem ainda não estão conectados e constam como pendências — o plano não faz recomendações de mídia, preço ou reposição sem eles.`

  return {
    acoes,
    plano: {
      cliente: cli.cliente, gerado_em: hoje, omitidas,
      central: { tier: cli.tier, nicho: cli.nicho, canais: cli.canais.map(k => CANAIS[k]), consultor: cli.principal, squad: cli.squadPrincipal, squads: cli.squads },
      resumo: { texto: resumo, n_acoes: acoes.length, h72: por('72h'), h7: por('7d'), h30: por('30d'), h90: por('90d'), top5 },
      fontes: fontes(cli, ctx, ml, planoStatus, hoje), diagnostico: { dimensoes, gargalos, oportunidades, riscos },
      operacao: { abertas: ctx.abertas.length, bloqueadas: ctx.bloqueadas.length, dependencia_cliente: ctx.dependencias.length, dependencia_14d: ctx.dependenciasVencidas.length, paradas: ctx.paradas.length, sem_responsavel: ctx.semResponsavel.length, sem_prazo: ctx.semPrazo, ultima_entrega: ctx.ultimaEntrega, c28: ctx.c28, p28: ctx.p28 },
      pendencias: pend, calendario: calendario(hoje), ml: ml?.atual ? { atual: ml.atual, anterior: ml.anterior, janela_atual: ml.janela_atual, janela_anterior: ml.janela_anterior } : null,
    },
  }
}

// ── persistência: IDs estáveis, nunca sobrescreve decisão já tomada ─────────
export function salvarPlano(plano, acoes, { pularObsoletas = [] } = {}) {
  const t = agora()
  const existentes = new Map(db.prepare('SELECT id, status, regra FROM acoes_plano WHERE cliente = ?').all(plano.cliente).map(r => [r.id, r]))
  const ins = db.prepare(`INSERT INTO acoes_plano (id, cliente, canal, regra, mes, titulo, horizonte, prazo, responsavel, squad, score, dados_json, status, criado_em, atualizado_em)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'proposta', ?, ?)`)
  // proposta/obsoleta/aprovada recebem evidência e prazo frescos (aprovada mantém o status);
  // descartada e distribuida nunca são tocadas (decisão humana / já está no Notion)
  const atualiza = db.prepare(`UPDATE acoes_plano SET titulo=?, horizonte=?, prazo=?, responsavel=?, squad=?, score=?, dados_json=?, atualizado_em=?,
    status = CASE WHEN status = 'obsoleta' THEN 'proposta' ELSE status END WHERE id = ? AND status IN ('proposta','obsoleta','aprovada')`)
  // evidência sumiu → proposta E aprovada-não-distribuída viram obsoletas (não criar tarefa de problema resolvido)
  const obsoleta = db.prepare("UPDATE acoes_plano SET status = 'obsoleta', atualizado_em = ? WHERE id = ? AND status IN ('proposta','aprovada')")
  let novas = 0, mantidas = 0
  db.transaction(() => {
    const vistos = new Set()
    for (const a of acoes) {
      vistos.add(a.id)
      if (existentes.has(a.id)) { atualiza.run(a.titulo, a.horizonte, a.prazo, a.responsavel, a.squad, a.score, JSON.stringify(a.dados), t, a.id); mantidas++ }
      else { ins.run(a.id, a.cliente, a.canal, a.regra, a.mes, a.titulo, a.horizonte, a.prazo, a.responsavel, a.squad, a.score, JSON.stringify(a.dados), t, t); novas++ }
    }
    // ações 'anuncio_*' (plano por anúncio e jobs de Ofertas) têm dono próprio (plano-anuncios.salvarAcoesAnuncio): a evidência delas não é deste plano
    for (const [id, r] of existentes)
      if (!vistos.has(id) && ['proposta', 'aprovada'].includes(r.status) && !pularObsoletas.includes(r.regra) && !r.regra.startsWith('anuncio_')) obsoleta.run(t, id)
    db.prepare(`INSERT INTO planos_cliente (cliente, gerado_em, plano_json) VALUES (?,?,?)
      ON CONFLICT(cliente) DO UPDATE SET gerado_em = excluded.gerado_em, plano_json = excluded.plano_json`).run(plano.cliente, t, JSON.stringify(plano))
  })()
  return { novas, mantidas }
}

// ── geração em escopo (seleção / consultor / squad / total) ─────────────────
// opcoes.atualizarPlanos: reconsulta no Notion a base "Informações" do mês (evita falso "plano ausente").
// opcoes.comML: coleta 28 dias completos × 28 anteriores da API do ML para clientes com conta conectada.
export async function gerarPlanosEscopo(escopo, { hoje = hojeLocal(), atualizarPlanos = true, comML = true, aoProgredir = () => {} } = {}) {
  const registros = escopo.registros || []
  let fontesPorCliente = new Map()
  if (atualizarPlanos) {
    const { descobrirFontes } = await import('./descobrir.js')
    fontesPorCliente = new Map((await descobrirFontes()).map(f => [f.cliente, f]))
  }
  const resultados = []
  // benchmark de conversão da PRÓPRIA conta (anúncios A/B) para as regras ml_*; import dinâmico: diagnostico-conta → motor-ppc → playbook deste módulo (sem ciclo estático)
  const { diagnosticarConta } = comML ? await import('./diagnostico-conta.js') : {}
  const benchmarkDe = cliente => { try { return diagnosticarConta?.(cliente, { hoje })?.benchmark ?? null } catch { return null } }
  let i = 0
  for (const cli of registros) {
    i++
    let planoStatus = null, ml = null
    if (atualizarPlanos) {
      const f = fontesPorCliente.get(cli.cliente)
      if (f) {
        try { planoStatus = await sincronizarPlanos({ cliente: cli.cliente, paginaClienteId: f.paginaClienteId, tarefasDbId: f.dbId, tarefasModo: f.modo, meses: [hoje.slice(0, 7)] }) }
        catch (e) { planoStatus = { ok: false, motivo: e.message.slice(0, 120) } }
      }
    }
    const conexao = statusConexao(cli.cliente)
    if (comML && conexao && !conexao.erro) {
      try { const r = await comComparativo(cli.cliente, { de: addDias(hoje, -28), ate: addDias(hoje, -1) }, relatorioNegocio)
        if (r?.atual?.disponivel) ml = { ...r, janela_atual: { de: addDias(hoje, -28), ate: addDias(hoje, -1) }, benchmark: benchmarkDe(cli.cliente) } } catch { /* fonte indisponível: o plano segue sem ML */ }
    }
    try {
      const { plano, acoes } = gerarPlanoCliente(cli, { hoje, ml, planoStatus })
      const pular = ml?.atual ? [] : ['ml_queda_faturamento', 'ml_queda_conversao', 'ml_alta_cancelamento']
      const r = salvarPlano(plano, acoes, { pularObsoletas: pular })
      resultados.push({ cliente: cli.cliente, squad: cli.squadPrincipal, consultor: cli.principal, n_acoes: acoes.length, h72: plano.resumo.h72, h7: plano.resumo.h7, h30: plano.resumo.h30, h90: plano.resumo.h90, pendencias: plano.pendencias.length, ...r })
    } catch (e) {
      resultados.push({ cliente: cli.cliente, squad: cli.squadPrincipal, consultor: cli.principal, n_acoes: 0, h72: 0, h7: 0, h30: 0, h90: 0, pendencias: 0, novas: 0, mantidas: 0, erro: e.message.slice(0, 200) })
    }
    aoProgredir({ feitos: i, total: registros.length, cliente: cli.cliente })
  }
  return resultados
}

// ── leitura ────────────────────────────────────────────────────────────────
export function lerPlano(cliente) {
  const r = db.prepare('SELECT plano_json, gerado_em FROM planos_cliente WHERE cliente = ?').get(cliente)
  return r ? { ...JSON.parse(r.plano_json), _gerado_em: r.gerado_em } : null
}

const hidratar = r => ({ ...r, dados: JSON.parse(r.dados_json), dados_json: undefined })

export function lerAcoes({ clientes = null, status = null, squad = '', consultor = '', horizonte = '' } = {}) {
  let rows = db.prepare('SELECT * FROM acoes_plano ORDER BY score DESC, prazo').all().map(hidratar)
  if (clientes) { const s = new Set(clientes); rows = rows.filter(r => s.has(r.cliente)) }
  if (status) rows = rows.filter(r => status.includes(r.status))
  if (squad) { const n = normNome(squad); rows = rows.filter(r => normNome(r.squad) === n) }
  if (consultor) { const n = normNome(consultor); rows = rows.filter(r => normNome(r.responsavel) === n) }
  if (horizonte) rows = rows.filter(r => r.horizonte === horizonte)
  return rows
}

// ações de um escopo: seleção/total filtram por cliente; consultor e squad filtram a PRÓPRIA ação (dono/squad do canal)
export function acoesDoEscopo(escopo, { status = ['proposta', 'aprovada'] } = {}) {
  return lerAcoes({ clientes: escopo.clientes, status, squad: escopo.tipo === 'squad' ? escopo.squad : '', consultor: escopo.tipo === 'consultor' ? escopo.consultor : '' })
}

// descartar exige quem (líder/consultor) + motivo da lista (config/alinhamentos.json → tipos) + motivo livre opcional + revisão (padrão +30 d; permanente só descontinuado):
// cada ação descartada vira um ALINHAMENTO origem 'descarte' com escopo = entidade da ação (anúncio pelo item_id, senão conta) e regras [regra] — a regra não renasce
// em outro id até a revisão. Reabrir (proposta/aprovada) uma DESCARTADA exige quem (líder/consultor, 403) e encerra o alinhamento daquele descarte; qualquer decisão humana
// sobre a ação (aprovar, reabrir, descartar de novo) encerra antes o alinhamento de descarte vencido dela (sem selo "revisar" eterno nem linha órfã). Lote: o mesmo motivo
// vale para todas. WHERE sempre com o cliente da ação.
export function marcarStatus(ids, status, { por = '', motivo_tipo = '', motivo = '', revisar_em = '', permanente = false } = {}) {
  if (!['proposta', 'aprovada', 'descartada'].includes(status)) throw Object.assign(new Error('status inválido'), { status: 400 })
  if (!Array.isArray(ids)) throw Object.assign(new Error('informe "ids"'), { status: 400 })
  const al = alinhamentosReal()
  const linhas = [...new Set(ids.map(String))].slice(0, 500).map(id => db.prepare('SELECT id, cliente, regra, item_id, status FROM acoes_plano WHERE id = ?').get(id)).filter(Boolean)
  const desc = status === 'descartada'
  const alinhar = a => ({ cliente: a.cliente, escopo: a.item_id ? 'anuncio' : 'conta', chave: a.item_id || '', regras: [a.regra.replace(/^anuncio_/, '')], tipo: motivo_tipo,
    motivo, revisar_em, permanente: permanente === true, por, origem: 'descarte', acao_id: a.id })
  if (desc) {
    if (!motivo_tipo) throw Object.assign(new Error('informe "motivo_tipo" (motivo da lista) para descartar'), { status: 400 })
    for (const a of linhas) al.registrar(alinhar(a))          // prévia: valida quem, motivo (auditor), tipo e data ANTES de gravar qualquer coisa
  } else if (linhas.some(a => a.status === 'descartada')) {
    if (!String(por || '').trim()) throw Object.assign(new Error('informe "por" (quem reabre — líder ou consultor) para reabrir uma ação descartada'), { status: 400 })
    if (!validarLiderOuConsultor(String(por).trim())) throw Object.assign(new Error('só líderes e consultores reabrem ação descartada — escolha um nome da central'), { status: 403 })
  }
  const quemDecide = String(por || '').trim() ? validarLiderOuConsultor(String(por).trim()) || '' : ''   // nome canônico ou vazio (nunca o texto cru)
  const up = db.prepare(`UPDATE acoes_plano SET status = ?, atualizado_em = ? WHERE id = ? AND cliente = ? AND status IN (${desc ? "'proposta','aprovada'" : "'proposta','aprovada','descartada'"})`)
  const t = agora()
  return db.transaction(() => linhas.reduce((n, a) => {
    const ch = up.run(status, t, a.id, a.cliente).changes
    if (ch) al.encerrarDaAcao(a.cliente, a.id, quemDecide)    // reabrir encerra o descarte vivo; aprovar/descartar de novo encerra o vencido
    if (ch && desc) al.registrar({ ...alinhar(a), confirmar: true })
    return n + ch
  }, 0))()
}
