// O Merovíngio — camada de pensamento estratégico do Place Sprints.
// "Causalidade. Não há como escapar dela." — o módulo olha o estado observado de cada cliente
// (e da base inteira), monta a cadeia de causa e efeito, QUESTIONA a própria evidência
// (pensamento crítico: qualidade, sinais mistos, falsificadores) e escolhe o melhor caminho:
// uma sequência de jogadas ordenada pela escada P.L.A.C.E do playbook de consultoria
// (Pesquisa → Layout → Aceleração → Coleta → Escala; operação destravada vem antes de tudo,
// e Ads antes de anúncio otimizado queima verba — armadilha nº 1 do playbook).
// 100% determinístico, zero IA: cada elo cita o dado que o sustenta; elo de raciocínio é
// rotulado como hipótese causal, nunca como fato.
import { db, hojeLocal } from './db.js'
import { NAO_S90_SQL } from './s90-chave.js'
import { playbook, addDias, dependenciasDe } from './plano-cliente.js'
import { serieDiaria, somaJanela, tendencia, prioridadeAcao, statusRenovacao } from './motor-ppc.js'
import { ABERTA_SQL } from './status-tarefa.js'
import { tipoDaRegra } from './plano-anuncios.js'          // tipo da regra anuncio_* (sequência lógica do Manual) → estágio da escada; sem ciclo: plano-anuncios não importa daqui

const pct = (a, b) => b ? Math.round(100 * a / b) : 0

// ── mapa regra → estágio estratégico (a escada do caminho) ──────────────────
export const ESTAGIOS = [
  { k: 'operacao', rotulo: 'Destravar a operação', porque: 'Nada escala em cima de execução travada — bloqueio, backlog e falta de dono vêm antes de qualquer alavanca.' },
  { k: 'renovacao', rotulo: 'Garantir a renovação', porque: 'Contrato vencendo é o relógio que manda: sem renovação não há próximo ciclo (playbook §10).' },
  { k: 'P', rotulo: 'Pesquisa e preço', porque: 'Preço e margem validados vêm antes de atrair tráfego — vender no prejuízo não é crescimento (P.L.A.C.E: Pesquisa).' },
  { k: 'L', rotulo: 'Layout dos anúncios', porque: 'Anúncio que converte vem antes de pagar por visita — Ads em anúncio fraco queima verba (armadilha nº 1 do playbook).' },
  { k: 'A', rotulo: 'Aceleração e demanda', porque: 'Com oferta no ponto, a jogada vira atrair demanda qualificada: campanha, cupom, sazonalidade (P.L.A.C.E: Aceleração).' },
  { k: 'C', rotulo: 'Coleta e ritual de métricas', porque: 'Decisão guiada por dado, não por achismo — o ritual de métricas fecha o ciclo e sustenta a renovação (P.L.A.C.E: Coleta).' },
]
const ESTAGIO_POR_REGRA = {
  bloqueio_cliente: 'operacao', bloqueio_interno: 'operacao', sem_entrega: 'operacao', queda_cadencia: 'operacao', backlog_parado: 'operacao',
  sem_responsavel: 'operacao', sem_plano_mes: 'operacao', plano_mes_atrasado: 'operacao',
  renovacao: 'renovacao',
  alavanca_precificacao: 'P',
  alavanca_otimizacao: 'L', ml_conversao_baixa: 'L', ml_queda_conversao: 'L',
  alavanca_ofertas: 'A', alavanca_ads: 'A', calendario: 'A', ml_queda_faturamento: 'A', ml_alta_cancelamento: 'A',
  alavanca_acompanhamento: 'C', ml_conectar: 'C',
}
// ações do plano por anúncio (anuncio_*): o estágio vem do TIPO da regra (sequência lógica do Manual) — antes toda anuncio_* caía em "C"
const ESTAGIO_POR_TIPO = { saude: 'P', disponibilidade: 'P', cadastro: 'L', otimizacao: 'L', trafego_promocao: 'A', expansao: 'A' }
// ponytail: só anuncio_* consulta o tipo (tipoDaRegra devolve 'otimizacao' para id desconhecido e mudaria o estágio das regras de conta não mapeadas)
const estagioDe = regra => ESTAGIO_POR_REGRA[regra] || (/^anuncio_/.test(regra) ? ESTAGIO_POR_TIPO[tipoDaRegra(regra)] : null) || 'C'

