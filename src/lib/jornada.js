// Jornada do cliente — passos DENTRO de cada uma das 10 etapas (pedido do David, 04/11/2026: «passos por etapa… um sistema funcional mostrando o passo a passo»,
// referência de construção: docs/ux/referencia-guesty.md). PURO: recebe o contexto do progresso (progresso-real.js → contextoCliente) e as 10 etapas já
// classificadas (progresso-cliente.js) e devolve, por etapa, a lista de passos com estado lido do dado real, quem faz, o que destrava e onde alimentar.
// Nenhum dado novo, nenhum segundo motor: é a projeção «o que falta preencher» sobre o que o sistema já lê. Ausente = pendente com motivo; nunca feito fingido.
//  montarJornada({ etapas, ctx }) → { etapas: [{ n, id, nome, estado, passos: [{ id, nome, quem, estado, numero, motivo, destrava, ir, acao }], feitos, total }], resumo, proximo }
// Estados do passo (fechados): feito · pendente · atrasado (herda da etapa quando a etapa está atrasada e o passo é o que falta) · desligado (chave global) ·
// aguardando (carência/janela) · nao_se_aplica (ex.: Mercado Livre sem canal ML).
export const QUEM = Object.freeze({ cs: 'CS', consultor: 'Consultor', cliente: 'Cliente', lider: 'Líder', sistema: 'Sistema', tecnico: 'Técnico' })
export const ESTADOS_PASSO = Object.freeze(['feito', 'pendente', 'atrasado', 'desligado', 'aguardando', 'nao_se_aplica'])

const n0 = v => (Number.isFinite(Number(v)) ? Number(v) : 0)
const horasDesde = (iso, agoraMs) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? Math.max(0, Math.round((agoraMs - t) / 36e5)) : null }
const feito = (numero, extra = {}) => ({ estado: 'feito', numero, ...extra })
const pend = (numero, motivo = '') => ({ estado: 'pendente', numero, motivo })
const aguard = (numero, motivo = '') => ({ estado: 'aguardando', numero, motivo })
const deslig = (numero, motivo = '') => ({ estado: 'desligado', numero, motivo })
const nse = (numero, motivo = '') => ({ estado: 'nao_se_aplica', numero, motivo })

