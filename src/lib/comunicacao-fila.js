// Comunicação em esteira — F1 (docs/desenho-comunicacao-esteira.md § 1, § 1.4 e § 0; 22/10/2026). PURO (nenhum import; lerFontes recebe o handle): recebe as linhas JÁ LIDAS das tabelas que existem
// (gatilho_lote, gatilho_cliente, relatorio_envio, relatorio_programacao, alerta_cliente, consultor_aviso, exec_ordem, incidente; recibos = recibos_json/recibo_json)
// e devolve cada item com estágio (Capturado → Redigido → Auditado → Liberado → Enviado → Recibo) e estado (7, lista fechada) com «o que falta».
// Projeção, nunca um segundo motor: não decide, não grava, não envia. Faixas Cliente × Time separadas AQUI (servidor): a faixa Cliente só leva campos da lista
// fechada de item() — nunca itens_json/ids/payload. Prospect «[Comercial] …» nunca entra (D15). As 11 decisões da § 9 não são tomadas aqui: «Enviado» continua
// sendo o recibo que a tabela já grava (sem prazo de «sem recibo», decisão 8) e o gate só MOSTRA banco × arquivo (decisão 1).
export const ESTAGIOS = Object.freeze(['Capturado', 'Redigido', 'Auditado', 'Liberado', 'Enviado', 'Recibo'])
export const ESTADOS = Object.freeze(['aguardando', 'falhou', 'processando', 'prontos', 'pausado', 'nao_elegivel', 'enviado'])   // ordem da fila
export const ROTULO_ESTADO = Object.freeze({ processando: 'Processando', aguardando: 'Aguardando você', prontos: 'Prontos', enviado: 'Enviado', falhou: 'Falhou', pausado: 'Pausado', nao_elegivel: 'Não elegível' })
export const HISTORICO = Object.freeze(['enviado', 'pausado', 'nao_elegivel'])   // § 2: ficam no Histórico, recolhido
export const CAMPOS_ITEM = Object.freeze(['id', 'fonte', 'faixa', 'cliente', 'sistema', 'mensagem', 'canal', 'estado', 'estagio', 'estagios', 'motivo', 'falta', 'desde', 'acao', 'historico', 'marca', 'previa'])

const MOTIVO = {
  n8n_nao_configurado: 'entregador n8n não configurado', entrega_falhou: 'o canal não confirmou a entrega', recibo_falhou: 'o canal devolveu recibo de falha',
  sem_destino: 'sem destino cadastrado («Webhook ML» na central)', cooldown: 'intervalo mínimo entre avisos (cooldown)', repeticao: 'o mesmo ponto saiu há pouco',
  fora_da_janela: 'fora da janela de envio', nao_liberado: 'cliente sem liberação do líder', sem_confirmacao_atual: 'pendência sem confirmação atual', sem_confirmacao: 'pendência sem confirmação',
  vazio: 'nada a relatar no período', lote_vencido: 'o lote do dia anterior venceu e os pontos voltaram à fila', conteudo_mudou: 'o texto mudou depois da prévia',
  assessoria: 'trabalho da assessoria: aviso só para a equipe', origem_nao_verificada: 'mudança de preço sem origem verificada fora da Place2u: só para a equipe',
  sem_base: 'cliente sem base Informações no Notion', destino_compartilhado: 'destino compartilhado com outro cliente', resolvido: 'condição resolvida',
}
export const textoMotivo = m => {
  const s = String(m || ''); if (!s) return ''
  if (MOTIVO[s]) return MOTIVO[s]
  if (s.startsWith('conteudo:')) return `barrado pelo auditor de texto (${s.slice(9)})`
  if (s.startsWith('teto')) return 'teto de envios atingido'
  const http = s.match(/^(n8n|notion)_(\d{3})$/); if (http) return `o ${http[1] === 'n8n' ? 'n8n' : 'Notion'} respondeu ${http[2]}`
  return `código «${s}» (ainda sem texto no dicionário)`
}