// ── arquétipos (primeiro que casa vence — determinístico e explicável) ──────
const ARQUETIPOS = [
  {
    k: 'destravar', rotulo: 'Destravar', emoji: '🔓',
    quando: e => e.bloqueadas >= 5 || (e.abertas >= 5 && pct(e.bloqueadas, e.abertas) >= 30),   // só impedimento interno (dependência do cliente não é aberta)
    tese: e => `${e.bloqueadas} de ${e.abertas} tarefa(s) abertas estão travadas por impedimento interno — o jogo deste cliente é destravar antes de otimizar qualquer coisa.`,
    cadeia: e => [
      { elo: `${e.bloqueadas} tarefa(s) com impedimento interno`, tipo: 'fato' },
      { elo: 'o backlog travado esconde o que é prioridade', tipo: 'hipotese' },
      e.c28 < e.p28
        ? { elo: `a cadência cai (${e.c28} entregas/28d vs ${e.p28} anteriores)`, tipo: 'fato' }
        : { elo: `se o bloqueio persistir, a cadência tende a cair (hoje ${e.c28} entregas/28d vs ${e.p28} anteriores)`, tipo: 'projecao' },
      { elo: 'cliente sem resultado visível raramente renova (playbook §10)', tipo: 'hipotese' },
    ],
    falsificador: 'Se os status "Bloqueada/Problemas na tarefa" estiverem desatualizados no Notion, a leitura cai — validar com o analista responsável antes de escalar.',
  },
  {
    k: 'cobrar_cliente', rotulo: 'Cobrar o cliente', emoji: '📨',
    quando: e => e.dependenciasVencidas >= 3 || (e.abertas + e.dependencias >= 5 && pct(e.dependencias, e.abertas + e.dependencias) >= 30),
    tese: e => `${e.dependencias} tarefa(s) aguardam retorno do cliente (${e.dependenciasVencidas} há ${playbook.limiares.dependencia_atencao_dias}+ dias) — a equipe não está travada; falta informação do cliente. A jogada é do consultor: cobrar com data.`,
    cadeia: e => [
      { elo: `${e.dependencias} tarefa(s) em dependência do cliente, ${e.dependenciasVencidas} há ${playbook.limiares.dependencia_atencao_dias}+ dias`, tipo: 'fato' },
      { elo: 'sem o retorno o plano do mês não fecha e a leitura parece de operação parada', tipo: 'hipotese' },
      e.c28 < e.p28
        ? { elo: `a cadência cai (${e.c28} entregas/28d vs ${e.p28} anteriores)`, tipo: 'fato' }
        : { elo: `se o retorno não vier, a cadência tende a cair (hoje ${e.c28} entregas/28d vs ${e.p28} anteriores)`, tipo: 'projecao' },
      { elo: 'silêncio prolongado do cliente é sinal de desengajamento — follow-up dos dias 3-5/7-8 (playbook §05)', tipo: 'hipotese' },
    ],
    falsificador: 'Se o cliente já enviou fora do Notion, a leitura é de registro — confirmar com o consultor e reabrir a tarefa no Notion.',
  },
  {
    k: 'retomar_ritmo', rotulo: 'Retomar o ritmo', emoji: '🏃',
    quando: e => e.abertas > 0 && (e.diasSemEntrega == null || e.diasSemEntrega >= playbook.limiares.dias_sem_entrega || (e.p28 >= playbook.limiares.queda_cadencia_base_minima && e.c28 <= e.p28 * (1 - playbook.limiares.queda_cadencia_pct / 100))),
    tese: e => e.diasSemEntrega == null
      ? `Há ${e.abertas} tarefa(s) abertas e nenhuma entrega concluída registrada — antes de estratégia, é execução.`
      : `${e.diasSemEntrega} dia(s) sem entrega concluída (um ciclo quinzenal${e.diasSemEntrega >= 28 ? ' inteiro e mais' : ''}) — sem execução não há resultado, nem renovação.`,
    cadeia: e => [
      { elo: e.diasSemEntrega == null ? 'nenhuma entrega concluída na base sincronizada' : `última entrega há ${e.diasSemEntrega} dia(s)`, tipo: 'fato' },
      { elo: 'as reuniões quinzenais perdem evidência de progresso (ritual de métricas vazio)', tipo: 'hipotese' },
      { elo: 'o engajamento cai — silêncio prolongado é sinal de desengajamento (playbook §05)', tipo: 'hipotese' },
    ],
    falsificador: 'Se o trabalho está sendo feito fora do Notion (ou concluído sem marcar), a queda é de REGISTRO, não de execução — confirmar com o consultor; nesse caso a jogada vira higiene de board.',
  },
  {
    k: 'estruturar', rotulo: 'Estruturar a base', emoji: '🧱',
    quando: e => !e.consultor || !e.temPlanoMes || (e.abertas >= 5 && pct(e.semResponsavel, e.abertas) >= 30),
    tese: e => [!e.consultor ? 'sem consultor definido' : '', !e.temPlanoMes ? 'sem plano do mês' : '', pct(e.semResponsavel, e.abertas) >= 30 ? `${e.semResponsavel} tarefa(s) sem dono` : ''].filter(Boolean).join(' + ') + ' — falta fundação: definir quem faz e qual é o plano antes de acelerar.',
    cadeia: e => [
      { elo: [!e.consultor ? 'consultor a definir' : '', !e.temPlanoMes ? 'mês sem plano registrado' : '', e.semResponsavel ? `${e.semResponsavel} tarefa(s) sem responsável` : ''].filter(Boolean).join('; '), tipo: 'fato' },
      { elo: 'sem dono e sem plano, a execução depende de improviso', tipo: 'hipotese' },
      { elo: 'o esforço se dispersa e o resultado não se acumula', tipo: 'hipotese' },
    ],
    falsificador: 'Se o plano existe fora da base "Informações" (ex.: combinado em reunião e não registrado), o problema é de registro — a jogada é registrar, não replanejar do zero.',
  },
  {
    k: 'acelerar', rotulo: 'Acelerar', emoji: '🚀',
    quando: e => e.alavancasParadas.length >= 2,
    tese: e => `Operação saudável, mas ${e.alavancasParadas.length} alavanca(s) sem nenhuma ação em ${playbook.limiares.janela_alavanca_dias} dias (${e.alavancasParadas.join(', ')}) — o cliente executa, mas não está puxando as alavancas que movem venda.`,
    cadeia: e => [
      { elo: `nenhuma tarefa de ${e.alavancasParadas.join('/')} em ${playbook.limiares.janela_alavanca_dias} dias`, tipo: 'fato' },
      { elo: 'a conta roda no modo manutenção — sem teste, sem campanha, sem otimização ativa', tipo: 'hipotese' },
      { elo: 'o teto de faturamento fica onde está (armadilha nº 3 do playbook: não replicar o sucesso)', tipo: 'hipotese' },
    ],
    falsificador: 'Se essas frentes são tocadas fora do Notion ou pelo próprio cliente, a cobertura existe — confirmar antes de propor; a jogada vira registrar o que já acontece.',
  },
  {
    k: 'consolidar', rotulo: 'Consolidar e escalar', emoji: '📈',
    quando: () => true,   // default: nenhum padrão crítico casou — o que NÃO é atestado de saúde
    tese: e => {
      const recuo = e.p28 > 0 && e.c28 < e.p28
      return `Nenhum padrão crítico casou nos dados: cadência ${e.c28} entregas/28d${e.p28 ? ` vs ${e.p28} anteriores${recuo ? ' (recuo abaixo do limiar de alerta — observar)' : ''}` : ''}, ${e.bloqueadas} bloqueada(s), ${e.dependencias} aguardando o cliente${e.alavancasParadas.length === 1 ? `, 1 alavanca parada (${e.alavancasParadas[0]})` : ''}. A jogada é proteger o ritmo, medir com o cliente (ritual de métricas) e preparar o próximo ciclo.`
    },
    cadeia: e => [
      { elo: `cadência ${e.c28} entregas/28d${e.p28 ? ` (vs ${e.p28} anteriores)` : ''}; ${e.bloqueadas} bloqueada(s), ${e.dependencias} aguardando o cliente`, tipo: 'fato' },
      { elo: 'com execução estável, o diferencial passa a ser leitura de dados e escala do que funciona', tipo: 'hipotese' },
    ],
    falsificador: (e, plano) => plano?.ml
      ? 'A leitura operacional está sã, mas é o faturamento conectado que valida a comercial — se as vendas caem com a operação em dia, o problema está na oferta, não na execução.'
      : 'Sem vendas/visitas conectadas, "nenhum padrão crítico" descreve a OPERAÇÃO (tarefas), não o faturamento — conectar o canal é o que valida a leitura comercial.',
  },
]

