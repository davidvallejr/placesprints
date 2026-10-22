// Estado das estruturas (docs/ux/arquitetura-5-menus.md § A.6 e § G «F3», 21/10/2026). PURO: recebe os configs lidos (os carregados no início do
// servidor e a cópia atual do disco), as chaves de sync_estado (lista fechada CHAVES_BANCO), a PRESENÇA das variáveis de ambiente (lista fechada
// VARIAVEIS; nunca o valor), ticks/sinais/incidentes da Saúde do sistema e devolve uma linha por estrutura. Nenhuma leitura de banco, disco ou rede aqui.
// Estados (closed): ligado | desligado | pronto (configurado, não ligado) | pendente (falta algo) | erro (freio acionado, tick parado, incidente).
// Honestidade: o que não foi lido sai como «—» com o motivo em falta[]; chave de arquivo/.env só muda com reinício na janela combinada (reinicia:true);
// botão (acao) só nas chaves de banco cujas rotas de escrita já existem — nunca botão que finge.
export const CHAVES_BANCO = Object.freeze(['gatilhos_ligado', 'gatilhos_ligado_por', 'consultor_discord_ligado', 'consultor_discord_ligado_por', 'relatorio_agendador', 'relatorio_agendador_por',
  'alerta_auto', 'alerta_auto_por', 'dossie_mensal_ligado', 'dossie_mensal_ligado_por', 'chaveiro_execucao_parado', 'chaveiro_estoque_parado', 'ultimo_sync', 'coleta_ml_em', 'medicao_em'])
export const VARIAVEIS = Object.freeze(['NOTION_TOKEN', 'ANTHROPIC_API_KEY', 'PUBLIC_BASE_URL', 'MELI_CLIENT_ID', 'MELI_CLIENT_SECRET', 'MELI_TOKEN_KEY', 'MELI_LINK_SECRET', 'MELI_CLIENT_ID_COMERCIAL',
  'MELI_CLIENT_SECRET_COMERCIAL', 'COMERCIAL_PUBLIC_HOST', 'COMERCIAL_WHATSAPP', 'ERP_TOKEN_KEY', 'WEBHOOK_SECRET', 'SPRINT90_PUBLIC_HOST', 'MP_ACCESS_TOKEN', 'MP_WEBHOOK_SECRET', 'EMAIL_PROVEDOR',
  'PLACE_GATILHOS_URL', 'PLACE_GATILHOS_SECRET', 'HEAD_CANAIS_WHATSAPP', 'BACKUP_DIR', 'FRIO_DIR', 'VIGIA_ENVIO_LIGADO'])
export const PLISTS = Object.freeze(['servidor', 'vigia', 'backup', 'arquivar', 'git', 'cloudflared'])
export const ESTADOS = Object.freeze(['erro', 'pendente', 'desligado', 'pronto', 'ligado'])   // ordem de gravidade (a tela ordena por ela)
const REINICIE = 'reinicie na janela combinada'

const porDesde = txt => { const [por = '', desde = ''] = String(txt || '').split(' · '); return { por: por.trim(), desde: desde.trim().slice(0, 10) } }
const horas = (iso, agoraMs) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? Math.round((agoraMs - t) / 36e5 * 10) / 10 : null }
const faltam = (env, chaves) => chaves.filter(k => !env[k])
const g = (o, caminho) => caminho.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o)

// chave de banco: valor 'ligado' | 'desligado' | ausente (= padrão do arquivo, quando houver)
const chaveBanco = (estado, chave, padrao = false) => { const v = estado[chave]; return { ligado: v == null ? padrao === true : v === 'ligado', definida: v != null, ...porDesde(estado[`${chave}_por`]) } }