const parse = (t, d) => { try { const v = JSON.parse(t || ''); return v && typeof v === 'object' ? v : d } catch { return d } }
const ate = n => Array.from({ length: n }, (_, i) => i + 1)
// estágios: feitos = números 1..6 cumpridos; na = «—» (interno não tem Auditado/Liberado); barrado = estágio que o auditor reprovou
function est(feitos, { na = [], barrado = 0, em = {} } = {}) {
  const f = new Set(feitos)
  return ESTAGIOS.map((nome, i) => { const n = i + 1; return { nome, s: na.includes(n) ? 'na' : n === barrado ? 'barrado' : f.has(n) ? 'feito' : 'falta', ...(em[n] ? { em: em[n] } : {}) } })
}
function item(o) {
  const ult = [...o.estagios].reverse().find(e => e.s === 'feito')
  return { id: o.id, fonte: o.fonte, faixa: o.faixa, cliente: o.cliente || '', sistema: o.sistema, mensagem: o.mensagem, canal: o.canal || '', estado: o.estado, estagio: ult ? ult.nome : '',
    estagios: o.estagios, motivo: textoMotivo(o.motivo), falta: o.falta || '', desde: o.desde || '', acao: o.acao || null, historico: HISTORICO.includes(o.estado), marca: o.marca || '', previa: String(o.previa || '').slice(0, 200) }
}
const rotuloTipo = t => String(t || '').replace(/_/g, ' ')
const liberadoTxt = l => l?.liberado_por ? `liberado por ${l.liberado_por}` : l?.auto ? 'liberado pela regra gravada do urgente' : ''

// ações: SÓ rotas de escrita que já existem (src/rotas-gatilhos.js, src/rotas-relatorio.js, src/rotas-alertas.js); previa:true = a tela chama sem confirmar antes
const ACAO = {
  liberarCliente: c => ({ rotulo: 'Liberar cliente', rota: '/api/gatilhos/liberar', corpo: { clientes: [c] }, previa: false }),
  liberarRelatorio: c => ({ rotulo: 'Liberar relatório', rota: '/api/relatorio/liberar', corpo: { clientes: [c] }, previa: true }),
  reenviarRelatorio: c => ({ rotulo: 'Reenviar', rota: '/api/relatorio/enviar', corpo: { cliente: c }, previa: true }),
  reenviarAlerta: id => ({ rotulo: 'Reenviar', rota: '/api/alertas/enviar', corpo: { id }, previa: true }),
  reenviarLote: (c, l) => ({ rotulo: 'Reenviar', rota: '/api/gatilhos/enviar', corpo: { cliente: c, lote_id: l.id, tipo: l.tipo }, previa: true }),
}

const MSG_LOTE = { semanal: 'Plano da semana', imediato: 'Ponto importante (urgente)', compras: 'Micro-relatório de compras', teste: 'Teste de canal', diario: 'Lote diário (antigo)' }
function deLote(l, lib) {
  const c = l.cliente, recibos = parse(l.recibos_json, {}), canais = parse(l.canais_json, []), libLote = l.origem === 'manual' && l.por ? `enviado manualmente por ${l.por}` : liberadoTxt(lib[c])
  const reciboEm = Object.values(recibos).map(r => r?.em).filter(Boolean).sort().pop() || ''
  const base = { id: `lote:${l.id}`, fonte: 'gatilho_lote', faixa: 'cliente', cliente: c, sistema: 'morpheus', mensagem: MSG_LOTE[l.tipo] || rotuloTipo(l.tipo), canal: canais.join(' · '),
    desde: l.enviado_em || l.tentado_em || l.criado_em, marca: l.tipo === 'teste' ? 'teste' : l.tipo === 'compras' ? 'script' : '' }
  const em = { 1: l.criado_em, 5: l.enviado_em, 6: reciboEm }
  switch (l.estado) {
    case 'montado': return item({ ...base, estado: 'processando', estagios: est(ate(3), { em }), falta: 'sai no próximo tick de envio' })
    case 'pendente': return l.motivo === 'n8n_nao_configurado'
      ? item({ ...base, estado: 'falhou', motivo: l.motivo, estagios: est(ate(4), { em }), falta: 'configurar o entregador n8n (Estrutura › Estruturas)' })
      : item({ ...base, estado: 'prontos', motivo: l.motivo, estagios: est(ate(4), { em }), falta: `esperando a janela de envio${libLote ? ' · ' + libLote : ''}` })
    case 'enviado': return item({ ...base, estado: 'processando', estagios: est(ate(5), { em }), falta: 'esperando o recibo do canal (o prazo de «sem recibo» ainda não foi decidido)' })
    case 'entregue': return item({ ...base, estado: 'enviado', estagios: est(ate(6), { em }), falta: libLote })
    case 'parcial': case 'falhou': return item({ ...base, estado: 'falhou', motivo: l.motivo || (l.estado === 'parcial' ? 'entrega_falhou' : ''), estagios: est(l.estado === 'parcial' ? ate(5) : ate(4), { em }),
      falta: 'reenviar (vai só aos canais sem entrega)', acao: ACAO.reenviarLote(c, l) })
    default: return null
  }
}