// ── estado observado AO VIVO do banco (o snapshot do plano envelhece; a tela não mistura épocas) ──
function estadoDe(reg, plano, acoes, serie, hoje) {
  const rows = db.prepare(`SELECT status, prazo, responsavel, SUBSTR(last_edited, 1, 10) ed
    FROM tarefas WHERE arquivada = 0 AND cliente = ? AND ${ABERTA_SQL} AND titulo NOT LIKE '%· PS-%'`).all(reg.cliente)
  const limParada = addDias(hoje, -playbook.limiares.dias_parada)
  const ultimaEntrega = Object.keys(serie).sort().at(-1) || null
  const diasSemEntrega = ultimaEntrega ? Math.round((new Date(hoje + 'T12:00:00') - new Date(ultimaEntrega + 'T12:00:00')) / 86400000) : null
  const regrasAtivas = new Set(acoes.filter(a => ['proposta', 'aprovada', 'distribuida'].includes(a.status)).map(a => a.regra))
  const alavancasParadas = Object.entries(playbook.alavancas).filter(([k]) => !k.startsWith('$') && regrasAtivas.has(`alavanca_${k}`)).map(([, a]) => a.rotulo.replace(/ \(.*\)$/, ''))
  const dep = dependenciasDe(reg.cliente, hoje)                     // fora de abertas: aguarda o cliente, não a equipe
  return {
    abertas: rows.length, bloqueadas: rows.filter(t => t.status === 'bloqueada').length,   // só impedimento interno
    dependencias: dep.todas.length, dependenciasVencidas: dep.vencidas.length,
    paradas: rows.filter(t => t.ed && t.ed < limParada && t.status !== 'bloqueada').length,
    semResponsavel: rows.filter(t => !t.responsavel).length, semPrazo: rows.filter(t => !t.prazo).length,
    c28: somaJanela(serie, addDias(hoje, -27), hoje), p28: somaJanela(serie, addDias(hoje, -55), addDias(hoje, -28)),
    diasSemEntrega, ultimaEntrega,
    consultor: reg.principal || '', temPlanoMes: !regrasAtivas.has('sem_plano_mes'),
    alavancasParadas, regrasAtivas,
  }
}