// ── catálogo: uma entrada por estrutura (nome claro = tabela E do doc, última linha). ler(ctx, configs) → { ligado?, estado?, falta[], detalhe?, por?, desde? }
const CAT = [
  { id: 'executor', nome: 'Executor ligado', sistema: 'chaveiro', camada: 'arquivo', escopo: 'global', chave: 'chaveiro.execucao_ligada', arquivo: 'config/chaveiro.json', ajuda: 'executor_chaveiro', ir: '/cliente?aba=executar', nasceu: '15/10/2026 (nasceu desligada)',
    ler: (c, k) => ({ ligado: g(k.chaveiro, 'execucao_ligada') === true, detalhe: 'a única escrita no ML é executarOrdem; exige ainda operação liberada, líder, estreia e confirmar' }) },
  { id: 'operacoes_live', nome: 'Operações liberadas no ML', sistema: 'chaveiro', camada: 'arquivo', escopo: 'global, por operação', chave: 'chaveiro.adaptadores_live.*', arquivo: 'config/chaveiro.json', ajuda: 'executor_chaveiro', ir: '/cliente?aba=executar', nasceu: '15/10/2026 (todas nasceram desligadas)',
    ler: (c, k) => { const ops = Object.entries(g(k.chaveiro, 'adaptadores_live') || {}).filter(([n]) => !n.startsWith('$')); const on = ops.filter(([, v]) => v === true).map(([n]) => n)
      return { ligado: on.length > 0, detalhe: `${on.length} de ${ops.length} operações ligadas${on.length ? ': ' + on.join(', ') : ''}`, falta: on.length ? [] : ['nenhuma operação ligada (preço, status, frete grátis, título, descrição, ficha, fotos, restaurar, duplicar, promoção)'] } } },
  { id: 'caminho_regras', nome: 'Quem executa cada regra', sistema: 'chaveiro', camada: 'arquivo', escopo: 'global, por regra', chave: 'chaveiro.caminho_por_regra', arquivo: 'config/chaveiro.json', ajuda: 'executor_chaveiro', ir: '/metodologia?sec=secParam',
    ler: (c, k) => { const m = g(k.chaveiro, 'caminho_por_regra') || {}, n = { automatico: 0, assistido: 0, cliente: 0 }
      for (const [r, e] of Object.entries(m)) { if (r.startsWith('$')) continue; const cs = e?.operacao_por_causa ? Object.values(e.operacao_por_causa).map(x => x.caminho) : [e?.caminho]; for (const x of cs) if (n[x] != null) n[x]++ }
      const tot = n.automatico + n.assistido + n.cliente; return { ligado: tot > 0, detalhe: `${tot} caminhos: ${n.automatico} automático · ${n.assistido} assistido · ${n.cliente} cliente (automático só escreve com o executor ligado)` } } },
  { id: 'estoque_sync', nome: 'Ajuste automático de estoque', sistema: 'chaveiro', camada: 'arquivo', escopo: 'global + por cliente + por produto', chave: 'chaveiro.sync_estoque_ligado', arquivo: 'config/chaveiro.json', ajuda: 'estoque_sync', ir: '/cliente?aba=produtos&sec=secSyncEstoque', nasceu: '15/10/2026 (nasceu desligada)',
    ler: (c, k) => ({ ligado: g(k.chaveiro, 'sync_estoque_ligado') === true, falta: g(k.algoritmo, 'produto.diagnostico_ligado') === true ? [] : ['diagnóstico por produto desligado (config/algoritmo.json → produto.diagnostico_ligado)'] }) },
  { id: 'freio_executor', nome: 'Freio geral do executor', sistema: 'chaveiro', camada: 'banco', escopo: 'global', chave: 'sync_estado.chaveiro_execucao_parado', tipo: 'freio', ajuda: 'executor_chaveiro', ir: '/cliente?aba=executar',
    acao: { tipo: 'freio', ligar: '/api/chaveiro/exec/parar', desligar: '/api/chaveiro/exec/retomar', rotulos: ['Parar tudo', 'Retomar'] },
    ler: c => ({ ligado: c.estado.chaveiro_execucao_parado === '1', detalhe: c.estado.chaveiro_execucao_parado === '1' ? 'acionado: nenhuma escrita sai do Chaveiro (execução, estoque, Ofertas live e Promoções); ordens na fila canceladas' : 'solto: as travas por operação e por cliente continuam valendo' }) },
  { id: 'freio_estoque', nome: 'Freio do estoque', sistema: 'chaveiro', camada: 'banco', escopo: 'global', chave: 'sync_estado.chaveiro_estoque_parado', tipo: 'freio', ajuda: 'estoque_sync', ir: '/cliente?aba=produtos&sec=secSyncEstoque',
    acao: { tipo: 'freio', ligar: '/api/chaveiro/estoque/parar', desligar: '/api/chaveiro/estoque/retomar', rotulos: ['Parar', 'Retomar'] },
    ler: c => ({ ligado: c.estado.chaveiro_estoque_parado === '1', detalhe: c.estado.chaveiro_estoque_parado === '1' ? 'acionado: nenhuma escrita de estoque sai; ordens abertas canceladas' : 'solto: só escreve com sync_estoque_ligado + cliente liberado' }) },
  { id: 'gatilhos', nome: 'Plano de terça ao cliente', sistema: 'morpheus', camada: 'banco', escopo: 'global + por cliente', chave: 'sync_estado.gatilhos_ligado', ajuda: 'avisos_whatsapp', ir: '/planos?sec=secAvisosAuto', nasceu: '09/10/2026 (nasceu desligada)',
    acao: { tipo: 'chave', ligar: '/api/gatilhos/chave', desligar: '/api/gatilhos/chave' },
    ler: (c, k) => { const b = chaveBanco(c.estado, 'gatilhos_ligado'); const f = faltam(c.env, ['PLACE_GATILHOS_URL', 'PLACE_GATILHOS_SECRET']).length ? ['entregador n8n não configurado (PLACE_GATILHOS_URL e PLACE_GATILHOS_SECRET)'] : []
      return { ...b, falta: f, detalhe: `terça ${g(k.gatilhos, 'semanal.hora') || '09:00'} no fuso do cliente; nada sai antes de ${g(k.gatilhos, 'inicio_envios') || '—'}; só cliente liberado por líder` } } },
  { id: 'consultor_discord', nome: 'Resumo de terça no Discord', sistema: 'morpheus', camada: 'banco', escopo: 'global + por cliente', chave: 'sync_estado.consultor_discord_ligado', ajuda: 'discord', ir: '/planos?sec=secAvisosAuto', nasceu: '12/10/2026 (nasceu desligada)',
    acao: { tipo: 'chave', ligar: '/api/consultor-discord/chave', desligar: '/api/consultor-discord/chave' },
    ler: (c, k) => { const b = chaveBanco(c.estado, 'consultor_discord_ligado'); const f = faltam(c.env, ['PLACE_GATILHOS_URL', 'PLACE_GATILHOS_SECRET']).length ? ['entregador n8n não configurado'] : []
      if ((g(k.discord_time, 'mencoes_obrigatorias') || []).length !== 3) f.push('config/discord-time.json sem os 3 cargos a marcar'); return { ...b, falta: f, detalhe: `terça ${g(k.gatilhos, 'consultor.hora') || '08:30'}; canal interno do time («Webhook ML» na central), nunca ao cliente` } } },
  { id: 'relatorio_agendador', nome: 'Relatório no Notion automático', sistema: 'morpheus', camada: 'banco', escopo: 'global + por cliente', chave: 'sync_estado.relatorio_agendador', ajuda: 'relatorio_notion', ir: '/planos?sec=secRelatorios', nasceu: '08/10/2026 (nasceu desligado)',
    acao: { tipo: 'chave', ligar: '/api/relatorio/agendador', desligar: '/api/relatorio/agendador' },
    ler: (c, k) => ({ ...chaveBanco(c.estado, 'relatorio_agendador', g(k.relatorio_envio, 'agendador_ligado')), falta: c.env.NOTION_TOKEN ? [] : ['NOTION_TOKEN ausente'], detalhe: 'sexta 17h; só envia a quem um líder liberou; plano B = tarefa no quadro do cliente' }) },
  { id: 'alerta_auto', nome: 'Alerta de pendência crítica', sistema: 'morpheus', camada: 'banco', escopo: 'global + por cliente', chave: 'sync_estado.alerta_auto', ajuda: 'alerta', ir: '/planos?sec=secAlertas', nasceu: '08/10/2026 (nasceu desligado)',
    acao: { tipo: 'chave', ligar: '/api/alertas/agendador', desligar: '/api/alertas/agendador' },
    ler: (c, k) => ({ ...chaveBanco(c.estado, 'alerta_auto', g(k.alerta, 'automatico_ligado')), falta: c.env.NOTION_TOKEN ? [] : ['NOTION_TOKEN ausente'], detalhe: 'só cliente liberado e já atendido por relatório; cooldown de 7 dias; reconferência ao vivo' }) },
  { id: 'dossie_mensal', nome: 'Prestação de contas mensal', sistema: 'morpheus', camada: 'banco', escopo: 'global (clientes em risco)', chave: 'sync_estado.dossie_mensal_ligado', ajuda: 'dossie', ir: '/planos?sec=secRisco', nasceu: '13/10/2026 (nasceu desligada)',
    acao: { tipo: 'chave', ligar: '/api/dossie/mensal', desligar: '/api/dossie/mensal' },
    ler: c => ({ ...chaveBanco(c.estado, 'dossie_mensal_ligado'), falta: faltam(c.env, ['PLACE_GATILHOS_URL', 'PLACE_GATILHOS_SECRET']).length ? ['entregador n8n não configurado'] : [], detalhe: 'dia 1 às 09:00 para risco aberto, via n8n ao canal interno; a defesa nunca sai do sistema' }) },
  { id: 'produto_diagnostico', nome: 'Diagnóstico por produto', sistema: 'arquiteto', camada: 'arquivo', escopo: 'global + por cliente', chave: 'algoritmo.produto.diagnostico_ligado', arquivo: 'config/algoritmo.json', ajuda: 'produto', ir: '/cliente?aba=produtos', nasceu: '15/10/2026 (nasceu desligada)',
    ler: (c, k) => ({ ligado: g(k.algoritmo, 'produto.diagnostico_ligado') === true, detalhe: 'com a chave desligada o plano sai byte a byte igual: a aba Produtos mostra o produto em sombra' }) },
  { id: 'financeiro_regras', nome: 'Lucro por pedido nas regras', sistema: 'smith', camada: 'arquivo', escopo: 'global', chave: 'algoritmo.financeiro.margem_medida_nas_regras', arquivo: 'config/algoritmo.json', ajuda: '', ir: '/cliente?aba=produtos&visao=lucro', nasceu: '14/10/2026 (nasceu desligada)',
    ler: (c, k) => ({ ligado: g(k.algoritmo, 'financeiro.margem_medida_nas_regras') === true, detalhe: 'liga só por decisão registrada, depois do antes × depois de 3 clientes (scripts/conferir-financeiro.mjs --plano)' }) },
  { id: 'nf', nome: 'Emissão de nota fiscal', sistema: 'smith', camada: 'arquivo', escopo: 'por cliente, chave global', chave: 'nf.ligado', arquivo: 'config/nota-fiscal.json', ajuda: 'nf', ir: '/cliente?aba=configurar&sec=secNotaFiscal', nasceu: '15/10/2026 (nasceu desligada)',
    ler: (c, k) => ({ ligado: g(k.nf, 'nf.ligado') === true, detalhe: `envio ao ML ${g(k.nf, 'nf.envio_ml_ligado') === true ? 'ligado' : 'desligado'} · produção ${g(k.nf, 'nf.producao_ligada') === true ? 'ligada' : 'desligada'}`,
      falta: [...(g(k.nf, 'intermediador.cnpj') ? [] : ['CNPJ do intermediador vazio no config (bloqueio em toda nota)'])] }) },
  { id: 'ciclos_terca', nome: 'Ciclos no plano de terça', sistema: 'morpheus', camada: 'arquivo', escopo: 'global', chave: 'algoritmo.relatorios_ciclo.blocos_terca_ligado', arquivo: 'config/algoritmo.json', ajuda: 'relatorios_ciclo', ir: '/cliente?aba=relatorios', nasceu: '15/10/2026 (nasceu desligada)',
    ler: (c, k) => ({ ligado: g(k.algoritmo, 'relatorios_ciclo.blocos_terca_ligado') === true, detalhe: 'os 8 ciclos são projeção; desligada, ao cliente nada muda' }) },
  { id: 'urgente_na_hora', nome: 'Urgente de estoque/preço na hora', sistema: 'morpheus', camada: 'arquivo', escopo: 'global + por cliente', chave: 'gatilhos.urgente.na_hora_ligado', arquivo: 'config/gatilhos.json', ajuda: 'avisos_whatsapp', ir: '/planos?sec=secAvisosAuto', nasceu: '14/10/2026 (ligada por decisão do David)',
    ler: (c, k) => ({ ligado: g(k.gatilhos, 'urgente.na_hora_ligado') === true, detalhe: `só os tipos de urgente.tipos (${(g(k.gatilhos, 'urgente.tipos') || []).length}), 1 mensagem por dia, piso R$ ${g(k.gatilhos, 'urgente.impacto_min_reais') ?? '—'}`,
      falta: faltam(c.env, ['PLACE_GATILHOS_URL', 'PLACE_GATILHOS_SECRET']).length ? ['entregador n8n não configurado'] : [] }) },
  { id: 'promocoes_exec', nome: 'Promoções: execução real', sistema: 'arquiteto', camada: 'banco', escopo: 'por cliente (promo_config)', chave: 'promo_config.execucao_habilitada', ajuda: 'promocoes', ir: '/promocoes',
    ler: c => { const n = c.promocoes_exec_clientes; return n == null ? { estado: 'pendente', falta: ['contagem não lida (tabela promo_config)'] } : { ligado: n > 0, detalhe: n > 0 ? `${n} cliente(s) com execução ligada` : 'nenhum cliente com execução ligada (nasce desligada; liga-se por cliente em Promoções › Plano)' } } },
  { id: 'sprint90_live', nome: 'Publicação real no Sprint 90', sistema: 'trinity', camada: 'arquivo', escopo: 'global (assinantes)', chave: 'sprint90.publicacao_live', arquivo: 'config/sprint90.json', ajuda: 'sprint90', ir: '/integracoes?sec=secS90',
    ler: (c, k) => ({ ligado: g(k.sprint90, 'publicacao_live') === true, falta: c.env.SPRINT90_PUBLIC_HOST ? [] : ['SPRINT90_PUBLIC_HOST ausente: nada do Sprint 90 existe'] }) },
  { id: 'whatsapp_critico', nome: 'WhatsApp do Head no crítico', sistema: 'trinity', camada: 'arquivo', escopo: 'global', chave: 'autogestao.whatsapp_critico_ligado', arquivo: 'config/autogestao.json', ajuda: 'saude_sistema', ir: '/integracoes?sec=secSaudeSistema', nasceu: '15/10/2026 (nasceu desligada)',
    ler: (c, k) => ({ ligado: g(k.autogestao, 'whatsapp_critico_ligado') === true, falta: [...(faltam(c.env, ['PLACE_GATILHOS_URL', 'PLACE_GATILHOS_SECRET']).length ? ['entregador n8n não configurado'] : []), ...(c.env.HEAD_CANAIS_WHATSAPP ? [] : ['HEAD_CANAIS_WHATSAPP ausente no .env'])] }) },
  { id: 'vigia', nome: 'Vigia avisa (sai do dry-run)', sistema: 'trinity', camada: 'env', escopo: 'global', chave: 'VIGIA_ENVIO_LIGADO', ajuda: 'saude_sistema', ir: '/integracoes?sec=secSaudeSistema',
    ler: c => ({ ligado: c.env.VIGIA_ENVIO_LIGADO === true, falta: [...(c.plists.vigia ? [] : ['agente launchd do vigia não instalado em ~/Library/LaunchAgents']), ...(c.env.VIGIA_ENVIO_LIGADO ? [] : ['VIGIA_ENVIO_LIGADO=1 no .env (hoje o vigia monta o aviso e não envia)'])],
      detalhe: c.plists.vigia ? 'vigia externo a cada 5 min (fora do Node e do banco)' : '' }) },
  { id: 'app_ml', tipo: 'infra', nome: 'App do Mercado Livre', sistema: 'trinity', camada: 'env', escopo: 'global', chave: 'MELI_CLIENT_ID · MELI_CLIENT_SECRET · MELI_TOKEN_KEY · PUBLIC_BASE_URL', ajuda: 'app_ml', ir: '/integracoes?sec=secConfig',
    ler: c => { const f = faltam(c.env, ['MELI_CLIENT_ID', 'MELI_CLIENT_SECRET', 'MELI_TOKEN_KEY', 'PUBLIC_BASE_URL', 'MELI_LINK_SECRET']); return { ligado: !f.length, falta: f.map(v => `${v} ausente`), detalhe: c.env.MELI_CLIENT_ID_COMERCIAL && c.env.MELI_CLIENT_SECRET_COMERCIAL ? 'app separado do comercial (só leitura) presente' : 'sem app separado do comercial: o prospect usa o app principal' } } },
  { id: 'notion', tipo: 'infra', nome: 'Integração com o Notion', sistema: 'trinity', camada: 'env', escopo: 'global + por cliente', chave: 'NOTION_TOKEN · sync_estado.ultimo_sync', ajuda: 'notion', ir: '/cliente?aba=resumo&sec=secNotion',
    ler: c => { const h = horas(c.estado.ultimo_sync, c.agoraMs); return { ligado: c.env.NOTION_TOKEN === true, desde: String(c.estado.ultimo_sync || '').slice(0, 10), falta: [...(c.env.NOTION_TOKEN ? [] : ['NOTION_TOKEN ausente']), ...(h == null ? ['nenhum sync completo registrado'] : h > 3 ? [`último sync há ${h} h (limiar 3 h)`] : [])], detalhe: h == null ? '' : `último sync há ${h} h` } } },
  { id: 'ia', tipo: 'infra', nome: 'IA que só redige (motor de diagnóstico)', sistema: 'arquiteto', camada: 'env', escopo: 'global', chave: 'ANTHROPIC_API_KEY', ajuda: '', ir: '/metodologia',
    ler: c => ({ ligado: c.env.ANTHROPIC_API_KEY === true, falta: c.env.ANTHROPIC_API_KEY ? [] : ['ANTHROPIC_API_KEY ausente: o relatório em PT sai sem redação da IA'], detalhe: 'a IA nunca decide: só redige sobre o contrato das 11 chaves' }) },
  { id: 'n8n', tipo: 'infra', nome: 'Entregador n8n (WhatsApp e e-mail)', sistema: 'morpheus', camada: 'env', escopo: 'global', chave: 'PLACE_GATILHOS_URL · PLACE_GATILHOS_SECRET', ajuda: 'n8n_whatsapp', ir: '/planos?sec=secAvisosAuto',
    ler: c => { const f = faltam(c.env, ['PLACE_GATILHOS_URL', 'PLACE_GATILHOS_SECRET']); return { ligado: !f.length, falta: f.map(v => `${v} ausente`), detalhe: 'os fluxos ficam fora do sistema (automacao/n8n/); 502 ou timeout vira erro com retentativa' } } },
  { id: 'erp_custos', tipo: 'infra', nome: 'Custos por ERP e planilha (infra)', sistema: 'smith', camada: 'env', escopo: 'global (fonte por cliente)', chave: 'ERP_TOKEN_KEY · WEBHOOK_SECRET', ajuda: 'custos_erp', ir: '/integracoes',
    ler: c => { const f = faltam(c.env, ['ERP_TOKEN_KEY', 'WEBHOOK_SECRET']); return { ligado: !f.length, falta: f.map(v => `${v} ausente`), detalhe: 'Bling/Tiny por OAuth só leitura; planilha por webhook HMAC; a fonte liga-se por cliente' } } },
  { id: 'sprint90', tipo: 'infra', nome: 'Place Sprint 90 (autoatendimento)', sistema: 'trinity', camada: 'env', escopo: 'global + por assinante', chave: 'SPRINT90_PUBLIC_HOST · MP_ACCESS_TOKEN · MP_WEBHOOK_SECRET · MP_MODO', ajuda: 'sprint90', ir: '/integracoes?sec=secS90',
    ler: c => { const f = faltam(c.env, ['SPRINT90_PUBLIC_HOST', 'MP_ACCESS_TOKEN', 'MP_WEBHOOK_SECRET']); return { ligado: !f.length, falta: f.map(v => `${v} ausente`), detalhe: `Mercado Pago em modo ${c.mp_modo || 'teste'}` } } },
  { id: 'enderecos', tipo: 'infra', nome: 'Endereços públicos', sistema: 'trinity', camada: 'env', escopo: 'global', chave: 'PUBLIC_BASE_URL · COMERCIAL_PUBLIC_HOST · SPRINT90_PUBLIC_HOST', ajuda: 'app_ml', ir: '/integracoes?sec=secConfig',
    ler: c => { const f = []; if (!c.env.PUBLIC_BASE_URL) f.push('PUBLIC_BASE_URL ausente: /meli/callback, /erp/callback e webhooks sem endereço'); if (!c.env.COMERCIAL_PUBLIC_HOST) f.push('COMERCIAL_PUBLIC_HOST ausente: /diagnostico e /d/:token só no localhost')
      if (!c.env.SPRINT90_PUBLIC_HOST) f.push('SPRINT90_PUBLIC_HOST ausente: /c/* não existe'); if (!c.plists.cloudflared) f.push('agente launchd do túnel (com.place2u.cloudflared) não instalado')
      return { ligado: c.env.PUBLIC_BASE_URL === true, falta: f, detalhe: 'túnel no ar: não verificado (o servidor não testa o próprio endereço público)' } } },
  { id: 'relogio', nome: 'Relógio do sistema', sistema: 'trinity', camada: 'arquivo', escopo: 'global', chave: 'autogestao.ticks', arquivo: 'config/autogestao.json', ajuda: 'saude_sistema', ir: '/integracoes?sec=secSaudeSistema',
    ler: (c, k) => { const T = g(k.autogestao, 'ticks') || {}, f = [], ok = []
      for (const [n, t] of Object.entries(T)) { if (n.startsWith('$')) continue; const m = c.ticks?.[n]; if (m == null) f.push(`${n}: sem batimento desde o início`); else if (m > 6 * t.periodo_min) f.push(`${n}: parado há ${m} min (período ${t.periodo_min})`); else if (m > 3 * t.periodo_min) f.push(`${n}: atrasado ${m} min (período ${t.periodo_min})`); else ok.push(`${n} ${t.periodo_min} min`) }
      const parado = f.some(x => /parado/.test(x)); return { estado: c.ticks == null ? 'pendente' : parado ? 'erro' : f.length ? 'pendente' : 'ligado', falta: c.ticks == null ? ['saúde do sistema não lida'] : f, detalhe: ok.join(' · ') } } },
  { id: 'backup_frio', tipo: 'infra', nome: 'Backup cifrado e arquivamento frio', sistema: 'trinity', camada: 'externo', escopo: 'global', chave: 'BACKUP_DIR · FRIO_DIR · launchd backup/arquivar', ajuda: 'backup_frio', ir: '/integracoes?sec=secSaudeSistema',
    ler: c => { const f = []; if (!c.env.BACKUP_DIR) f.push('BACKUP_DIR ausente: o backup não roda'); if (!c.env.FRIO_DIR) f.push('FRIO_DIR ausente: o frio não roda'); if (!c.plists.backup) f.push('agente launchd do backup não instalado'); if (!c.plists.arquivar) f.push('agente launchd do arquivamento não instalado')
      return { ligado: !f.length, falta: f, detalhe: 'último backup e última restauração testada: não lidos nesta tela (data/backup.log)' } } },
  { id: 'equipe', nome: 'Equipe e papéis', sistema: 'arquiteto', camada: 'arquivo', escopo: 'global', chave: 'config/equipe.json', arquivo: 'config/equipe.json', ajuda: 'equipe_papeis', ir: '/estrutura?sec=secEquipe',
    ler: (c, k) => { const d = (g(k.equipe, 'donos') || []).filter(Boolean); return { ligado: (c.equipe?.quem_pode ?? 0) > 0, falta: [...(d.length ? [] : ['nenhum dono em config/equipe.json']), ...((c.equipe?.quem_pode ?? 0) > 0 ? [] : ['nenhum líder ou consultor resolvido (central do Notion + prestadores)'])], detalhe: `${c.equipe?.quem_pode ?? '—'} pessoas podem aprovar/liberar/enviar · ${d.length} dono(s)` } } },
  { id: 'discord_time', nome: 'Cargos do Discord do time', sistema: 'morpheus', camada: 'arquivo', escopo: 'global', chave: 'config/discord-time.json', arquivo: 'config/discord-time.json', ajuda: 'discord', ir: '/planos?sec=secAvisosAuto',
    ler: (c, k) => { const m = g(k.discord_time, 'mencoes_obrigatorias') || []; return { ligado: m.length === 3, falta: m.length === 3 ? [] : [`${m.length} de 3 cargos obrigatórios`], detalhe: `${m.map(x => x.rotulo).join(' · ')}${g(k.discord_time, 'marcar_consultor_do_cliente') ? ' + consultor do cliente' : ''}` } } },
]
export const CATALOGO = Object.freeze(CAT.map(d => Object.freeze({ id: d.id, nome: d.nome, sistema: d.sistema, camada: d.camada, chave: d.chave, ajuda: d.ajuda })))