// ponto do gatilho: «entregue» e «resolvido depois de entregue» não entram (o lote que os levou já é o item: um fato, um item — D9)
function dePonto(g, lib) {
  const c = g.cliente, L = lib[c], liberado = !!(L?.liberado_por || L?.auto)
  const base = { id: `ponto:${g.id}`, fonte: 'gatilho_cliente', faixa: 'cliente', cliente: c, sistema: 'morpheus', mensagem: `Ponto: ${rotuloTipo(g.tipo)}`, canal: parse(g.canais_json, []).join(' · '),
    desde: g.atualizado_em || g.criado_em, previa: g.texto }
  const em = { 1: g.criado_em, 5: g.enviado_em }
  if (g.estado === 'interno') return item({ ...base, faixa: 'time', mensagem: `Só para a equipe: ${rotuloTipo(g.tipo)}`, canal: 'sino da equipe', previa: '', estado: 'aguardando', motivo: g.motivo,
    estagios: est(ate(2), { na: [3, 4], em }), falta: 'consultor ou líder trata; sai da fila quando a condição some (não há botão «feito» hoje)' })
  const semLib = { estado: 'aguardando', estagios: est(ate(3), { em }), falta: 'liberar o cliente (o plano de terça exige a liberação do líder)', acao: ACAO.liberarCliente(c) }
  const m = String(g.motivo || '')
  switch (g.estado) {
    case 'pendente':
      if (/^(cooldown|teto|repeticao)/.test(m)) return item({ ...base, estado: 'pausado', motivo: m, estagios: est(ate(3), { em }), falta: 'volta sozinho quando o intervalo acabar' })
      if (m.startsWith('conteudo:')) return item({ ...base, estado: 'aguardando', motivo: m, estagios: est(ate(2), { barrado: 3, em }), falta: 'corrigir o texto e liberar de novo (ninguém libera texto barrado)' })
      if (m === 'n8n_nao_configurado' || m === 'entrega_falhou') return item({ ...base, estado: 'falhou', motivo: m, estagios: est(ate(4), { em }), falta: 'configurar o entregador n8n e reenviar pelo lote' })
      return liberado ? item({ ...base, estado: 'processando', motivo: m, estagios: est(ate(4), { em }), falta: `entra no próximo plano de terça · ${liberadoTxt(L)} (o motivo da espera ainda não é gravado)` }) : item({ ...base, motivo: m || 'nao_liberado', ...semLib })
    case 'agrupado': return liberado ? item({ ...base, estado: 'prontos', estagios: est(ate(4), { em }), falta: `sai no plano da semana (terça, fuso do cliente) · ${liberadoTxt(L)}` }) : item({ ...base, motivo: 'nao_liberado', ...semLib })
    case 'enviado': return item({ ...base, estado: 'processando', estagios: est(ate(5), { em }), falta: 'esperando o recibo do canal' })
    case 'suprimido': return item({ ...base, estado: /^(cooldown|teto|repeticao)/.test(m) ? 'pausado' : 'nao_elegivel', motivo: m, estagios: est(ate(2), { em }) })
    case 'falhou': return item({ ...base, estado: 'falhou', motivo: m, estagios: est(ate(4), { em }), falta: 'reenviar pelo lote do cliente' })
    case 'resolvido': return g.entregue_em ? null : item({ ...base, estado: 'nao_elegivel', motivo: 'resolvido', estagios: est(ate(2), { em }), falta: 'a condição sumiu antes de sair' })
    default: return null
  }
}