// ── pensamento crítico: qualidade da evidência, sinais mistos, vieses ───────
function criticar(e, plano, acoes, serie, hoje) {
  const abertasAcoes = acoes.filter(a => ['proposta', 'aprovada', 'distribuida'].includes(a.status))
  const fatos = abertasAcoes.filter(a => a.dados.evidencia_tipo === 'fato').length
  const fontesOk = (plano?.fontes || []).filter(f => f.status === 'disponivel').length
  const fontesTot = (plano?.fontes || []).length
  const alertas = []

  // sinal misto: tendência 7d × cadência 28d podem divergir — explicar, não esconder
  const t = tendencia(serie, hoje)
  const caiu28 = e.p28 > 0 && e.c28 < e.p28 * 0.9
  if (caiu28 && ['CRESCIMENTO', 'CRESCIMENTO FORTE'].includes(t.classe))
    alertas.push(`Sinal misto: os últimos 7 dias aceleram (×${t.indice}) dentro de um mês fraco (${e.c28} vs ${e.p28} entregas/28d) — pode ser recuperação recente; reavaliar na próxima semana antes de concluir queda.`)
  if (!caiu28 && e.p28 > 0 && ['QUEDA', 'QUEDA CRÍTICA'].includes(t.classe) && e.c28 >= e.p28)
    alertas.push(`Sinal misto: a última semana desacelerou (×${t.indice ?? 0}) embora o mês esteja ${e.c28 > e.p28 * 1.1 ? 'em alta' : 'estável'} (${e.c28} vs ${e.p28} entregas/28d) — pode ser ruído de curto prazo.`)

  // vieses de medição conhecidos
  if (e.abertas >= 5 && pct(e.semPrazo, e.abertas) >= 80)
    alertas.push(`${pct(e.semPrazo, e.abertas)}% das tarefas abertas sem prazo — "atraso" é invisível aqui; qualquer leitura de pontualidade é cega até preencherem o campo Prazo.`)
  const fonteTarefas = (plano?.fontes || []).find(f => f.fonte.includes('tarefas'))
  if (fonteTarefas?.nota) alertas.push(`Qualidade da fonte de tarefas: ${fonteTarefas.nota}.`)

  const confianca = abertasAcoes.length ? Math.round(100 * fatos / abertasAcoes.length) : 0
  return {
    evidencia: { acoes_abertas: abertasAcoes.length, baseadas_em_fato: fatos, pct_fato: confianca },
    plano_gerado_em: (plano?._gerado_em || '').slice(0, 10) || null,   // o estado é ao vivo; as AÇÕES vêm desta geração
    fontes: { disponiveis: fontesOk, total: fontesTot },
    sinais_mistos: alertas,
    limite: 'Leitura baseada na OPERAÇÃO (Notion)' + (plano?.ml ? ' e nas vendas do canal conectado.' : '; vendas, Ads e estoque ainda não conectados — a leitura comercial depende deles.'),
  }
}