// catálogo FECHADO de passos: etapa · id · nome · quem · destrava · onde alimentar (aba/sec do /cliente, ou rota) · prova(ctx, { agoraMs }) → { estado, numero, motivo }
export const PASSOS = Object.freeze([
  // 1 · Cadastrado
  { etapa: 1, id: 'quadro_notion', nome: 'Quadro «Tarefas» do cliente localizado no Notion', quem: 'sistema', destrava: 'leitura das tarefas e dos cards PS-', aba: 'configurar', sec: 'secNotion', acao: 'Localizar o quadro',
    prova: c => (c.quadro ? feito('quadro descoberto') : pend('não descoberto', 'o sync do Notion ainda não achou o quadro «Tarefas - {Cliente}»')) },
  { etapa: 1, id: 'cs_responsavel', nome: 'CS responsável registrado', quem: 'cs', destrava: 'dono do onboarding e da fila do CS', aba: 'configurar', sec: 'cad-sec', acao: 'Registrar o CS',
    prova: c => (String(c.cs || '').trim() ? feito(c.cs) : pend('vazio', 'sem CS a fila do CS não vê este cliente')) },
  { etapa: 1, id: 'consultor_ml', nome: 'Consultor do Mercado Livre definido', quem: 'lider', destrava: 'aprovação do plano e resumo de terça no Discord', aba: 'configurar', sec: 'cad-sec', acao: 'Definir o consultor',
    prova: c => (c.cadastro?.consultor_ml ? feito(c.cadastro.consultor_ml) : pend('vazio', 'sem consultor nenhuma ação tem responsável')) },
  { etapa: 1, id: 'canais', nome: 'Canais de venda informados', quem: 'cs', destrava: 'o que o sistema coleta (Mercado Livre) e o que segue só pelo quadro', aba: 'configurar', sec: 'cad-sec', acao: 'Informar os canais',
    prova: c => (c.cadastro?.canais?.length ? feito(c.cadastro.canais.join(', ')) : pend('nenhum', 'a central não lista canais para este cliente')) },
  { etapa: 1, id: 'produto', nome: 'Produto contratado (Performance ou Prime) e nicho', quem: 'cs', destrava: 'as regras do plano e a trilha certa', aba: 'configurar', sec: 'cad-sec', acao: 'Informar produto e nicho',
    prova: c => (c.cadastro?.tier ? feito(`${c.cadastro.tier}${c.cadastro.nicho ? ' · ' + c.cadastro.nicho : ''}`) : pend(c.cadastro?.nicho ? `nicho ${c.cadastro.nicho}, sem produto` : 'vazio', 'sem produto o plano usa o padrão Performance')) },
  // 2 · Conectado
  { etapa: 2, id: 'ml_conexao', nome: 'Conta do Mercado Livre conectada', quem: 'cliente', destrava: 'coleta diária, diagnóstico e plano por anúncio', rota: '/integracoes', acao: 'Gerar o link de conexão',
    prova: c => (c.cadastro?.canais?.length && !c.cadastro.canais.includes('ML') ? nse('sem canal ML', 'cliente sem Mercado Livre: a coleta não se aplica') : c.ml?.conectado ? feito(`conectada${c.ml.conectado_em ? ' em ' + c.ml.conectado_em.slice(0, 10) : ''}`) : pend('sem conexão', 'o cliente ainda não autorizou pelo link')) },
  { etapa: 2, id: 'ml_sem_erro', nome: 'Conexão sem erro (token renovando)', quem: 'sistema', destrava: 'leitura contínua sem o cliente logar de novo', rota: '/integracoes', acao: 'Ver a conexão',
    prova: c => (!c.ml?.conectado ? pend('—', 'depende da conexão') : c.ml.erro ? pend('em erro', String(c.ml.erro).slice(0, 100)) : feito('sem erro')) },
  // 3 · Coletado
  { etapa: 3, id: 'coleta_hoje', nome: 'Coleta diária do Mercado Livre feita', quem: 'sistema', destrava: 'números de hoje no diagnóstico', rota: '/estrutura', acao: 'Ver a saúde do sistema',
    prova: (c, { agoraMs }) => { if (!c.ml?.conectado) return pend('—', 'depende da conexão'); const h = horasDesde(c.coleta?.em, agoraMs); return h == null ? pend('nunca coletado', 'a 1ª coleta roda na próxima madrugada (4h)') : h <= 30 ? feito(`há ${h} h`) : pend(`há ${h} h`, 'coleta atrasada') } },
  { etapa: 3, id: 'coleta_28d', nome: '28 dias de pedidos cobertos', quem: 'sistema', destrava: 'comparação 28 × 28 e curva ABC', rota: '/estrutura', acao: 'Ver a saúde do sistema',
    prova: c => (!c.ml?.conectado ? pend('—', 'depende da conexão') : c.coleta?.lacunas == null ? pend('—', 'sem leitura das janelas') : c.coleta.lacunas === 0 ? feito('0 dias sem coleta') : aguard(`${c.coleta.lacunas} dia(s) sem coleta`, 'a cobertura completa chega com os próximos dias de coleta')) },
  { etapa: 3, id: 'notion_sync', nome: 'Notion sincronizado', quem: 'sistema', destrava: 'tarefas e cards atualizados', rota: '/estrutura', acao: 'Ver a saúde do sistema',
    prova: (c, { agoraMs }) => { const h = horasDesde(c.coleta?.sync_em, agoraMs); return h == null ? pend('nunca', 'sem NOTION_TOKEN ou sync nunca rodou') : h <= 26 ? feito(`há ${h} h`) : pend(`há ${h} h`, 'sync parado') } },
  // 4 · Dados da empresa
  { etapa: 4, id: 'custos', nome: 'Custo por produto informado (≥ 80 % do faturamento)', quem: 'cliente', destrava: 'margem, preço mínimo, ROAS alvo e o produto «abacaxi × estrela»', aba: 'configurar', sec: 'secCustosUpload', acao: 'Enviar a planilha de custos',
    prova: c => (!c.ml?.conectado ? pend('—', 'depende da conexão') : c.empresa?.custo_pct == null ? pend('não informado', c.empresa?.custo_motivo || 'sem custos') : c.empresa.custo_pct >= 80 ? feito(`${Math.round(c.empresa.custo_pct)} % do faturamento`) : pend(`${Math.round(c.empresa.custo_pct)} % do faturamento`, 'abaixo de 80 %: parte da margem fica sem base')) },
  { etapa: 4, id: 'lead_time', nome: 'Prazo do fornecedor (lead time) informado', quem: 'cliente', destrava: 'data de ruptura e quando pedir no ciclo de compras', aba: 'relatorios', sec: '', acao: 'Informar o prazo',
    prova: c => (c.empresa?.lead_time ? feito('informado') : pend('não informado', 'sem ele o ciclo de compras usa a premissa de 21 dias')) },
  { etapa: 4, id: 'metas', nome: 'Metas do mês cadastradas', quem: 'consultor', destrava: 'Ads abaixo da meta e o veredito do mês', aba: 'configurar', sec: 'secMetas', acao: 'Cadastrar as metas',
    prova: c => (c.empresa?.metas_mes ? feito('mês atual') : pend('sem metas', 'sem meta o Ads usa só o equilíbrio')) },
  { etapa: 4, id: 'catalogo', nome: 'Catálogo próprio × de terceiros marcado', quem: 'consultor', destrava: 'não pedir foto/descrição em anúncio de catálogo de terceiros', aba: 'configurar', sec: 'secCatalogo', acao: 'Marcar o catálogo',
    prova: c => (c.empresa?.catalogo == null ? pend('padrão: terceiros', 'sem marcação o sistema assume o modo seguro') : feito(c.empresa.catalogo ? 'catálogo próprio' : 'terceiros (marcado)')) },
  { etapa: 4, id: 'promocoes', nome: 'Coleta de promoções do ML decidida', quem: 'consultor', destrava: 'regras de promoção e ofertas', aba: 'configurar', sec: 'secPerfil', acao: 'Decidir a coleta',
    prova: c => (c.empresa?.promocoes_coleta == null ? pend('padrão da base', 'ninguém decidiu por este cliente') : feito(c.empresa.promocoes_coleta ? 'ligada' : 'desligada')) },
  // 5 · Plano
  { etapa: 5, id: 'diagnostico', nome: 'Diagnóstico disponível', quem: 'sistema', destrava: 'o plano por anúncio', aba: 'resumo', sec: '', acao: 'Abrir o Resumo',
    prova: c => (c.plano?.diagnostico === 'disponivel' ? feito('disponível') : c.plano?.diagnostico === 'sem_ml' ? pend('sem ML', 'depende da conexão') : pend('indisponível', c.plano?.diagnostico_motivo || '')) },
  { etapa: 5, id: 'plano_gerado', nome: 'Plano gerado após a coleta', quem: 'sistema', destrava: 'ações propostas para aprovar', aba: 'plano', sec: '', acao: 'Abrir o Plano',
    prova: c => (c.plano?.gerado_em ? feito(`gerado em ${c.plano.gerado_em.slice(0, 10)} · ${n0(c.plano.propostas)} proposta(s)`) : pend('nunca gerado', 'o plano nasce na coleta diária ou pelo botão Gerar')) },
  // 6 · Aprovado
  { etapa: 6, id: 'p01', nome: 'P0/P1 decididas em até 2 dias úteis', quem: 'consultor', destrava: 'distribuição das prioridades', aba: 'plano', sec: '', acao: 'Decidir as P0/P1',
    prova: c => (!n0(c.decisao?.total) ? pend('sem ações', 'depende do plano') : n0(c.decisao.p01_sem_decisao) === 0 ? feito('nenhuma P0/P1 sem decisão') : pend(`${c.decisao.p01_sem_decisao} sem decisão`, n0(c.decisao.p01_atrasadas) ? `${c.decisao.p01_atrasadas} passaram de 2 dias úteis` : 'dentro do prazo')) },
  { etapa: 6, id: 'aprovadas', nome: 'Pelo menos 1 ação aprovada', quem: 'consultor', destrava: 'cards no Notion', aba: 'plano', sec: '', acao: 'Aprovar ações',
    prova: c => (n0(c.decisao?.aprovadas) > 0 ? feito(`${c.decisao.aprovadas} aprovada(s)`) : pend('0 aprovadas', 'nada aprovado ainda')) },
  // 7 · Distribuído
  { etapa: 7, id: 'distribuir', nome: 'Aprovadas distribuídas no Notion', quem: 'lider', destrava: 'execução pelos analistas', rota: '/planos', acao: 'Distribuir',
    prova: c => (!n0(c.decisao?.aprovadas) && !n0(c.distribuicao?.distribuidas) ? pend('—', 'depende da aprovação') : n0(c.distribuicao?.aprovadas_nao_distribuidas) === 0 ? feito(`${n0(c.distribuicao?.distribuidas)} distribuída(s)`) : pend(`${c.distribuicao.aprovadas_nao_distribuidas} aprovada(s) sem card`, n0(c.distribuicao.aprovadas_paradas) ? `${c.distribuicao.aprovadas_paradas} há mais de 2 dias` : '')) },
  { etapa: 7, id: 'cards_ps', nome: 'Cards PS- aparecem no quadro do cliente', quem: 'sistema', destrava: 'medição pelo card', aba: 'configurar', sec: 'secNotion', acao: 'Ver o Notion',
    prova: c => (n0(c.distribuicao?.cards_ps) > 0 ? feito(`${c.distribuicao.cards_ps} card(s)`) : n0(c.distribuicao?.distribuidas) ? pend('0 cards', 'distribuído mas o sync ainda não leu os cards') : pend('—', 'depende da distribuição')) },
  // 8 · Executado
  { etapa: 8, id: 'cards_andando', nome: 'Nenhum card PS- parado há mais de 7 dias', quem: 'consultor', destrava: 'resultado dentro da janela de prova', rota: '/analistas', acao: 'Ver os analistas',
    prova: c => (!n0(c.execucao?.cards_ps) ? pend('—', 'depende dos cards') : n0(c.execucao.cards_parados) === 0 ? feito(`${c.execucao.cards_abertos} aberto(s), nenhum parado`) : pend(`${c.execucao.cards_parados} parado(s)`, `o mais antigo há ${c.execucao.cards_dias_max} d`)) },
  { etapa: 8, id: 'pendencias_cliente', nome: 'Nada pendente do cliente há mais de 14 dias', quem: 'cliente', destrava: 'ações que dependem de material/decisão do cliente', aba: 'resumo', sec: 'secDependeCliente', acao: 'Cobrar o cliente',
    prova: c => (!n0(c.execucao?.cards_ps) && !n0(c.distribuicao?.tarefas) ? pend('—', 'depende de tarefas no quadro') : n0(c.execucao?.pendencias) === 0 ? feito('nenhuma pendência') : n0(c.execucao.pendencias_14) === 0 ? aguard(`${c.execucao.pendencias} pendência(s)`, 'todas com menos de 14 dias') : pend(`${c.execucao.pendencias_14} há 14+ dias`, n0(c.execucao.pendencias_30) ? `${c.execucao.pendencias_30} há 30+ dias: revisar` : '')) },
  { etapa: 8, id: 'chaveiro', nome: 'Execução automática no ML (Chaveiro)', quem: 'lider', destrava: 'preço, frete e status aplicados sem analista', aba: 'executar', sec: '', acao: 'Ver a execução',
    prova: c => (c.execucao?.chaveiro_ligado === false ? deslig('desligado', 'chave global do executor desligada: estrutura, não atraso') : n0(c.execucao?.ordens) ? feito(`${c.execucao.ordens_conferidas} conferida(s) de ${c.execucao.ordens}`) : pend('0 ordens', 'nenhuma ordem preparada')) },
  // 9 · Medido
  { etapa: 9, id: 'medidas', nome: 'Resultado medido (antes × depois com controle)', quem: 'sistema', destrava: 'aprendizado do Oráculo e texto ao cliente', aba: 'resumo', sec: 'secAcomp', acao: 'Ver o acompanhamento',
    prova: c => (n0(c.medicao?.medidas) > 0 ? feito(`${c.medicao.medidas} medida(s)`) : n0(c.execucao?.cards_ps) ? aguard('0 medidas', 'a medição espera 14 dias depois da conclusão do card') : pend('—', 'depende da execução')) },
  { etapa: 9, id: 'sem_medida', nome: 'Nenhuma ação concluída sem medição', quem: 'sistema', destrava: 'honestidade do «o que rendeu»', aba: 'resumo', sec: 'secAcomp', acao: 'Ver o acompanhamento',
    prova: c => (!n0(c.execucao?.cards_ps) ? pend('—', 'depende dos cards') : n0(c.medicao?.sem_medida) === 0 ? feito('tudo medido no prazo') : pend(`${c.medicao.sem_medida} sem medida`, `a mais antiga concluída há ${c.medicao.sem_medida_dias_max} d`)) },
  // 10 · Comunicado
  { etapa: 10, id: 'destinos', nome: 'Destino do cliente liberado (WhatsApp/e-mail/Notion)', quem: 'cs', destrava: 'plano de terça e relatório chegando ao cliente', aba: 'configurar', sec: 'secAvisos', acao: 'Liberar o destino',
    prova: c => (c.comunicacao?.liberado ? feito(`liberado · ${(c.comunicacao.canais_ligados || []).join(', ') || 'sem canal ligado'}`) : pend('não liberado', 'nenhum líder liberou o envio a este cliente')) },
  { etapa: 10, id: 'relatorio', nome: 'Relatório de Sprints programado', quem: 'cs', destrava: 'relatório periódico no Notion do cliente', aba: 'configurar', sec: 'secRelatorio', acao: 'Programar o relatório',
    prova: c => (!c.comunicacao?.relatorio ? pend('não lido', 'programação não lida') : c.comunicacao.relatorio.frequencia && c.comunicacao.relatorio.frequencia !== 'desligado' ? feito(`${c.comunicacao.relatorio.frequencia} · ${c.comunicacao.relatorio.situacao_rotulo || c.comunicacao.relatorio.situacao || ''}`) : pend('desligado', 'sem frequência definida')) },
  { etapa: 10, id: 'chave_envios', nome: 'Envios automáticos ao cliente ligados', quem: 'lider', destrava: 'o plano de terça sai sozinho', rota: '/estrutura', acao: 'Ver as estruturas',
    prova: c => (c.comunicacao?.chave_ligada ? feito('ligada') : deslig('desligada', 'chave global desligada pelo David: estrutura, não atraso')) },
  { etapa: 10, id: 'recibo', nome: 'Plano desta semana entregue', quem: 'sistema', destrava: 'ciclo fechado com o cliente', rota: '/comunicacao', acao: 'Ver a comunicação',
    prova: c => (!c.comunicacao?.chave_ligada ? deslig('—', 'depende da chave de envios') : c.comunicacao.recibo_semana === 'entregue' || c.comunicacao.recibo_semana === 'enviado' ? feito(c.comunicacao.recibo_semana) : pend(c.comunicacao.recibo_semana || 'sem lote', 'nada saiu nesta semana')) },
  { etapa: 10, id: 'resposta', nome: 'Cliente respondeu ao relatório em 14 dias', quem: 'cliente', destrava: 'sinal de engajamento (risco de churn)', aba: 'resumo', sec: '', acao: 'Ver o Resumo',
    prova: c => (c.comunicacao?.resposta_14d ? feito('respondeu') : aguard('sem resposta', 'o sistema só registra respostas pelo relatório')) },
])