function deEnvioRelatorio(r) {
  const base = { id: `relatorio:${r.id}`, fonte: 'relatorio_envio', faixa: 'cliente', cliente: r.cliente, sistema: 'morpheus', mensagem: `Relatório de Sprints ${r.de} a ${r.ate}`, canal: 'Notion', desde: r.em }
  const lib = r.origem === 'agendado' ? 'agendado: só sai a quem um líder liberou' : r.por ? `manual por ${r.por}` : ''
  const em = { 5: r.em, 6: r.em }
  switch (r.estado) {
    case 'enviado': case 'adotado': return item({ ...base, estado: 'enviado', estagios: est(ate(6), { em }), falta: lib })
    case 'falhou': return item({ ...base, estado: 'falhou', motivo: r.motivo, estagios: est(ate(4), { em: {} }), falta: 'reenviar com prévia', acao: ACAO.reenviarRelatorio(r.cliente) })
    case 'bloqueado':
      if (r.motivo === 'vazio') return item({ ...base, estado: 'nao_elegivel', motivo: r.motivo, estagios: est(ate(1)) })
      return String(r.motivo).startsWith('conteudo:') ? item({ ...base, estado: 'aguardando', motivo: r.motivo, estagios: est(ate(2), { barrado: 3 }), falta: 'corrigir o conteúdo e reenviar com prévia' })
        : item({ ...base, estado: 'aguardando', motivo: r.motivo, estagios: est(ate(2)), falta: 'resolver o destino no Notion (Planos › Relatórios) e reenviar com prévia' })
    case 'arquivado': return item({ ...base, estado: 'nao_elegivel', motivo: 'arquivado', estagios: est(ate(6), { em }) })
    default: return null
  }
}

function deProgramacao(p) {
  const base = { id: `programacao:${p.cliente}`, fonte: 'relatorio_programacao', faixa: 'cliente', cliente: p.cliente, sistema: 'morpheus', mensagem: `Próximo relatório de Sprints (${p.frequencia})`, canal: 'Notion', desde: p.atualizado_em }
  const em = { 1: p.atualizado_em, 4: p.ativado_em }
  if (p.frequencia === 'desligado') return item({ ...base, estado: 'nao_elegivel', motivo: 'desligado', estagios: est([]), falta: 'envio automático desligado para este cliente' })
  if (!p.ativado_por) return item({ ...base, estado: 'aguardando', motivo: 'nao_liberado', estagios: est(ate(1), { em }), falta: 'liberar a programação (o texto é montado e auditado na hora do envio)', acao: ACAO.liberarRelatorio(p.cliente) })
  if (p.pausado_motivo) return item({ ...base, estado: 'pausado', motivo: p.pausado_motivo, estagios: est([1, 4], { em }), falta: 'resolver o motivo da pausa em Planos › Relatórios' })
  if (Number(p.falhas_seguidas) > 0) return item({ ...base, estado: 'falhou', motivo: `${p.falhas_seguidas} falha(s) seguida(s)`, estagios: est([1, 4], { em }),
    falta: p.tentar_apos ? `nova tentativa automática depois de ${p.tentar_apos.slice(0, 16).replace('T', ' ')}` : 'reenviar com prévia', acao: ACAO.reenviarRelatorio(p.cliente) })
  return item({ ...base, estado: 'prontos', estagios: est([1, 4], { em }), falta: `próximo envio em ${p.proximo_envio || '—'} (o texto é montado e auditado na hora)` })
}

