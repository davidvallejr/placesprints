// Avisos ao cliente (gatilhos do Merovíngio, 09/10/2026): o servidor decide tudo (fontes, dedupe, cooldown, auditoria, chave, liberação, janela); esta tela só mostra e pede.
// 12/10/2026: só Mercado Livre; ao cliente vai SÓ o plano semanal (TERÇA 09h, fuso do cliente; decisões finais): o urgente entra no plano de terça (a caixa «Urgente sai
// na hora» saiu da tela; config urgente.na_hora_ligado = true desde 14/10/2026 por decisão do David: só os tipos de urgente.tipos saem fora da terça); Discord é canal interno da equipe (fora daqui): o time recebe em todos os clientes ML com canal, independente do WhatsApp do cliente.
// window.PSGatilhos.montarConfig(alvo, cliente) (Configurar › Canais do cliente), .montarResumo(alvo, cliente) (Resumo › Avisos ao cliente: fila e recibos) e .montarPlanos() (Distribuir ao Notion › Plano de terça: chave e recibos).
// Tudo que vem do servidor passa por esc(); sem botão primário novo (o diálogo usa os botões do PSRelatorio.ui); valor de KPI nunca colorido; destino do canal nunca vai a log.
(() => {
  if (window.PSGatilhos) return

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const $ = id => document.getElementById(id)
  const brData = iso => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—'
  const brHora = iso => iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
  const api = async (url, body) => {
    const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.erro || `erro ${r.status}`)
    return j
  }
  const toast = (t, tipo) => window.PS?.toast ? PS.toast(t, tipo) : alert(t)
  const ui = () => window.PSRelatorio?.ui || null
  const lerNome = () => { try { return window.PS?.quem?.().nome || localStorage.getItem('ps_perfil_por') || '' } catch { return '' } }   // padrão = «Quem sou» do topo (F2)
  const erroBloco = (alvo, e, denovo) => { alvo.innerHTML = `<div class="erro-bloco"><b>Não foi possível carregar</b><div>${esc(e.message)}</div><button class="btn btn-p" type="button" data-denovo>Tentar de novo</button></div>`; alvo.querySelector('[data-denovo]').onclick = denovo }
  const kp = (rot, v, det) => `<div class="kpi"><div class="rotulo">${rot}</div><div class="valor">${v}</div><div class="detalhe">${det}</div></div>`

  const CANAIS = [['whatsapp', 'WhatsApp (grupo do Mercado Livre)', 'text', 'id do grupo do Mercado Livre (…@g.us)'], ['email', 'E-mail', 'email', 'nome@empresa.com.br'], ['notion', 'Notion do cliente', null, '']]
  const ESTADO = { interno: ['neutro', 'Só para a equipe'], pendente: ['atencao', 'Aguardando (urgente)'], agrupado: ['neutro', 'No plano de terça'], enviado: ['azul', 'Enviado'], entregue: ['bom', 'Entregue'], suprimido: ['neutro', 'Suprimido'], falhou: ['ruim', 'Falhou'], resolvido: ['bom', 'Resolvido'], montado: ['neutro', 'Montado'], parcial: ['atencao', 'Entrega parcial'] }
  const LOTE = { semanal: 'plano semanal', imediato: 'urgente', compras: 'micro de compras' }
  const ROT_BLOCO = { estatisticas: 'Vendas', plano: 'Plano da semana (estoque e conta)', compras: 'Compras e previsibilidade', entregas: 'O que já fizemos', acoes_semana: 'O que a equipe fez na semana', causa: 'Causa e efeito', atencao: 'Anúncios que pedem atenção', ads: 'Ads', promocoes: 'Promoções', concorrencia: 'Concorrência', acoes_vendas: 'Ações para vender mais', criacao: 'Criação e melhoria de anúncios' }
  const CLASSE = { critico: ['ruim', 'Crítico'], atencao: ['atencao', 'Atenção'], info: ['neutro', 'Informativo'] }
  const selo = (m, k) => { const [cls, rot] = m[k] || ['neutro', k || '—']; return `<span class="selo ${cls}">${esc(rot)}</span>` }

  // ── diálogo de prévia → envio manual (molde do alerta): o que o líder leu é o que sai (hash) ───────────────────────────
  async function enviar(cliente, { tipo = 'semanal', aoConcluir } = {}) {
    const U = ui(); if (!U) { toast('Recarregue a página: o módulo de diálogos não carregou.', 'erro'); return }
    const { corpo, rodape, fechar } = U.dialogo(`Aviso ao cliente · ${cliente}`)
    corpo.innerHTML = `<p>Monta ${tipo === 'imediato' ? 'o aviso urgente (só os pontos urgentes, até 3)' : 'o plano da semana (o mesmo texto que sai na terça às 09h; se o desta semana já foi montado, é ele que aparece)'} com o que depende do cliente no Mercado Livre (o que é da equipe nunca entra) e mostra o texto antes de enviar. Nada sai até você confirmar; o envio manual ignora a chave geral e a janela, mas exige canal ligado.</p>${U.campoPor('gtPor')}<div id="gtSaida"></div>`
    const saida = corpo.querySelector('#gtSaida')
    const previaBt = U.botao('Ver prévia', { aoClicar: async () => {
      const por = U.lerPor(corpo, 'gtPor'); if (!por) { saida.innerHTML = U.aviso('erro', 'Informe seu nome.'); return }
      U.gravarNome(por); previaBt.disabled = true; saida.innerHTML = '<div class="mini">Montando a prévia…</div>'
      let r
      try { r = await api('/api/gatilhos/previa', { cliente, tipo }) } catch (e) { saida.innerHTML = U.aviso('erro', esc(e.message)); previaBt.disabled = false; return }
      if (r.vazio) { saida.innerHTML = U.aviso('', 'Nada a avisar para este cliente agora.'); return }
      if (r.bloqueado) { saida.innerHTML = U.aviso('erro', `<b>Conteúdo bloqueado por segurança.</b> ${esc(r.motivo || '')}. Nada será enviado.`); return }
      const el = r.elegivel || {}
      // relatório personalizado (Etapa 3): quais blocos entraram, na ordem, e quais vieram do perfil do cliente; em quantas mensagens sai no WhatsApp
      const perfilTxt = !r.perfil ? '' : r.perfil.fonte === 'padrao' ? 'cliente sem perfil: ordem padrão da carteira' : `perfil do cliente (${esc(r.perfil.fonte)}${r.perfil.nivel && r.perfil.nivel !== 'padrao' ? `, nível ${esc(r.perfil.nivel)}` : ''})`
      const blocosTxt = r.secoes ? `<p class="mini" id="gtBlocos">Blocos, na ordem (${perfilTxt}): ${r.secoes.map(x => `${esc(ROT_BLOCO[x.chave] || x.chave)}${x.pedido ? ' <b>· pedido pelo cliente</b>' : ''}${x.conteudo ? '' : ' (sem dado novo)'}`).join(' · ')}</p>` : ''
      const partesTxt = r.n_partes > 1 ? `<p class="mini" id="gtPartes">No WhatsApp sai em ${esc(String(r.n_partes))} mensagens, na ordem (acima de ~4.000 caracteres; o corte é só entre blocos).</p>` : ''
      saida.innerHTML = `${blocosTxt}${partesTxt}<details class="recolhido" open><summary>Texto que o cliente vai ler (${esc(LOTE[r.tipo] || r.tipo || '')}, ${esc(String(r.n))} ${r.tipo === 'semanal' ? 'ação(ões)' : 'ponto(s)'})</summary><div class="rl-linhas">${(r.linhas || [r.texto_final]).map(esc).join('\n')}</div></details>
        ${el.ok === false ? U.aviso('erro', `<b>Não dá para enviar agora.</b> ${esc(el.mensagem || el.motivo || '')}`) : ''}<div id="gtResp"></div>`
      previaBt.remove()
      if (el.ok === false) return
      const okBt = U.botao('Enviar ao cliente', { primario: true, aoClicar: async e => {
        const resp = saida.querySelector('#gtResp'); e.currentTarget.disabled = true; resp.innerHTML = '<div class="mini">Enviando…</div>'
        try {
          const x = await api('/api/gatilhos/enviar', { cliente, por, confirmar: true, tipo, hash: r.hash })
          if (x.ok === false) { resp.innerHTML = U.aviso('erro', `<b>Não foi enviado.</b> ${esc(x.mensagem || x.estado || '')}`); e.currentTarget.disabled = false; return }
          resp.innerHTML = U.aviso('ok', '<b>Aviso enviado.</b> O recibo por canal chega em seguida.'); rodape.replaceChildren(U.botao('Fechar', { primario: true, aoClicar: fechar })); toast('Aviso enviado ao cliente.'); aoConcluir?.(x)
        } catch (err) { resp.innerHTML = U.aviso('erro', esc(err.message)); e.currentTarget.disabled = false }
      } })
      rodape.append(okBt)
    } })
    rodape.append(U.botao('Fechar', { aoClicar: fechar }), previaBt)
  }

  // ── Resumo do cliente: fila, último lote e recibos (≤4 KPIs sem cor; tabela de 6 colunas) ─────────────────────────────
  // Duas listas (pedido do David, 12/10/2026): «Vai para o cliente» (só o que depende dele) e «Só para a equipe» (trabalho da assessoria ou preço de origem não verificada: nunca sai)
  async function montarResumo(alvo, cliente) {
    if (!alvo) return
    let r
    try { r = await api('/api/cliente/gatilhos?cliente=' + encodeURIComponent(cliente)) } catch (e) { erroBloco(alvo, e, () => montarResumo(alvo, cliente)); return }
    const todos = r.fila || [], fila = todos.filter(i => i.para_cliente !== false), equipe = todos.filter(i => i.para_cliente === false)
    const crit = fila.filter(i => i.classe === 'critico').length, ul = r.ultimo_lote, el = r.elegivel || {}
    const rec = l => Object.entries(l?.recibos || {}).map(([k, v]) => `${esc(k)}: ${esc(v.estado)}`).join(' · ') || '—'
    alvo.innerHTML = `
      <p class="veredito-frase" id="gtVeredito">${fila.length ? `<b>${esc(String(fila.length))}</b> ponto(s) na fila deste cliente, ${esc(String(crit))} crítico(s)` : '<b>Nada na fila</b> para este cliente agora'} · envio automático ${el.ok ? 'liberado e dentro da janela' : `<span class="mudo">${esc(el.mensagem || 'não elegível')}</span>`}</p>
      <div class="kpis" id="gtKpis">${kp('Na fila', fila.length, 'itens detectados e ainda não entregues')}${kp('Críticos', crit, 'vão no plano de terça (na hora só se marcado)')}${kp('Último lote', ul ? esc(ESTADO[ul.estado]?.[1] || ul.estado) : '—', ul ? `${esc(ul.tipo)} · ${esc(brHora(ul.criado_em))}` : 'nenhum lote ainda')}${kp('Chave geral', r.automatico?.ligado ? 'ligada' : 'desligada', 'envio automático a clientes liberados')}</div>
      ${ul ? `<details class="recolhido"><summary>Última mensagem: ${esc(LOTE[ul.tipo] || ul.tipo)} de ${esc(brData(ul.dia))}${ul.motivo ? ` · ${esc(ul.motivo)}` : ''}</summary><div class="rl-linhas">${(ul.linhas || []).map(esc).join('\n')}</div><div class="mini mt-2">Canais: ${esc(ul.canais.join(', ') || '—')} · Recibos: ${rec(ul)}</div></details>` : ''}
      <h4 class="mt-2">Vai para o cliente</h4><p class="mini">Só o que depende do cliente no Mercado Livre. Urgente (estoque no fim dos campeões, despacho vencido, reclamação, reputação, anúncio pausado, queda depois de mudança de preço) entra no plano de terça em bloco próprio (nada sai fora da terça); o resto (reposição, Full, perguntas, preço mudado fora da Place2u, custos, retornos) também vai no plano de terça.</p>
      <div class="tabela-wrap mt-2"><table class="t empilha" id="gtTabela"><caption class="sr">Avisos ao cliente ${esc(cliente)}</caption><thead><tr><th scope="col">Aviso</th><th scope="col">Classe</th><th scope="col">Situação</th><th scope="col">Detectado</th><th scope="col">Lote</th><th scope="col">Motivo</th></tr></thead><tbody>${fila.length ? fila.map(i => `<tr>
        <td><b>${esc(i.rotulo)}</b><div class="mini">${esc(i.texto || '(texto suprimido)')}</div></td><td>${selo(CLASSE, i.classe)}</td><td>${selo(ESTADO, i.estado)}</td><td>${esc(brData(i.criado_em))}</td>
        <td>${i.lote_id ? `<span class="mini">${esc(i.lote_id.slice(0, 8))}…</span>` : '<span class="mudo">—</span>'}${i.enviado_em ? `<div class="mini">enviado ${esc(brData(i.enviado_em))}</div>` : ''}</td><td>${i.motivo ? esc(i.motivo) : '<span class="mudo">—</span>'}</td></tr>`).join('')
        : `<tr><td colspan="6" class="vazio"><b>Nenhum aviso pendente.</b> Quando as fontes (estoque, saúde da conta, preço, pendências) apontarem algo que depende do cliente, aparece aqui. O plano da semana também lê o estoque direto do diagnóstico: use a prévia.</td></tr>`}</tbody></table></div>
      <h4 class="mt-2" id="gtEquipeTitulo">Só para a equipe (${esc(String(equipe.length))})</h4><p class="mini">Trabalho da assessoria (Ads, promoções, promoção que terminou e devolveu o preço cheio, queda sem causa do lado do cliente) e mudança de preço cuja origem não deu para confirmar. Nunca vai ao cliente.</p>
      <ul class="mini" id="gtEquipe">${equipe.length ? equipe.map(i => `<li><b>${esc(i.rotulo)}</b> · ${selo(CLASSE, i.classe)} ${esc(i.texto || '')}${i.motivo && i.estado !== 'interno' ? ` <span class="mudo">(${esc(ESTADO[i.estado]?.[1] || i.estado)}: ${esc(i.motivo)})</span>` : i.motivo_codigo === 'origem_nao_verificada' ? ` <span class="mudo">${esc(i.motivo)}</span>` : ''}</li>`).join('') : '<li class="mudo">Nada para a equipe agora.</li>'}</ul>
      <h4 class="mt-2" id="gtConsultorTitulo">Para o consultor (Discord)</h4><p class="mini">Resumo interno no canal do cliente no Discord («Webhook ML»; o cliente não está lá), terça 08h30 no fuso do cliente, antes do plano ao cliente: o que está dando resultado, o que vale revisar antes de repetir, os pontos da assessoria e o que o cliente leu. O time recebe em todos os clientes ML com canal; independe do WhatsApp do cliente. Marca os 3 cargos do time e o consultor («Discord ID Consultor ML»). Os pontos urgentes da assessoria vão no resumo de terça.</p>
      <div class="mini" id="gtConsultor">Carregando…</div>
      <div class="mt-2"><button class="btn btn-p" type="button" id="btnGtPrevia">Ver prévia do plano da semana</button> <a class="btn btn-fantasma btn-p" href="/cliente?cliente=${encodeURIComponent(cliente)}&amp;aba=configurar">Configurar canais</a></div>
      ${r.resolvidos?.length ? `<details class="recolhido mt-2"><summary>Resolvidos recentes (${esc(String(r.resolvidos.length))})</summary><ul class="mini">${r.resolvidos.slice(0, 10).map(x => `<li>${esc(x.rotulo)} · resolvido em ${esc(brData(x.resolvido_em))}</li>`).join('')}</ul></details>` : ''}`
    $('btnGtPrevia').onclick = () => enviar(cliente, { aoConcluir: () => montarResumo(alvo, cliente) })
    montarConsultor($('gtConsultor'), cliente)
  }

  // ── Para o consultor (Discord): estado leve na hora; a prévia do resumo semanal só monta quando o líder abre (lê medidas e padrões da base) ───────────────
  // prévia sem canal: só afirma «falta o Webhook ML» quando a central foi lida (sem_destino); Notion fora do ar não é falta de cadastro
  const CANAL_MOT = { notion_token_ausente: ' Base Clientes do Notion indisponível agora (Notion não configurado): não deu para conferir o «Webhook ML» nem o consultor.', notion_sem_permissao: ' Base Clientes do Notion indisponível agora (sem permissão de leitura): não deu para conferir o «Webhook ML» nem o consultor.',
    notion_indisponivel: ' Base Clientes do Notion indisponível agora: não deu para conferir o «Webhook ML» nem o consultor.', destino_indisponivel: ' Base Clientes do Notion indisponível agora: não deu para conferir o «Webhook ML» nem o consultor.',
    cliente_nao_esta_na_central: ' Cliente não encontrado na base Clientes do Notion: este cliente não recebe.', mais_de_uma_linha_na_central: ' Mais de uma linha com este nome na base Clientes do Notion: este cliente não recebe até corrigir.' }
  const ESTADO_CD = { montado: 'montado', pendente: 'não saiu', enviado: 'enviado ao n8n', entregue: 'entregue no Discord', falhou: 'falhou' }
  async function montarConsultor(alvo, cliente) {
    if (!alvo) return
    let r
    try { r = await api('/api/cliente/consultor-discord?cliente=' + encodeURIComponent(cliente)) } catch (e) { alvo.innerHTML = `<span class="mudo">Não foi possível carregar: ${esc(e.message)}</span>`; return }
    const u = r.ultimo
    alvo.innerHTML = `<p>Chave do Discord ${r.chave?.ligado ? 'ligada' : '<span class="mudo">desligada</span>'} · ${r.recebe?.ok ? 'o time recebe neste cliente' : `<span class="mudo">o time não recebe neste cliente${r.recebe?.mensagem ? `: ${esc(r.recebe.mensagem)}` : ''}</span>`}${u ? ` · último: ${esc(u.tipo === 'interno_semanal' ? 'resumo semanal' : 'urgente')} de ${esc(brData(u.dia))}, ${esc(ESTADO_CD[u.estado] || u.estado)}${u.mencao ? ', com menção' : ''}${u.motivo_texto ? ` <span class="mudo">— ${esc(u.motivo_texto)}</span>` : ''}` : ' · nada enviado ainda'}</p>
      <details class="recolhido" id="gtConsultorPrevia"><summary>Prévia do resumo semanal ao consultor</summary><div id="gtConsultorTexto" class="mini">Abra para montar a prévia…</div></details>`
    const det = $('gtConsultorPrevia')
    det.addEventListener('toggle', async () => {
      if (!det.open || det.dataset.lido) return
      det.dataset.lido = '1'
      try {
        const x = (await api('/api/cliente/consultor-discord?previa=1&cliente=' + encodeURIComponent(cliente))).previa || {}
        const partes = x.partes || []
        $('gtConsultorTexto').innerHTML = `<p class="mini">${x.ja_existia ? 'Resumo desta semana já montado (é o que saiu ou vai sair).' : 'Prévia: nada foi gravado nem enviado.'} ${esc(String(partes.length))} parte(s) de até 1.900 caracteres, exatamente como saem: os 3 cargos do time${x.mencoes?.consultor ? ' e o consultor' : (x.canal === false && CANAL_MOT[x.canal_motivo] ? '' : ' (sem o consultor: falta o «Discord ID Consultor ML» válido)')} marcados no início da 1ª.${x.canal === false ? (CANAL_MOT[x.canal_motivo] || ' Sem «Webhook ML» válido na central: este cliente não recebe.') : ''}</p>${partes.map((p, i) => `<div class="mini mt-2">Parte ${i + 1} de ${partes.length}</div><div class="rl-linhas">${esc(p)}</div>`).join('')}`
      } catch (e) { delete det.dataset.lido; $('gtConsultorTexto').innerHTML = `<span class="mudo">${esc(e.message)}</span>` }
    })
  }

  // ── Configurar: canais (ligado + destino), ritmo, silêncio, liberação e teste de canal ─────────────────────────────────
  async function montarConfig(alvo, cliente) {
    if (!alvo) return
    let r
    try { r = await api('/api/cliente/gatilhos?cliente=' + encodeURIComponent(cliente)) } catch (e) { erroBloco(alvo, e, () => montarConfig(alvo, cliente)); return }
    const n = r.notificacao || { canais: {}, ritmo: {}, silencio: {} }
    alvo.innerHTML = `
      <p class="mini">${n.liberado_por ? `Liberado por <b>${esc(n.liberado_por)}</b> em ${esc(brData(n.liberado_em))}.` : 'Ainda não liberado: nenhum aviso automático sai para este cliente.'} Chave geral ${r.automatico?.ligado ? 'ligada' : 'desligada'}${r.elegivel?.ok ? '' : ` · ${esc(r.elegivel?.mensagem || '')}`}</p>
      <div class="form-grade" id="avCanais">${CANAIS.map(([k, rot, tipo, ph]) => `<div class="campo"><label class="rl-opcao"><input type="checkbox" id="avLig-${k}" ${n.canais?.[k]?.ligado ? 'checked' : ''}> <span>${rot}</span></label>
        ${tipo ? `<input type="${tipo}" id="avDest-${k}" maxlength="254" placeholder="${esc(ph)}" value="${esc(n.canais?.[k]?.destino || '')}" aria-label="Destino ${rot}"><button class="btn btn-p mt-2" type="button" data-testar="${k}">Testar canal</button>` : '<span class="mini">página «Plano da semana» / «Ponto importante da conta» na base Informações do cliente (sem n8n)</span>'}</div>`).join('')}</div>
      <p class="mini">Plano semanal toda terça às 09h no fuso do cliente (até 20h; fora disso espera a próxima terça). Discord é canal interno da equipe e não recebe aviso ao cliente.</p>
      <div class="form-grade mt-2">
        <label class="campo"><span class="pf-rot">Nome do cliente na mensagem</span><input type="text" id="avRotulo" maxlength="60" placeholder="${esc(cliente)}" value="${esc(n.rotulo || '')}"></label>
        <label class="campo"><span class="pf-rot">Silêncio de</span><input type="time" id="avSilDe" value="${esc(n.silencio?.de || '21:00')}"></label>
        <label class="campo"><span class="pf-rot">até</span><input type="time" id="avSilAte" value="${esc(n.silencio?.ate || '07:00')}"></label>
        <label class="campo"><span class="pf-rot">Fuso do cliente (IANA)</span><input type="text" id="avFuso" maxlength="64" value="${esc(n.fuso || 'America/Sao_Paulo')}"></label>
      </div>
      <label class="campo" for="avPor"><span class="pf-rot">Seu nome (líder ou consultor)</span><input id="avPor" type="text" maxlength="80" autocomplete="name" value="${esc(lerNome())}"></label>
      <div class="pf-rodape"><button class="btn" type="button" id="btnAvisosSalvar">Salvar avisos</button> <button class="btn btn-fantasma" type="button" id="btnAvisosCentral">Preencher com a central do Notion</button> <button class="btn btn-p" type="button" id="btnAvisosLiberar">${n.liberado_por ? 'Revogar liberação' : 'Liberar avisos automáticos'}</button></div>
      <div id="avMsg" class="mt-2"></div>`
    const msg = (t, okk) => { $('avMsg').innerHTML = `<div class="aviso ${okk ? 'ok' : 'erro'}">${esc(t)}</div>` }
    const por = () => { const p = $('avPor').value.trim(); if (!p) { msg('Informe seu nome; ele fica registrado na decisão.', false); $('avPor').focus() } else { try { localStorage.setItem('ps_perfil_por', p) } catch { /* sem armazenamento */ } } return p }
    const ler = () => ({ canais: Object.fromEntries(CANAIS.map(([k, , tipo]) => [k, { ligado: $(`avLig-${k}`).checked, ...(tipo ? { destino: $(`avDest-${k}`).value.trim() } : {}) }])),
      silencio: { de: $('avSilDe').value || '21:00', ate: $('avSilAte').value || '07:00' }, fuso: $('avFuso').value.trim() || 'America/Sao_Paulo', rotulo: $('avRotulo').value.trim() })
    $('btnAvisosSalvar').onclick = async e => {
      const p = por(); if (!p) return
      e.currentTarget.disabled = true
      try { await api('/api/cliente/notificacao', { cliente, por: p, notificacao: ler() }); toast('Avisos do cliente salvos.'); montarConfig(alvo, cliente) } catch (x) { msg(x.message, false); e.currentTarget.disabled = false }
    }
    $('btnAvisosCentral').onclick = async e => {
      const p = por(); if (!p) return
      e.currentTarget.disabled = true
      const ROT = { whatsapp: 'WhatsApp (grupo do Mercado Livre)', email: 'E-mail' }, MOT = { notion_token_ausente: 'Notion não configurado neste servidor.', notion_sem_permissao: 'A integração não lê a base Clientes do Notion.', notion_indisponivel: 'Notion indisponível agora; tente de novo.', cliente_nao_esta_na_central: 'Cliente não encontrado na base Clientes do Notion.', mais_de_uma_linha_na_central: 'Mais de uma linha com este nome na base Clientes: preencha à mão.', cliente_invalido: 'Cliente inválido.' }
      try {
        const x = await api('/api/cliente/notificacao/central', { cliente, por: p })
        if (!x.ok) { msg(MOT[x.motivo] || 'Não foi possível ler a central.', false); e.currentTarget.disabled = false; return }
        const inv = (x.invalidos || []).length ? ` ${x.invalidos.length} campo(s) da central com formato inválido foram ignorados.` : ''
        const int = x.interno ? ` Interno da equipe: Discord do cliente ${x.interno.discord ? 'encontrado' : 'ausente'} («Webhook ML»), consultor ${x.interno.consultor ? 'encontrado' : 'ausente'} («Discord ID Consultor ML»).` : ''
        if (!x.preenchidos.length) { msg('Nada a preencher: os destinos já estão preenchidos ou a central não tem o grupo de WhatsApp do Mercado Livre nem e-mail.' + inv + int, true); e.currentTarget.disabled = false; return }
        toast(`Preenchido da central: ${x.preenchidos.map(q => ROT[q.canal] || q.canal).join(', ')}. Confira, ligue o canal e teste.` + inv + int); montarConfig(alvo, cliente)
      } catch (x) { msg(x.message, false); e.currentTarget.disabled = false }
    }
    $('btnAvisosLiberar').onclick = async e => {
      const p = por(); if (!p) return
      const liberar = !n.liberado_por
      if (!(await (window.PS?.confirmar ?? (o => Promise.resolve(confirm(o.titulo))))({ titulo: liberar ? `Liberar avisos automáticos para ${cliente}?` : `Revogar a liberação de ${cliente}?`, texto: liberar ? 'Com a chave geral ligada, o plano semanal sai na terça às 09h nos canais ligados acima (os urgentes vão nele; nada sai fora da terça). Teste o canal antes (a partir do início dos envios).' : 'Nenhum aviso automático sai para este cliente até nova liberação.', rotuloOk: liberar ? 'Liberar' : 'Revogar' }))) return
      e.currentTarget.disabled = true
      try { const x = await api('/api/gatilhos/liberar', { clientes: [cliente], por: p, liberar }); if (x.ignorados?.length) msg('Ligue ao menos um canal antes de liberar.', false); else { toast(liberar ? 'Cliente liberado.' : 'Liberação revogada.'); montarConfig(alvo, cliente) } } catch (x) { msg(x.message, false) } finally { e.currentTarget.disabled = false }
    }
    alvo.querySelectorAll('[data-testar]').forEach(b => { b.onclick = async () => {
      const p = por(); if (!p) return
      b.disabled = true; b.textContent = 'Testando…'
      try { const x = await api('/api/gatilhos/teste', { cliente, canal: b.dataset.testar, por: p }); msg(x.ok ? 'Pedido de teste aceito pelo n8n (o teste não devolve recibo): confirme com o cliente que a mensagem chegou antes de liberar.' : x.mensagem || x.estado, !!x.ok) } catch (x) { msg(x.message, false) } finally { b.disabled = false; b.textContent = 'Testar canal' }
    } })
  }

  // ── Distribuição: interruptor da chave geral, clientes liberados, lotes com falha/pendência (6 colunas) ───────────────
  async function montarPlanos() {
    const tb = $('tbAvisosFalhas'); if (!tb) return
    let r
    try { r = await api('/api/gatilhos/pendentes') } catch (e) { tb.innerHTML = `<tr><td colspan="6"><div class="erro-bloco"><b>Não foi possível carregar</b>${esc(e.message)}</div></td></tr>`; return }
    const ligado = !!r.automatico?.ligado
    $('avAutoEstado').innerHTML = `<span class="selo ${ligado ? 'bom' : 'atencao'}">Avisos automáticos ${ligado ? 'ligados' : 'desligados'}</span>${r.n8n?.configurado === false ? ' <span class="mini">· entrega n8n não configurada (PLACE_GATILHOS_URL/SECRET)</span>' : ''}`
    $('btnGatilhosAuto').textContent = ligado ? 'Desligar avisos automáticos' : 'Ligar avisos automáticos'
    $('nAvisosAuto').textContent = r.liberados?.length ? String(r.liberados.length) : ''
    $('avLiberados').innerHTML = r.liberados?.length ? `Liberados (${esc(String(r.liberados.length))}): ${r.liberados.map(l => `<a href="/cliente?cliente=${encodeURIComponent(l.cliente)}&amp;aba=configurar">${esc(l.cliente)}</a> <span class="mini">(${esc(l.canais.join(', '))})</span>`).join(' · ')}` : 'Nenhum cliente liberado: nada sai sozinho. Libere na ficha do cliente › Configurar › Avisos ao cliente.'
    const fila = r.fila || []
    $('avResumo').textContent = `${fila.reduce((t, f) => t + f.n, 0)} ponto(s) na fila em ${fila.length} cliente(s) · ${r.lotes_7d ?? 0} lote(s) nos últimos 7 dias · ${(r.falhas || []).length} com falha ou pendência`
    tb.innerHTML = (r.falhas || []).length ? r.falhas.slice(0, 50).map(l => `<tr><td><a href="/cliente?cliente=${encodeURIComponent(l.cliente)}&amp;aba=resumo">${esc(l.cliente)}</a></td><td><span class="mini">${esc(l.id.slice(0, 8))}…</span></td><td>${esc(l.tipo)}</td><td>${selo(ESTADO, l.estado)}${l.motivo ? `<div class="mini">${esc(l.motivo)}</div>` : ''}</td><td>${esc(l.canais.join(', ') || '—')}</td><td>${esc(brHora(l.tentado_em || l.criado_em))}<div><button class="btn btn-p" type="button" data-reenviar="${esc(l.id)}" data-cliente="${esc(l.cliente)}">Reenviar</button></div></td></tr>`).join('')
      : '<tr><td colspan="6" class="vazio"><b>Nenhum lote com falha ou pendência.</b> Lotes entregues ficam no Resumo de cada cliente.</td></tr>'
    // reenvio do MESMO lote (texto já auditado, hash do lote): o servidor respeita retry de 5 min e nunca repete um lote que já saiu
    tb.querySelectorAll('[data-reenviar]').forEach(b => { b.onclick = async () => {
      const U = ui(); if (!U) return
      try {
        const por = await U.pedirPor({ titulo: `Reenviar o aviso a ${b.dataset.cliente}?`, texto: 'Sai o mesmo texto do lote, nos canais ligados do cliente. Lote que já saiu não é repetido.', rotuloOk: 'Reenviar' }); if (!por) return
        b.disabled = true
        const x = await api('/api/gatilhos/enviar', { cliente: b.dataset.cliente, por, confirmar: true, lote_id: b.dataset.reenviar })
        toast(x.ok ? 'Aviso reenviado.' : `Não saiu: ${x.mensagem || x.estado || ''}`, x.ok ? undefined : 'erro')
      } catch (x) { toast(x.message, 'erro') } finally { montarPlanos() }
    } })
    montarChaveConsultor()
    $('btnGatilhosAuto').onclick = async e => {
      const U = ui(); if (!U) return
      const b = e.currentTarget, ligar = !ligado; b.disabled = true
      try {
        const por = await U.pedirPor({ titulo: ligar ? 'Ligar os avisos automáticos' : 'Desligar os avisos automáticos', texto: ligar
          ? 'Clientes liberados por um líder ou consultor (com integração Mercado Livre ativa) passam a receber, nos canais ligados, o plano semanal na terça às 09h no fuso deles (com os urgentes), dentro da janela e fora do silêncio. Texto fixo no tom aprovado, auditado antes de sair.'
          : 'Nenhum aviso sai sozinho para cliente nenhum. O envio manual, com prévia, continua disponível na ficha do cliente.', rotuloOk: ligar ? 'Ligar' : 'Desligar' })
        if (!por) return
        await api('/api/gatilhos/chave', { ligado: ligar, por }); toast(ligar ? 'Avisos automáticos ligados.' : 'Avisos automáticos desligados.')
      } catch (x) { toast(x.message, 'erro') } finally { b.disabled = false; montarPlanos() }
    }
  }

  // ── /planos › Avisos automáticos: chave própria do aviso INTERNO ao consultor no Discord (nasce desligada; vale para TODO cliente com integração ML e «Webhook ML», independente da liberação acima) ───────────
  async function montarChaveConsultor() {
    const el = $('cdEstado'), bt = $('btnConsultorDiscord'); if (!el || !bt) return
    let r
    try { r = await api('/api/consultor-discord/chave') } catch (e) { el.innerHTML = `<span class="mudo">${esc(e.message)}</span>`; return }
    el.innerHTML = `<span class="selo ${r.ligado ? 'bom' : 'atencao'}">Resumo ao consultor (Discord) ${r.ligado ? 'ligado' : 'desligado'}</span>${r.por ? ` <span class="mini">· ${esc(r.por)}</span>` : ''}${r.n8n?.configurado === false ? ' <span class="mini">· entrega n8n não configurada</span>' : ''}`
    bt.textContent = r.ligado ? 'Desligar resumo ao consultor' : 'Ligar resumo ao consultor'
    bt.onclick = async () => {
      const U = ui(); if (!U) return
      const ligar = !r.ligado; bt.disabled = true
      try {
        const por = await U.pedirPor({ titulo: ligar ? 'Ligar o aviso ao consultor no Discord' : 'Desligar o aviso ao consultor no Discord', texto: ligar
          ? 'Todos os clientes com integração Mercado Livre ativa e canal no Discord («Webhook ML»), independente do WhatsApp do cliente: resumo interno toda terça às 08h30 no fuso do cliente, marcando os 3 cargos do time e o consultor. O cliente não está nesse canal.'
          : 'Nenhum aviso interno sai para o Discord. Os avisos internos continuam no sino do painel.', rotuloOk: ligar ? 'Ligar' : 'Desligar' })
        if (!por) return
        await api('/api/consultor-discord/chave', { ligado: ligar, por }); toast(ligar ? 'Resumo ao consultor ligado.' : 'Resumo ao consultor desligado.')
      } catch (x) { toast(x.message, 'erro') } finally { bt.disabled = false; montarChaveConsultor() }
    }
  }

  window.PSGatilhos = { montarResumo, montarConfig, montarPlanos, enviar }
})()
