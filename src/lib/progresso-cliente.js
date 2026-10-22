// Progresso do processo — stepper ÚNICO de 10 etapas da cadeia (docs/ux/arquitetura-5-menus.md § D, F4 21/10/2026):
// Cadastrado → Conectado → Coletado → Dados da empresa → Plano → Aprovado → Distribuído → Executado → Medido → Comunicado.
// PURO: recebe o contexto com números que JÁ EXISTEM (montado por progresso-real.js) e devolve as 10 etapas com estado, o número que prova,
// o atraso (dias) com o limiar, o motivo e onde agir. Nenhum dado novo, nenhum segundo motor: só lê e classifica.
// Estados fechados: feito · atual (marca da 1ª etapa não feita) · pendente · atrasado (gente) · desligado (chave global fechada: estrutura, não atraso) ·
// aguardando (carência, janela de prova ou horário ainda não chegou: não é atraso). Ausente = «—» com motivo; nunca «ligado» fingido.
export const ESTADOS = ['feito', 'atual', 'pendente', 'atrasado', 'desligado', 'aguardando']
export const LIMIARES = Object.freeze({
  cadastro_dias: 7, coleta_ok_h: 24, coleta_atencao_h: 26, coleta_critico_h: 30, sync_ok_h: 3, sync_atraso_h: 26,   // coleta/sync: config/autogestao.json → limiares
  custo_pct_min: 80, custo_dias: 14, plano_h: 24, plano_sem_ml_dias: 7, plano_sem_ml_atraso_dias: 14,
  decisao_dias_uteis: 2, distribuir_dias: 2, card_parado_dias: 7, pendencia_atencao_dias: 14, pendencia_revisar_dias: 30,   // 14/30 = config/playbook.json
  medida_carencia_dias: 17, medicao_atencao_h: 26, medicao_critico_h: 72, resposta_dias: 14, plano_terca_hora: '12:00', pronto_de: 8,
})
// ajuda = verbete de config/ajuda.json (o (i) do passo nunca abre vazio: scripts/teste-progresso.mjs confere)
export const ETAPAS = Object.freeze([
  { n: 1, id: 'cadastrado', nome: 'Cadastrado', ajuda: 'cadastro_cs', onde: 'Estrutura › Configurar cliente' },
  { n: 2, id: 'conectado', nome: 'Conectado', ajuda: 'ml', onde: 'Estrutura › Conexões' },
  { n: 3, id: 'coletado', nome: 'Coletado', ajuda: 'saude_sistema', onde: 'Estrutura › Estruturas' },
  { n: 4, id: 'dados_empresa', nome: 'Dados da empresa', ajuda: 'custos_erp', onde: 'Empresa do cliente › Custos' },
  { n: 5, id: 'plano', nome: 'Plano', ajuda: 'distribuicao', onde: 'Consultor › Plano' },
  { n: 6, id: 'aprovado', nome: 'Aprovado', ajuda: 'distribuicao', onde: 'Consultor › Plano' },
  { n: 7, id: 'distribuido', nome: 'Distribuído', ajuda: 'distribuicao', onde: 'Execução › Distribuir' },
  { n: 8, id: 'executado', nome: 'Executado', ajuda: 'executor_chaveiro', onde: 'Execução' },
  { n: 9, id: 'medido', nome: 'Medido', ajuda: 'medicao', onde: 'Consultor › Resumo' },
  { n: 10, id: 'comunicado', nome: 'Comunicado', ajuda: 'avisos_whatsapp', onde: 'Estrutura › Comunicação' },
])
export const MOTIVOS_ML = { sem_conexao_ml: 'sem conexão ativa com o Mercado Livre', coleta_atrasada: 'coleta do Mercado Livre parada há mais de 3 dias', sem_vendas_28d: 'sem vendas no Mercado Livre em 28 dias' }