function deAlerta(a) {
  const base = { id: `alerta:${a.id}`, fonte: 'alerta_cliente', faixa: 'cliente', cliente: a.cliente, sistema: 'morpheus', mensagem: `Alerta de pendência: ${a.rotulo || a.item}${a.canal_rotulo ? ' (' + a.canal_rotulo + ')' : ''}`,
    canal: 'Notion', desde: a.atualizado_em || a.criado_em }
  const em = { 1: a.criado_em, 5: a.enviado_em, 6: a.enviado_em }, m = String(a.motivo || '')
  switch (a.estado) {
    case 'pendente':
      if (m === 'nao_liberado') return item({ ...base, estado: 'aguardando', motivo: m, estagios: est(ate(1), { em }), falta: 'liberar o relatório do cliente (o alerta segue essa liberação) ou enviar manual com prévia em Planos › Alertas', acao: ACAO.liberarRelatorio(a.cliente) })
      if (m.startsWith('sem_confirmacao')) return item({ ...base, estado: 'aguardando', motivo: m, estagios: est(ate(1), { em }), falta: 'confirmar a pendência ou enviar manual com prévia em Planos › Alertas' })
      return item({ ...base, estado: 'pausado', motivo: m, estagios: est(ate(1), { em }), falta: m === 'fora_da_janela' ? 'sai na abertura da janela' : 'volta sozinho quando o intervalo acabar' })
    case 'enviado': return item({ ...base, estado: 'enviado', estagios: est(ate(6), { em }), falta: a.origem === 'manual' && a.por ? `manual por ${a.por}` : '' })
    case 'bloqueado': return item({ ...base, estado: 'aguardando', motivo: m, estagios: est(ate(2), m.startsWith('conteudo:') ? { barrado: 3, em } : { em }), falta: 'resolver o bloqueio e reenviar com prévia', acao: ACAO.reenviarAlerta(a.id) })
    case 'falhou': return item({ ...base, estado: 'falhou', motivo: m, estagios: est(ate(4), { em }), falta: a.tentar_apos ? `nova tentativa depois de ${a.tentar_apos.slice(0, 16).replace('T', ' ')}` : 'reenviar com prévia', acao: ACAO.reenviarAlerta(a.id) })
    case 'suprimido': return item({ ...base, estado: 'nao_elegivel', motivo: m, estagios: est(ate(1), { em }) })
    case 'resolvido': return item({ ...base, estado: 'nao_elegivel', motivo: 'resolvido', estagios: est(a.enviado_em ? ate(6) : ate(1), { em }), falta: a.enviado_em ? 'saiu e depois foi resolvido' : 'a condição sumiu antes de sair' })
    default: return null
  }
}

function deConsultor(a) {
  const base = { id: `consultor:${a.id}`, fonte: 'consultor_aviso', faixa: 'time', cliente: a.cliente, sistema: 'morpheus', mensagem: a.tipo === 'interno_imediato' ? `Urgente interno ao consultor: ${rotuloTipo(a.chave)}` : `Resumo de terça ao consultor (${a.chave})`,
    canal: 'Discord', desde: a.enviado_em || a.tentado_em || a.criado_em }
  const reciboEm = parse(a.recibo_json, {})?.discord?.em || '', em = { 1: a.criado_em, 5: a.enviado_em, 6: reciboEm }, na = [3, 4], m = String(a.motivo || '')
  const semBotao = 'reenvio manual ainda não tem botão (F8 do desenho)'
  switch (a.estado) {
    case 'montado': return item({ ...base, estado: 'processando', estagios: est(ate(2), { na, em }), falta: 'sai no próximo tick (terça 08:30)' })
    case 'pendente':
      if (m === 'sem_destino') return item({ ...base, estado: 'aguardando', motivo: m, estagios: est(ate(2), { na, em }), falta: 'cadastrar o «Webhook ML» do cliente na central do Notion' })
      if (m) return item({ ...base, estado: 'falhou', motivo: m, estagios: est(ate(2), { na, em }), falta: semBotao })
      return item({ ...base, estado: 'prontos', estagios: est(ate(2), { na, em }), falta: 'sai na janela de terça' })
    case 'enviado': return item({ ...base, estado: 'processando', estagios: est([1, 2, 5], { na, em }), falta: 'esperando o recibo do Discord' })
    case 'entregue': return item({ ...base, estado: 'enviado', estagios: est([1, 2, 5, 6], { na, em }) })
    case 'falhou': return item({ ...base, estado: 'falhou', motivo: m, estagios: est(m === 'recibo_falhou' ? [1, 2, 5] : [1, 2], { na, em }), falta: semBotao })
    default: return null
  }
}