// ── o melhor caminho: jogadas ordenadas pela escada ─────────────────────────
function caminho(acoes, arquetipo) {
  const abertas = acoes.filter(a => ['proposta', 'aprovada'].includes(a.status))
    // score gravado pelo plano (0–100, já com o fator do Merovíngio) manda; prioridadeAcao só para ação sem score — mesma ordem que /planos
    .map(a => ({ ...a, _p: { nota: Number.isFinite(a.score) ? a.score : prioridadeAcao(a).nota, p: a.dados?.prioridade?.p || prioridadeAcao(a).p }, _estagio: estagioDe(a.regra) }))
  const jogadas = []
  for (const est of ESTAGIOS) {
    const doEstagio = abertas.filter(a => a._estagio === est.k).sort((x, y) => y._p.nota - x._p.nota)
    if (!doEstagio.length) continue
    jogadas.push({
      estagio: est.k, rotulo: est.rotulo, porque_antes: est.porque,
      acoes: doEstagio.slice(0, 4).map(a => ({ id: a.id, titulo: a.titulo, p: a._p.p, nota: a._p.nota, prazo: a.prazo, responsavel: a.responsavel, status: a.status })),
      mais: Math.max(0, doEstagio.length - 4),
    })
  }
  return {
    jogadas: jogadas.slice(0, 3),                      // o Merovíngio aponta 3 jogadas, não 10
    jogadas_futuras: jogadas.slice(3).map(j => ({ estagio: j.estagio, rotulo: j.rotulo, n: j.acoes.length + j.mais })),
    regra_de_ouro: arquetipo.k === 'destravar' || arquetipo.k === 'retomar_ritmo'
      ? 'Enquanto a jogada 1 não andar, as seguintes não compram resultado — executar em ordem.'
      : 'As jogadas podem andar em paralelo, mas a 1 é a que mais move o ponteiro agora.',
  }
}

// ── leitura de UM cliente ───────────────────────────────────────────────────
export function lerCliente({ reg, plano, acoes, hoje = hojeLocal() }) {
  if (!plano) {
    const temBase = db.prepare('SELECT COUNT(*) n FROM tarefas WHERE arquivada = 0 AND cliente = ?').get(reg.cliente).n > 0
    return {
      sem_leitura: true,
      motivo: temBase
        ? 'O plano deste cliente ainda não foi gerado — o Merovíngio não opina sobre o que não analisou. Gere o plano no painel de distribuição.'
        : 'Cliente sem base de tarefas sincronizada — sincronize o Notion (ou confirme o nome da base) antes de qualquer leitura.',
    }
  }
  const entregas = db.prepare(`SELECT COALESCE(NULLIF(data_conclusao, ''), SUBSTR(last_edited, 1, 10)) d
    FROM tarefas WHERE arquivada = 0 AND status = 'concluida' AND cliente = ? AND titulo NOT LIKE '%· PS-%'`).all(reg.cliente).map(r => r.d)
  const serie = serieDiaria(entregas)
  const e = estadoDe(reg, plano, acoes, serie, hoje)
  const arq = ARQUETIPOS.find(a => a.quando(e))
  const renov = statusRenovacao(reg.vencimentos, hoje)
  return {
    arquetipo: { k: arq.k, rotulo: arq.rotulo, emoji: arq.emoji, tese: arq.tese(e) },
    cadeia_causal: arq.cadeia(e).filter(x => x.elo),
    renovacao_no_relogio: renov.alerta.length ? `Contrato ${renov.alerta[0].canal} ${renov.alerta[0].dias >= 0 ? `vence em ${renov.alerta[0].dias} dia(s)` : `vencido há ${-renov.alerta[0].dias} dia(s)`} — a renovação entra na frente de qualquer jogada de médio prazo.` : null,
    critica: criticar(e, plano, acoes, serie, hoje),
    falsificador: typeof arq.falsificador === 'function' ? arq.falsificador(e, plano) : arq.falsificador,
    caminho: caminho(acoes, arq),
  }
}