const br = iso => /^\d{4}-\d{2}-\d{2}/.test(iso || '') ? iso.slice(0, 10).split('-').reverse().join('/') : '—'
const n0 = v => Number.isFinite(Number(v)) ? Number(v) : 0
const diaSemanaIso = iso => (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7          // 0 = segunda … 6 = domingo (semana ISO)
// dias úteis (segunda a sexta) entre duas datas AAAA-MM-DD, sem feriados (ponytail: feriados entram quando houver calendário no config)
export function diasUteis(de, ate) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(de || '') || !/^\d{4}-\d{2}-\d{2}/.test(ate || '')) return null
  let d = new Date(`${de.slice(0, 10)}T12:00:00Z`); const fim = new Date(`${ate.slice(0, 10)}T12:00:00Z`); let n = 0
  while (d < fim) { d.setUTCDate(d.getUTCDate() + 1); if (diaSemanaIso(d.toISOString().slice(0, 10)) < 5) n++ }
  return n
}

export function progressoCliente(ctx = {}) {
  const L = LIMIARES, agoraMs = Date.parse(ctx.agora || '') || Date.now()
  const hoje = /^\d{4}-\d{2}-\d{2}$/.test(ctx.hoje || '') ? ctx.hoje : new Date(agoraMs).toISOString().slice(0, 10)
  const horas = iso => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? Math.max(0, Math.round((agoraMs - t) / 36e5)) : null }
  const dias = iso => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? Math.max(0, Math.floor((agoraMs - t) / 864e5)) : null }
  const q = encodeURIComponent(ctx.cliente || ''), cli = (aba, sec) => `/cliente?cliente=${q}&aba=${aba}${sec ? '&sec=' + sec : ''}`
  const E = []
  const et = (n, o) => { E.push({ ...ETAPAS[n - 1], estado: 'pendente', numero: '—', atraso_dias: null, atraso_txt: '', limiar: '', motivo: '', ir: '', acao: '', atual: false, ...o }) }
  const atraso = (d, limiar, txt) => ({ estado: 'atrasado', atraso_dias: d, limiar, atraso_txt: txt || (d == null ? `limiar ${limiar}` : `há ${d} d · limiar ${limiar}`) })

  // 1 · Cadastrado — quadro «Tarefas - {Cliente}» descoberto + CS responsável
  const quadro = !!ctx.quadro, cs = String(ctx.cs || '').trim(), conhecido = dias(ctx.conhecido_desde)
  if (quadro && cs) et(1, { estado: 'feito', numero: `quadro ok · CS ${cs}`, ir: cli('configurar', 'cad-sec'), acao: 'Ver cadastro' })
  else {
    const falta = [!quadro && 'quadro «Tarefas» não descoberto', !cs && 'CS responsável vazio'].filter(Boolean).join(' · ')
    const atr = conhecido != null && conhecido > L.cadastro_dias
    et(1, { ...(atr ? atraso(conhecido, `${L.cadastro_dias} d`) : {}), numero: falta,
      motivo: conhecido == null ? 'sem data conhecida de entrada: o atraso não é medido' : `conhecido há ${conhecido} d`,
      ir: !cs ? cli('configurar', 'cad-sec') : cli('configurar', 'secNotion'), acao: !cs ? 'Registrar o CS responsável' : 'Localizar o quadro no Notion' })
  }

  // 2 · Conectado — conta ML viva (meli_contas sem erro)
  const ml = ctx.ml || {}, irMl = `/integracoes?fq=${q}`
  if (ml.conectado && !ml.erro) et(2, { estado: 'feito', numero: `conta ML viva${ml.conectado_em ? ' desde ' + br(ml.conectado_em) : ''}`, ir: irMl, acao: 'Ver conexão' })
  else if (ml.conectado) et(2, { ...atraso(dias(ml.atualizado_em), 'conexão sem erro'), numero: 'conexão em erro', motivo: String(ml.erro).slice(0, 120), ir: irMl, acao: 'Gerar novo link de conexão' })
  else if (ml.canal === false) et(2, { numero: 'sem canal Mercado Livre na central', motivo: 'a cadeia de coleta e execução é do Mercado Livre; nos outros canais o trabalho segue só pelo quadro', ir: irMl, acao: 'Conectar o Mercado Livre' })
  else et(2, { numero: 'sem conexão', motivo: 'a data do link gerado não é registrada: o atraso de 7 d não é medido', ir: irMl, acao: 'Conectar o Mercado Livre' })

  // 3 · Coletado — coleta ML (h) · sync Notion (h) · lacunas de pedidos (d)
  const col = ctx.coleta || {}, hc = horas(col.em), hs = horas(col.sync_em), lac = n0(col.lacunas)
  {
    const partes = [ml.conectado ? (hc == null ? 'coleta ML: nunca' : `coleta ML há ${hc} h`) : 'coleta ML: sem conexão', hs == null ? 'Notion: nunca' : `Notion há ${hs} h`, lac > 0 ? `${lac} dia(s) sem pedidos coletados em 28` : '']
    const o = { numero: partes.filter(Boolean).join(' · '), ir: ml.conectado ? cli('anuncios', 'secVendas') : '/estrutura?sec=secEstruturas', acao: ml.conectado ? 'Reler o Mercado Livre' : 'Reler o Notion' }
    if (ml.conectado && !ml.erro && (hc == null || hc > L.coleta_atencao_h)) Object.assign(o, atraso(hc == null ? null : Math.floor(hc / 24), `${L.coleta_atencao_h} h`, hc == null ? `nunca coletada · limiar ${L.coleta_atencao_h} h` : `há ${hc} h · limiar ${L.coleta_atencao_h} h`), { motivo: hc == null ? 'conta conectada e nunca coletada' : hc > L.coleta_critico_h ? `coleta há ${hc} h (crítico acima de ${L.coleta_critico_h} h)` : `coleta há ${hc} h (atenção)` })
    else if (hs == null || hs > L.sync_atraso_h) Object.assign(o, atraso(hs == null ? null : Math.floor(hs / 24), `${L.sync_atraso_h} h`, hs == null ? `nunca sincronizado · limiar ${L.sync_atraso_h} h` : `há ${hs} h · limiar ${L.sync_atraso_h} h`), { motivo: hs == null ? 'Notion nunca sincronizado' : `Notion há ${hs} h` })
    else if (ml.conectado && !ml.erro && (hc > L.coleta_ok_h || lac > 0)) Object.assign(o, { estado: lac > 0 ? 'pendente' : 'aguardando', motivo: lac > 0 ? `${lac} dia(s) dos últimos 28 sem pedidos coletados` : 'coleta de hoje ainda não rodou (roda a partir das 4h)' })
    else if (hs > L.sync_ok_h) Object.assign(o, { estado: 'aguardando', motivo: `Notion há ${hs} h: o sync de 2 h ainda não passou` })
    else Object.assign(o, { estado: 'feito' })
    et(3, o)
  }

  // 4 · Dados da empresa — custo informado ÷ receita (custos-db.resumoCustos: fat30 do anúncio) · prazo do fornecedor · catálogo marcado
  const em = ctx.empresa || {}, pct = Number.isFinite(Number(em.custo_pct)) && em.custo_pct != null ? Number(em.custo_pct) : null, lead = !!em.lead_time, cat = !!em.catalogo
  {
    const o = { numero: `custo ${pct == null ? '—' : pct + ' %'} da receita 30 d · prazo do fornecedor ${lead ? 'informado' : 'não informado'} · catálogo ${cat ? 'marcado' : 'não marcado'}`, ir: cli('empresa', 'secCustosUpload'), acao: pct == null || pct < L.custo_pct_min ? 'Subir a planilha de custos' : 'Informar o prazo do fornecedor' }
    if (pct != null && pct >= L.custo_pct_min && lead) o.estado = 'feito'
    else if (!ml.conectado) o.motivo = 'sem conexão ML: custo ÷ receita não é medido'
    else {
      const dc = dias(ml.conectado_em), atr = dc != null && dc > L.custo_dias && !(pct >= L.custo_pct_min)
      if (atr) Object.assign(o, atraso(dc, `${L.custo_dias} d conectado sem custo`))
      o.motivo = pct == null ? (em.custo_motivo || 'cobertura de custo não medida') : pct < L.custo_pct_min ? `custo cobre ${pct} % da receita (mínimo ${L.custo_pct_min} %)` : 'prazo do fornecedor não informado'
      if (!lead && o.acao === 'Subir a planilha de custos' && pct != null && pct >= L.custo_pct_min) o.acao = 'Informar o prazo do fornecedor'
    }
    et(4, o)
  }

  // 5 · Plano — diagnóstico disponível · plano regerado (acoes_plano.criado_em) · propostas
  const pl = ctx.plano || {}, hg = horas(pl.gerado_em)
  {
    const o = { numero: pl.gerado_em ? `plano de ${br(pl.gerado_em)} · ${n0(pl.propostas)} proposta(s)` : 'nenhum plano gerado', ir: cli('plano'), acao: pl.gerado_em ? 'Ver o plano' : 'Gerar o plano' }
    if (ml.conectado && !ml.erro) {
      if (pl.diagnostico === 'indisponivel') Object.assign(o, atraso(null, 'diagnóstico disponível'), { motivo: `diagnóstico indisponível: ${MOTIVOS_ML[pl.diagnostico_motivo] || pl.diagnostico_motivo || 'sem base'}` })
      else if (!pl.gerado_em) Object.assign(o, hc != null ? atraso(Math.floor(hc / 24), `${L.plano_h} h após a coleta`) : {}, { motivo: hc != null ? 'conta coletada e nenhum plano gerado' : 'sem coleta ainda' })
      else {
        const gap = col.em ? (Date.parse(col.em) - Date.parse(pl.gerado_em)) / 36e5 : null
        if (gap != null && gap > L.plano_h) Object.assign(o, atraso(Math.floor(gap / 24), `${L.plano_h} h após a coleta`, `há ${Math.round(gap)} h · limiar ${L.plano_h} h`), { motivo: `coleta de ${br(col.em)} sem plano regerado` })
        else o.estado = 'feito'
      }
    } else {   // sem ML: plano das tarefas do Notion, gerado pela tela Distribuir na rodada semanal
      if (!pl.gerado_em) o.motivo = 'nenhum plano gerado (Execução › Distribuir › Gerar)'
      else if (hg / 24 > L.plano_sem_ml_atraso_dias) Object.assign(o, atraso(Math.floor(hg / 24), `${L.plano_sem_ml_atraso_dias} d`), { motivo: 'plano sem ML regerado na rodada semanal' })
      else if (hg / 24 > L.plano_sem_ml_dias) Object.assign(o, { estado: 'aguardando', motivo: `plano há ${Math.floor(hg / 24)} d: regerar na rodada semanal` })
      else o.estado = 'feito'
    }
    et(5, o)
  }

  // 6 · Aprovado — P0/P1 propostas sem decisão (n, dias úteis) · aprovadas ÷ total
  const dc = ctx.decisao || {}, p01 = n0(dc.p01_sem_decisao), p01du = n0(dc.p01_dias_uteis_max), tot = n0(dc.total), apr = n0(dc.aprovadas)
  {
    const o = { numero: `${p01} P0/P1 sem decisão · ${apr} de ${tot} aprovadas`, ir: cli('plano'), acao: 'Decidir as P0/P1' }
    if (!tot) o.motivo = 'sem ações no plano ainda'
    else if (p01 > 0 && p01du > L.decisao_dias_uteis) Object.assign(o, atraso(p01du, `${L.decisao_dias_uteis} dias úteis`, `há ${p01du} dias úteis · limiar ${L.decisao_dias_uteis}`), { motivo: `${p01} P0/P1 esperando decisão (aprovar, descartar com motivo ou delegar)` })
    else if (p01 > 0) o.motivo = `${p01} P0/P1 dentro do prazo de decisão (${L.decisao_dias_uteis} dias úteis)`
    else o.estado = 'feito'
    et(6, o)
  }

  // 7 · Distribuído — aprovadas não distribuídas (> 2 d = paradas) · cobertura = cards «· PS-» ÷ tarefas
  const di = ctx.distribuicao || {}, and = n0(di.aprovadas_nao_distribuidas), par = n0(di.aprovadas_paradas), cards = n0(di.cards_ps), tar = n0(di.tarefas), cob = tar ? Math.round(100 * cards / tar) : null
  {
    const o = { numero: `${and} aprovada(s) não distribuída(s) · cobertura PS- ${cob == null ? '—' : cob + ' %'} (${cards} de ${tar})`, ir: '/planos?sec=secRevisar', acao: 'Distribuir no Notion' }
    if (par > 0) Object.assign(o, atraso(n0(di.aprovadas_dias_max), `${L.distribuir_dias} d`), { motivo: `${par} aprovada(s) parada(s) há mais de ${L.distribuir_dias} d` })
    else if (and > 0) o.motivo = `${and} aprovada(s) aguardam a distribuição (prévia → confirmar)`
    else if (!(cards > 0 || n0(di.distribuidas) > 0)) o.motivo = 'nada distribuído ainda'
    else o.estado = 'feito'
    et(7, o)
  }

  // 8 · Executado — 3 mãos: analista (cards PS- parados > 7 d) · Chaveiro (ordens conferidas × divergentes; desligado com execucao_ligada=false) · cliente (pendências 14/30 d)
  const ex = ctx.execucao || {}, cp = n0(ex.cards_parados), div = n0(ex.ordens_divergentes), conf = n0(ex.ordens_conferidas), p14 = n0(ex.pendencias_14), p30 = n0(ex.pendencias_30)
  {
    const maos = [
      { nome: 'analista', estado: cp > 0 ? 'atrasado' : n0(ex.cards_abertos) > 0 ? 'pendente' : n0(ex.cards_ps) > 0 ? 'feito' : 'pendente', numero: `cards PS- parados > ${L.card_parado_dias} d: ${cp}` },
      { nome: 'Chaveiro', estado: !ex.chaveiro_ligado ? 'desligado' : div > 0 ? 'atrasado' : n0(ex.ordens) > 0 ? 'feito' : 'pendente', numero: ex.chaveiro_ligado ? `ordens: ${conf} conferida(s) · ${div} divergente(s)` : 'Chaveiro desligado (execucao_ligada=false)' },
      { nome: 'cliente', estado: p30 > 0 ? 'atrasado' : p14 > 0 ? 'aguardando' : 'feito', numero: `pendências > ${L.pendencia_atencao_dias} d: ${p14} · > ${L.pendencia_revisar_dias} d: ${p30}` },
    ]
    const o = { numero: maos.map(m => m.numero).join(' · '), maos, ir: cp > 0 ? '/analistas' : p30 > 0 ? cli('do-cliente') : div > 0 ? cli('executar') : '/analistas', acao: cp > 0 ? 'Cobrar os cards parados' : p30 > 0 ? 'Cobrar o cliente' : div > 0 ? 'Conferir as ordens divergentes' : 'Ver analistas' }
    if (cp > 0 || div > 0 || p30 > 0) Object.assign(o, atraso(Math.max(n0(ex.cards_dias_max), n0(ex.pendencias_dias_max)), `${L.card_parado_dias} d card · ${L.pendencia_revisar_dias} d pendência`))
    else if (p14 > 0) Object.assign(o, { estado: 'aguardando', motivo: `${p14} pendência(s) aguardando o cliente (${L.pendencia_atencao_dias}–${L.pendencia_revisar_dias} d)` })
    else if (!(n0(ex.cards_ps) > 0 || n0(ex.ordens) > 0 || n0(ex.pendencias) > 0)) o.motivo = 'nada distribuído ainda'
    else o.estado = 'feito'
    et(8, o)
  }

  // 9 · Medido — aprendizado > 0 · medicao_em (global) · distribuídas concluídas há > 17 d (3 d carência + 14 d janela) sem medida
  const me = ctx.medicao || {}, hm = horas(me.medicao_em), med = n0(me.medidas), semMed = n0(me.sem_medida), jan = n0(me.em_janela)
  {
    const o = { numero: `${med} medida(s) · ${semMed} concluída(s) há > ${L.medida_carencia_dias} d sem medida · medição ${hm == null ? 'nunca' : 'há ' + hm + ' h'}`, ir: cli('resumo', 'secAcomp'), acao: 'Vincular o anúncio à tarefa' }
    const temOQueMedir = med > 0 || jan > 0 || semMed > 0
    if (semMed > 0) Object.assign(o, atraso(n0(me.sem_medida_dias_max), `${L.medida_carencia_dias} d após a conclusão`), { motivo: `${semMed} concluída(s) sem medida: sem vínculo com o anúncio ou medição parada` })
    else if (temOQueMedir && (hm == null || hm > L.medicao_critico_h)) Object.assign(o, atraso(hm == null ? null : Math.floor(hm / 24), `${L.medicao_critico_h} h`, hm == null ? `nunca · limiar ${L.medicao_critico_h} h` : `há ${hm} h · limiar ${L.medicao_critico_h} h`), { motivo: hm == null ? 'medição diária nunca rodou' : `medição diária parada há ${hm} h (crítico)` })
    else if (temOQueMedir && hm > L.medicao_atencao_h) o.motivo = `medição diária há ${hm} h (atenção acima de ${L.medicao_atencao_h} h)`
    else if (jan > 0 && !med) Object.assign(o, { estado: 'aguardando', motivo: `${jan} na janela de prova (3 d de carência + 14 d)` })
    else if (!med) o.motivo = 'nenhuma ação distribuída concluída ainda'
    else o.estado = 'feito'
    et(9, o)
  }

  // 10 · Comunicado — chave gatilhos_ligado · cliente elegível e liberado · recibo entregue do lote semanal nesta semana ISO · relatório no Notion · resposta em 14 d
  const co = ctx.comunicacao || {}, rec = String(co.recibo_semana || ''), rel = co.relatorio || null
  {
    const o = { ir: '/planos?sec=secAvisosAuto', acao: 'Ver o plano de terça' }
    const relTxt = rel ? (rel.situacao_rotulo || rel.situacao || '—') : 'não lido'
    o.numero = `plano de terça: ${rec || 'sem recibo nesta semana'} · relatório no Notion: ${relTxt} · resposta do cliente em ${L.resposta_dias} d: ${co.resposta_14d ? 'sim' : 'não'}`
    if (!co.chave_ligada) Object.assign(o, { estado: 'desligado', motivo: 'chave «Plano de terça ao cliente» (gatilhos_ligado) desligada: estrutura, não atraso', ir: '/estrutura', acao: 'Ver estruturas' })
    else if (co.inicio_envios && hoje < co.inicio_envios) Object.assign(o, { estado: 'aguardando', motivo: `envios começam em ${br(co.inicio_envios)}` })
    else if (!co.elegivel) Object.assign(o, { motivo: `cliente sem integração ML de fato: ${MOTIVOS_ML[co.motivo_inelegivel] || co.motivo_inelegivel || 'conexão, coleta ≤ 3 d e vendas 28 d'}`, ir: irMl })
    else if (!co.liberado) Object.assign(o, { motivo: 'cliente elegível e não liberado por um líder', acao: 'Liberar o plano de terça' })
    else {
      const dow = diaSemanaIso(hoje), depoisDaTerca = dow > 1 || (dow === 1 && String(ctx.hora || '00:00') >= L.plano_terca_hora)
      if (rec === 'falhou' || rel?.situacao === 'falhou') Object.assign(o, atraso(null, 'recibo entregue'), { motivo: rec === 'falhou' ? 'recibo do plano semanal falhou' : 'relatório ao Notion falhou' })
      else if (rec !== 'entregue' && depoisDaTerca) Object.assign(o, atraso(null, 'terça 12:00'), { motivo: 'terça 12:00 passou sem recibo entregue do plano semanal' })
      else if (rec !== 'entregue') Object.assign(o, { estado: 'aguardando', motivo: 'o plano sai terça 09:00 no fuso do cliente' })
      else if (rel?.situacao === 'atrasado') Object.assign(o, atraso(null, 'relatório na frequência'), { motivo: 'relatório ao Notion atrasado' })
      else o.estado = 'feito'
    }
    et(10, o)
  }

  const atual = E.find(e => e.estado !== 'feito'); if (atual) atual.atual = true
  const pronto = [['quadro «Tarefas» descoberto', quadro], ['CS responsável', !!cs], ['conta ML conectada', !!ml.conectado && !ml.erro], [`coleta ML ≤ ${L.coleta_ok_h} h`, hc != null && hc <= L.coleta_ok_h], [`Notion ≤ ${L.sync_ok_h} h`, hs != null && hs <= L.sync_ok_h], [`custo ≥ ${L.custo_pct_min} % da receita`, pct != null && pct >= L.custo_pct_min], ['prazo do fornecedor informado', lead], ['catálogo marcado', cat]].map(([texto, ok]) => ({ texto, ok: !!ok }))
  const atrasos = E.filter(e => e.estado === 'atrasado').map(e => e.atraso_dias).filter(Number.isFinite)
  return { cliente: ctx.cliente || '', hoje, etapas: E, atual: atual ? atual.n : null, pronto: { n: pronto.filter(p => p.ok).length, de: L.pronto_de, itens: pronto }, ciclo_completo: !atual, atraso_max: atrasos.length ? Math.max(...atrasos) : (E.some(e => e.estado === 'atrasado') ? 0 : null) }
}