const comoMudar = d => d.camada === 'arquivo' ? `mude ${d.arquivo} e ${REINICIE}` : d.camada === 'env' ? `mude no .env e ${REINICIE}` : d.camada === 'banco' ? (d.acao ? 'muda por esta tela' : 'muda pela tela indicada em «Onde»') : 'fora do sistema: launchd, Notion ou n8n'

function linha(d, ctx) {
  let r
  try { r = d.ler(ctx, ctx.configs || {}) } catch { r = { estado: 'pendente', falta: ['leitura falhou'] } }
  const falta = [...(r.falta || [])]
  let estado = r.estado
  if (!estado) {
    if (d.tipo === 'freio') estado = r.ligado ? 'erro' : 'desligado'
    else if (r.ligado) estado = falta.length ? 'pendente' : 'ligado'
    else if (d.tipo === 'infra') estado = 'pendente'                                       // presença de variável/agente: faltando = pendente (nunca «desligado de propósito»)
    else estado = d.camada === 'banco' && d.acao && !falta.length ? 'pronto' : 'desligado'
  }
  // chave de arquivo editada depois do início do servidor: o valor carregado é o que vale até o reinício
  let reinicio_pendente = false
  if (d.camada === 'arquivo' && ctx.configs_disco) { try { reinicio_pendente = JSON.stringify(d.ler(ctx, ctx.configs_disco)) !== JSON.stringify(d.ler(ctx, ctx.configs || {})) } catch { reinicio_pendente = false } }
  if (reinicio_pendente) falta.push(`${d.arquivo} mudou depois do início do servidor: o valor acima é o carregado — ${REINICIE}`)
  const porDesdeTxt = r.por || r.desde ? '' : (d.nasceu || '')
  return { id: d.id, nome: d.nome, sistema: d.sistema, camada: d.camada, escopo: d.escopo, chave: d.chave, estado, ligado: estado === 'ligado' || (d.tipo === 'freio' && r.ligado === true),
    desde: r.desde || '', por: r.por || '', nasceu: porDesdeTxt, falta, detalhe: r.detalhe || '', ir: d.ir, ajuda: d.ajuda || '', tipo: d.tipo || 'chave',
    reinicia: d.camada === 'arquivo' || d.camada === 'env', reinicio_pendente, como_mudar: comoMudar(d), ...(d.acao ? { acao: d.acao } : {}) }
}