// ── padrões da BASE (visão da liderança): onde o sistema inteiro trava ──────
export function padroesDaBase({ hoje = hojeLocal() } = {}) {
  const q = (sql, ...p) => db.prepare(sql).all(...p)
  // contas do Place Sprint 90 (sem responsável/squad por desenho) ficam fora dos padrões da liderança (A11, revisão de 08/10)
  const abertasSql = `status IN ('proposta','aprovada','distribuida') AND ${NAO_S90_SQL}`
  const porRegra = q(`SELECT regra, COUNT(*) n, COUNT(DISTINCT cliente) clientes FROM acoes_plano WHERE ${abertasSql} GROUP BY regra ORDER BY clientes DESC`)
  const totalClientes = q(`SELECT COUNT(DISTINCT cliente) n FROM acoes_plano WHERE ${abertasSql}`)[0].n
  // padrão sistêmico: a mesma regra em ≥35% da base é problema de PROCESSO, não de cliente
  const SISTEMICO = {
    sem_plano_mes: 'O ritual de planejamento mensal não está acontecendo como processo — atacar no ritual do time (template + cobrança na segunda), não cliente a cliente.',
    sem_responsavel: 'Tarefa nasce sem dono como padrão — tornar o campo Responsável obrigatório no template de card resolve na origem.',
    backlog_parado: 'Backlog parado generalizado — instituir a revisão quinzenal de backlog por consultor (executar/reprogramar/cancelar) como rotina.',
    calendario: 'Sazonalidade no relógio da base inteira — tratar Black Friday/Natal como projeto coletivo do squad, com padrão único de checklist.',
    bloqueio_cliente: 'Dependência de devolutiva de cliente em escala — padronizar o follow-up dos dias 3-5/7-8 (playbook §05) e prazo-limite de resposta.',
    bloqueio_interno: 'Impedimento interno em escala — a causa é de processo (acesso, ferramenta, briefing ou capacidade): levantar o motivo mais frequente com os líderes e atacar na origem, não card a card.',
    renovacao: 'Onda de contratos vencendo — alinhar com o CS a fila de renovações e preparar as revisões de evolução em lote.',
  }
  // calendario fica FORA dos padrões de falha: dispara p/ todo cliente por construção na janela
  // sazonal (Black Friday/Natal) — é coordenação coletiva, não processo quebrado
  const sistemicos = porRegra.filter(r => r.regra !== 'calendario' && SISTEMICO[r.regra] && pct(r.clientes, totalClientes) >= 35)
    .map(r => ({ regra: r.regra, clientes: r.clientes, pct: pct(r.clientes, totalClientes), leitura: SISTEMICO[r.regra] }))
  const cal = porRegra.find(r => r.regra === 'calendario')
  const sazonalidade = cal ? { clientes: cal.clientes, leitura: SISTEMICO.calendario } : null
  // renovações recomputadas HOJE da central (o título da ação congela "vence em N dias" na geração)
  const vencendo = q(`SELECT DISTINCT a.cliente, c.vencimentos_json FROM acoes_plano a
    JOIN clientes_central c ON c.cliente = a.cliente WHERE a.status IN ('proposta','aprovada','distribuida') AND a.cliente NOT LIKE '[S90] %' AND a.regra='renovacao'`)
    .flatMap(r => statusRenovacao(JSON.parse(r.vencimentos_json || '{}'), hoje).alerta.map(x => ({ cliente: r.cliente, canal: x.canal, data: x.data, dias: x.dias })))
    .sort((a, b) => a.dias - b.dias).slice(0, 12)
  const cargaSquad = q(`SELECT COALESCE(NULLIF(squad,''),'(sem squad)') squad, COUNT(*) n, COUNT(DISTINCT cliente) clientes,
    SUM(CASE WHEN horizonte='72h' THEN 1 ELSE 0 END) urgentes FROM acoes_plano WHERE ${abertasSql} GROUP BY 1 ORDER BY n DESC`)
  return {
    gerado_em: hoje, clientes_com_acoes: totalClientes,
    padroes_sistemicos: sistemicos,
    leitura: sistemicos.length
      ? `A base repete o mesmo padrão em escala: ${sistemicos.map(s => `${s.regra} (${s.clientes} clientes)`).join(', ')} — causa de processo, não ${totalClientes} causas individuais. Corrigir o processo remove dezenas de ações de uma vez.`
      : 'Nenhum padrão sistêmico acima de 35% da base — os problemas são majoritariamente locais, cliente a cliente.',
    sazonalidade,
    renovacoes_no_relogio: vencendo,
    carga_por_squad: cargaSquad,
  }
}