// Carteira: as 3 contagens por etapa (feito · atrasado · desligado, + aguardando/pendente), os 10 contadores «parados nesta etapa» (clientes cuja etapa atual é esta),
// «ciclo completo: N de M» e a tabela 1 linha por cliente ordenada por atraso. Totais para os 3 KPIs de /planos. Puro: recebe a lista de contextos.
export function progressoCarteira(ctxs = [], { hoje = '' } = {}) {
  const lista = ctxs.map(progressoCliente)
  const etapas = ETAPAS.map(e => ({ n: e.n, id: e.id, nome: e.nome, feito: 0, atrasado: 0, desligado: 0, aguardando: 0, pendente: 0, parados: 0 }))
  for (const p of lista) { p.etapas.forEach((x, i) => { etapas[i][x.estado] = (etapas[i][x.estado] || 0) + 1 }); if (p.atual) etapas[p.atual - 1].parados++ }
  const clientes = lista.map(p => {
    const e = p.atual ? p.etapas[p.atual - 1] : null
    const atr = p.etapas.filter(x => x.estado === 'atrasado').sort((a, b) => (b.atraso_dias ?? -1) - (a.atraso_dias ?? -1))[0] || null
    return { cliente: p.cliente, etapa: p.atual, nome: e ? e.nome : 'Ciclo completo', estado: e ? e.estado : 'feito', numero: e ? e.numero : 'as 10 etapas feitas', atraso_dias: atr ? atr.atraso_dias : null, atraso_txt: atr ? atr.atraso_txt : '', atraso_etapa: atr ? atr.n : null, acao: e ? e.acao : '', ir: e ? e.ir : '', pronto: p.pronto.n, etapas: p.etapas.map(x => ({ n: x.n, nome: x.nome, estado: x.estado, atual: x.atual, numero: x.numero })) }
  }).sort((a, b) => (b.atraso_dias ?? -1) - (a.atraso_dias ?? -1) || (b.atraso_etapa ? 1 : 0) - (a.atraso_etapa ? 1 : 0) || (a.etapa ?? 11) - (b.etapa ?? 11) || a.cliente.localeCompare(b.cliente, 'pt-BR'))
  const soma = f => ctxs.reduce((s, c) => s + n0(f(c)), 0), cards = soma(c => c.distribuicao?.cards_ps), tar = soma(c => c.distribuicao?.tarefas)
  const totais = { p01_sem_decisao_2du: soma(c => c.decisao?.p01_atrasadas), aprovadas_nao_distribuidas: soma(c => c.distribuicao?.aprovadas_nao_distribuidas), cobertura_ps: { cards, tarefas: tar, pct: tar ? Math.round(1000 * cards / tar) / 10 : null } }
  return { hoje: hoje || lista[0]?.hoje || '', total: lista.length, etapas, ciclo_completo: { n: lista.filter(p => p.ciclo_completo).length, de: lista.length }, clientes, totais }
}