function deOrdem(o) {
  const base = { id: `ordem:${o.id}`, fonte: 'exec_ordem', faixa: 'time', cliente: o.cliente, sistema: 'chaveiro', mensagem: `Ordem ${rotuloTipo(o.operacao)} · regra ${rotuloTipo(o.regra)}`, canal: 'Mercado Livre', desde: o.atualizado_em || o.criado_em }
  const em = { 1: o.criado_em, 4: o.aprovado_em, 5: o.executado_em, 6: o.conferido_em }, na = [2, 3], onde = 'a ação fica em Execução › Execução no ML'
  switch (o.estado) {
    case 'preparada': return item({ ...base, estado: 'processando', estagios: est(ate(1), { na, em }), falta: onde })
    case 'aguardando_aprovacao': return item({ ...base, estado: 'aguardando', estagios: est(ate(1), { na, em }), falta: `aprovação do líder · ${onde}` })
    case 'aprovada': return item({ ...base, estado: 'processando', estagios: est([1, 4], { na, em }), falta: `aprovada${o.aprovado_por ? ' por ' + o.aprovado_por : ''}; espera a execução · ${onde}` })
    case 'executando': case 'em_conferencia': return item({ ...base, estado: 'processando', estagios: est([1, 4, 5], { na, em }), falta: 'conferência por releitura do anúncio' })
    case 'executada': return item({ ...base, estado: 'enviado', estagios: est([1, 4, 5, 6], { na, em }) })
    case 'divergente': case 'falhou': return item({ ...base, estado: 'falhou', motivo: o.estado, estagios: est(o.executado_em ? [1, 4, 5] : [1, 4], { na, em }), falta: onde })
    case 'recusada': case 'cancelada': case 'obsoleta': return item({ ...base, estado: 'nao_elegivel', motivo: o.estado, estagios: est(ate(1), { na, em }) })
    default: return null
  }
}

function deIncidente(i) {
  const base = { id: `incidente:${i.id}`, fonte: 'incidente', faixa: 'time', cliente: '', sistema: i.sistema || 'trinity', mensagem: `Incidente: ${i.rotulo || i.sinal_id}`, canal: 'sino da equipe', desde: i.aberto_em }
  const em = { 1: i.aberto_em }, na = [3, 4]
  if (i.estado === 'resolvido') return item({ ...base, estado: 'nao_elegivel', motivo: 'resolvido', estagios: est(ate(1), { na, em }), falta: i.resolvido_em ? `resolvido em ${i.resolvido_em.slice(0, 16).replace('T', ' ')}` : '' })
  return item({ ...base, estado: i.nivel === 'critico' ? 'aguardando' : 'processando', motivo: i.nivel === 'critico' ? 'crítico' : 'atenção', estagios: est(ate(1), { na, em }),
    falta: `dono: ${i.dono || '—'}; fecha sozinho depois de leituras normais seguidas · Conexões › Saúde do sistema` })
}