// ctx: { configs, configs_disco?, estado (chaves de CHAVES_BANCO), env (presença por VARIAVEIS), mp_modo?, ticks?, sinais?, incidentes?, plists, promocoes_exec_clientes?, equipe?:{quem_pode}, agora? }
export function montarEstrutura(ctx = {}) {
  const agora = ctx.agora || new Date().toISOString(), c = { plists: {}, env: {}, estado: {}, ...ctx, agoraMs: Date.parse(ctx.agora || agora) }
  const linhas = CAT.map(d => linha(d, c)).sort((a, b) => ESTADOS.indexOf(a.estado) - ESTADOS.indexOf(b.estado))
  const n = k => linhas.filter(l => l.estado === k).length
  const abertos = ctx.incidentes?.abertos || []
  return { lido_em: agora, linhas, resumo: { total: linhas.length, ligadas: n('ligado'), prontas: n('pronto'), desligadas: n('desligado'), pendentes: n('pendente'), erros: n('erro') },
    incidentes: ctx.incidentes ? { abertos: abertos.length, criticos: abertos.filter(i => i.nivel === 'critico').length, itens: abertos.slice(0, 10).map(i => ({ sinal_id: i.sinal_id, nivel: i.nivel, rotulo: i.rotulo || i.sinal_id, dono: i.dono || '' })) } : null }
}