export function montarJornada({ etapas = [], ctx = {} } = {}) {
  const agoraMs = Date.parse(ctx.agora || '') || Date.now()
  const q = encodeURIComponent(ctx.cliente || '')
  const irDe = p => p.rota ? p.rota : `/cliente?cliente=${q}&aba=${p.aba}${p.sec ? '&sec=' + p.sec : ''}`
  const out = etapas.map(e => {
    const passos = PASSOS.filter(p => p.etapa === e.n).map(p => {
      let r; try { r = p.prova(ctx, { agoraMs }) || pend('—', 'sem leitura') } catch { r = pend('—', 'sem leitura') }
      // a etapa atrasada pinta de atrasado o passo pendente que a segura (gente); desligado/aguardando/nao_se_aplica ficam como estão
      const estado = r.estado === 'pendente' && e.estado === 'atrasado' ? 'atrasado' : r.estado
      return { id: p.id, nome: p.nome, quem: p.quem, quem_rotulo: QUEM[p.quem] || p.quem, estado, numero: r.numero ?? '—', motivo: r.motivo || '', destrava: p.destrava, ir: irDe(p), acao: p.acao }
    })
    const conta = passos.filter(p => p.estado !== 'nao_se_aplica')
    return { n: e.n, id: e.id, nome: e.nome, estado: e.estado, atual: !!e.atual, numero: e.numero, atraso_txt: e.atraso_txt || '', ajuda: e.ajuda, passos, feitos: conta.filter(p => p.estado === 'feito').length, total: conta.length }
  })
  const todos = out.flatMap(e => e.passos.map(p => ({ ...p, etapa: e.n })))
  const pendentes = todos.filter(p => p.estado === 'pendente' || p.estado === 'atrasado')
  // próximo passo = o 1º pendente na ordem da cadeia (etapa anterior é pré-requisito da seguinte); dentro da etapa, atrasado antes de pendente
  const proximo = pendentes.sort((a, b) => a.etapa - b.etapa || (b.estado === 'atrasado') - (a.estado === 'atrasado'))[0] || null
  const feitos = todos.filter(p => p.estado === 'feito').length, aplicaveis = todos.filter(p => p.estado !== 'nao_se_aplica').length
  return { cliente: ctx.cliente || '', etapas: out, resumo: { feitos, total: aplicaveis, pendentes: pendentes.length, atrasados: todos.filter(p => p.estado === 'atrasado').length, desligados: todos.filter(p => p.estado === 'desligado').length, aguardando: todos.filter(p => p.estado === 'aguardando').length }, proximo }
}