// ── Gate (§ 0): estado real de cada interruptor, banco (sync_estado) × arquivo (config carregado). SÓ MOSTRA: nada aqui liga, desliga ou bloqueia envio.
// conflito = os dois existem e divergem. Hoje a chave gravada no banco vence o padrão do arquivo (o arquivo só vale enquanto a chave nunca foi gravada).
const g = (o, caminho) => caminho.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o)
const INTERRUPTORES = [
  { id: 'gatilhos_ligado', nome: 'Plano de terça ao cliente (WhatsApp)', faixa: 'cliente', banco: 'gatilhos_ligado', arquivo: null },
  { id: 'urgente_na_hora', nome: 'Urgente de estoque/preço na hora', faixa: 'cliente', banco: null, arquivo: ['gatilhos', 'urgente.na_hora_ligado', 'config/gatilhos.json'], nota: 'o briefing de 12/10 dizia desligado; ligado por decisão de 14/10 (decisão 3 do desenho)' },
  { id: 'relatorio_agendador', nome: 'Relatório no Notion automático', faixa: 'cliente', banco: 'relatorio_agendador', arquivo: ['relatorio_envio', 'agendador_ligado', 'config/relatorio-envio.json'] },
  { id: 'alerta_auto', nome: 'Alerta de pendência crítica no Notion', faixa: 'cliente', banco: 'alerta_auto', arquivo: ['alerta', 'automatico_ligado', 'config/alerta-cliente.json'] },
  { id: 'consultor_discord_ligado', nome: 'Resumo de terça ao consultor (Discord)', faixa: 'time', banco: 'consultor_discord_ligado', arquivo: null },
  { id: 'consultor_urgente', nome: 'Urgente interno ao consultor', faixa: 'time', banco: null, arquivo: ['gatilhos', 'consultor.urgente_ligado', 'config/gatilhos.json'] },
  { id: 'dossie_mensal_ligado', nome: 'Prestação de contas mensal (#growth)', faixa: 'time', banco: 'dossie_mensal_ligado', arquivo: null },
  { id: 'whatsapp_critico', nome: 'WhatsApp do Head no incidente crítico', faixa: 'time', banco: null, arquivo: ['autogestao', 'whatsapp_critico_ligado', 'config/autogestao.json'] },
]
export function montarGate({ estado = {}, configs = {} } = {}) {
  return INTERRUPTORES.map(d => {
    const vb = d.banco ? estado[d.banco] : undefined, banco = vb == null ? null : vb === 'ligado'
    const va = d.arquivo ? g(configs[d.arquivo[0]], d.arquivo[1]) : undefined, arquivo = typeof va === 'boolean' ? va : null
    const [por = '', desde = ''] = d.banco ? String(estado[`${d.banco}_por`] || '').split(' · ') : []
    const conflito = banco != null && arquivo != null && banco !== arquivo
    const efeito = banco != null ? banco : arquivo === true
    return { id: d.id, nome: d.nome, faixa: d.faixa, banco, banco_chave: d.banco ? `sync_estado.${d.banco}` : '', banco_por: por.trim(), banco_desde: desde.trim().slice(0, 10),
      arquivo, arquivo_chave: d.arquivo ? `${d.arquivo[2]} → ${d.arquivo[1]}` : '', efeito, conflito,
      nota: [conflito ? 'banco e arquivo divergem: hoje vale o banco (decisão 1 do desenho)' : '', banco == null && d.banco && arquivo == null ? 'chave nunca gravada: nasce desligada' : '', d.nota || ''].filter(Boolean).join(' · ') }
  })
}

export const DIAS_HISTORICO = 30   // ponytail: corte fixo do histórico; paginação/filtros do Histórico são a F8 do desenho