// pré-requisito de config/ajuda.json (campo verificar): só os GLOBAIS são lidos aqui; os por cliente ficam sem_leitura com o motivo (F3 lê o global)
export function verificar(id, ctx = {}) {
  const c = { env: {}, estado: {}, plists: {}, ...ctx }, pres = (...ks) => ks.every(k => c.env[k] === true), k = c.configs || {}
  const pend = m => ({ estado: 'pendente', motivo: m }), ok = m => ({ estado: 'ok', motivo: m || '' })
  const tern = (b, m) => (b ? ok() : pend(m))
  const sinal = sid => c.sinais?.find(s => s.id === sid)
  switch (id) {
    case 'env.meli_app': return tern(pres('MELI_CLIENT_ID', 'MELI_CLIENT_SECRET'), 'MELI_CLIENT_ID ou MELI_CLIENT_SECRET ausente')
    case 'env.meli_token_key': return tern(pres('MELI_TOKEN_KEY'), 'MELI_TOKEN_KEY ausente')
    case 'env.public_base_url': return tern(pres('PUBLIC_BASE_URL'), 'PUBLIC_BASE_URL ausente')
    case 'env.notion_token': return tern(pres('NOTION_TOKEN'), 'NOTION_TOKEN ausente')
    case 'env.n8n': return tern(pres('PLACE_GATILHOS_URL', 'PLACE_GATILHOS_SECRET'), 'PLACE_GATILHOS_URL ou PLACE_GATILHOS_SECRET ausente')
    case 'env.sprint90_host': return tern(pres('SPRINT90_PUBLIC_HOST'), 'SPRINT90_PUBLIC_HOST ausente')
    case 'env.mercado_pago': return tern(pres('MP_ACCESS_TOKEN', 'MP_WEBHOOK_SECRET'), 'MP_ACCESS_TOKEN ou MP_WEBHOOK_SECRET ausente')
    case 'produto.diagnostico_ligado': return tern(g(k.algoritmo, 'produto.diagnostico_ligado') === true, 'desligada em config/algoritmo.json')
    case 'chaveiro.execucao_ligada': return tern(g(k.chaveiro, 'execucao_ligada') === true, 'execucao_ligada desligada em config/chaveiro.json')
    case 'chaveiro.freio': return c.estado.chaveiro_execucao_parado === '1' ? { estado: 'erro', motivo: 'freio geral acionado' } : ok()
    case 'discord.chave': return tern(chaveBanco(c.estado, 'consultor_discord_ligado').ligado, 'consultor_discord_ligado desligada')
    case 'discord.cargos': return tern((g(k.discord_time, 'mencoes_obrigatorias') || []).length === 3, 'config/discord-time.json sem os 3 cargos')
    case 'alerta.automatico': return tern(chaveBanco(c.estado, 'alerta_auto', g(k.alerta, 'automatico_ligado')).ligado, 'alerta_auto desligado')
    case 'relatorio.agendador': return tern(chaveBanco(c.estado, 'relatorio_agendador', g(k.relatorio_envio, 'agendador_ligado')).ligado, 'agendador desligado')
    case 'notion.sync_3h': { const h = horas(c.estado.ultimo_sync, c.agoraMs ?? Date.now()); return h == null ? pend('nenhum sync completo registrado') : tern(h <= 3, `último sync há ${h} h`) }
    case 'autogestao.plists': { const f = ['servidor', 'vigia', 'backup'].filter(p => !c.plists[p]); return tern(!f.length, `não instalado: ${f.join(', ')}`) }
    case 'autogestao.api_saude': return tern(Array.isArray(c.sinais), 'saúde do sistema não lida')
    case 'autogestao.disco': { const s = sinal('trinity.disco'); return !s ? pend('disco não lido') : s.estado === 'ok' ? ok(`${s.valor} GB livres`) : s.estado === 'sem_dado' ? pend('sem leitura') : { estado: s.estado === 'critico' ? 'erro' : 'pendente', motivo: `${s.valor} GB livres` } }
    case 'equipe.lista': return tern((c.equipe?.quem_pode ?? 0) > 0, 'nenhum líder ou consultor resolvido')
    case 'backup.destinos': return tern(pres('BACKUP_DIR', 'FRIO_DIR'), 'BACKUP_DIR ou FRIO_DIR ausente')
    default: return { estado: 'sem_leitura', motivo: /^(backup|n8n\.fluxos|sprint90\.termos)/.test(id) ? 'fora do sistema: não lido nesta tela' : 'por cliente: a tela de Estruturas lê só o global' }
  }
}