export const SQL = {
  gatilho_lote: "SELECT id, cliente, tipo, estado, motivo, origem, por, canais_json, recibos_json, criado_em, tentado_em, enviado_em FROM gatilho_lote WHERE estado <> 'entregue' OR criado_em >= ?",
  gatilho_cliente: "SELECT id, cliente, tipo, estado, motivo, lote_id, canais_json, texto, criado_em, atualizado_em, enviado_em, entregue_em, resolvido_em FROM gatilho_cliente WHERE estado NOT IN ('entregue','resolvido') OR (estado = 'resolvido' AND entregue_em = '' AND resolvido_em >= ?)",
  relatorio_envio: 'SELECT id, cliente, de, ate, origem, estado, motivo, por, em FROM relatorio_envio WHERE em >= ?',
  relatorio_programacao: 'SELECT cliente, frequencia, proximo_envio, ativado_por, ativado_em, tentar_apos, falhas_seguidas, pausado_motivo, atualizado_em FROM relatorio_programacao',
  alerta_cliente: "SELECT id, cliente, item, rotulo, canal_rotulo, estado, motivo, origem, por, tentar_apos, criado_em, atualizado_em, enviado_em, resolvido_em FROM alerta_cliente WHERE estado <> 'resolvido' OR resolvido_em >= ?",
  consultor_aviso: "SELECT id, cliente, tipo, chave, estado, motivo, criado_em, tentado_em, enviado_em, recibo_json FROM consultor_aviso WHERE estado <> 'entregue' OR criado_em >= ?",
  exec_ordem: "SELECT id, cliente, regra, operacao, estado, aprovado_por, aprovado_em, executado_em, conferido_em, criado_em, atualizado_em FROM exec_ordem WHERE estado NOT IN ('executada','recusada','cancelada','obsoleta') OR atualizado_em >= ?",
  incidente: "SELECT id, sinal_id, sistema, rotulo, nivel, estado, dono, aberto_em, resolvido_em FROM incidente WHERE estado = 'aberto' OR resolvido_em >= ?",
}

// leitura (só SELECT) num handle better-sqlite3 INJETADO — este módulo não abre banco; a fiação está em comunicacao-fila-real.js
export function lerFontes(handle, agoraMs = Date.now()) {
  const corte = new Date(agoraMs - DIAS_HISTORICO * 864e5).toISOString()
  const fontes = {}
  for (const [t, sql] of Object.entries(SQL)) { try { const st = handle.prepare(sql); fontes[t] = sql.includes('?') ? st.all(corte) : st.all() } catch { fontes[t] = null } }
  const liberacao = {}
  try {
    for (const r of handle.prepare("SELECT cliente, notificacao_json FROM clientes_central WHERE notificacao_json <> ''").all()) {
      let n = {}; try { n = JSON.parse(r.notificacao_json) || {} } catch { n = {} }
      liberacao[r.cliente] = { liberado_por: typeof n.liberado_por === 'string' ? n.liberado_por : '', auto: !!n.auto_liberado?.regra && n.auto_bloqueado !== true }
    }
  } catch { /* sem central: ninguém liberado (honesto: os pontos aparecem como «Aguardando você») */ }
  return { fontes, liberacao }
}

const SOURCES = [['gatilho_lote', deLote], ['gatilho_cliente', dePonto], ['relatorio_envio', deEnvioRelatorio], ['relatorio_programacao', deProgramacao], ['alerta_cliente', deAlerta],
  ['consultor_aviso', deConsultor], ['exec_ordem', deOrdem], ['incidente', deIncidente]]
export const FONTES = Object.freeze(SOURCES.map(s => s[0]))
const ehProspecto = c => /^\s*\[Comercial\]/i.test(String(c || ''))

// fontes: { <tabela>: linhas[] | null (null = não lida, vira nao_lidos) } · liberacao: { cliente: { liberado_por, auto } } · gate: { estado, configs }
export function montarFila({ fontes = {}, liberacao = {}, gate = null, agora = new Date().toISOString() } = {}) {
  const itens = [], nao_lidos = []
  for (const [nome, fn] of SOURCES) {
    const linhas = fontes[nome]; if (!Array.isArray(linhas)) { nao_lidos.push(nome); continue }
    for (const l of linhas) { if (ehProspecto(l.cliente)) continue; const it = fn(l, liberacao); if (it) itens.push(it) }
  }
  itens.sort((a, b) => ESTADOS.indexOf(a.estado) - ESTADOS.indexOf(b.estado) || String(a.desde).localeCompare(String(b.desde)))
  const faixa = f => { const L = itens.filter(i => i.faixa === f); const contadores = Object.fromEntries(ESTADOS.map(e => [e, L.filter(i => i.estado === e).length]))
    return { contadores: { ...contadores, todos: L.length - L.filter(i => i.historico).length, historico: L.filter(i => i.historico).length }, itens: L } }
  return { lido_em: agora, gate: gate ? montarGate(gate) : null, faixas: { cliente: faixa('cliente'), time: faixa('time') }, nao_lidos }
}
