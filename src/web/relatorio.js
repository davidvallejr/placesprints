// Relatório de Sprints Place2u no Notion do cliente — telas de envio, programação e diagnóstico (08/10/2026).
// window.PSRelatorio: carregar(), selo(cliente), enviarAgora(cliente), lote(clientes), montarConfig(alvo, cliente), montarTabela(), frequenciaEmLote(clientes).
// Regras: nada vai ao Notion sem prévia + confirmação; só líder ou consultor envia ("Seu nome"); tudo que vem do servidor passa por esc()/textContent;
// o módulo não decide conteúdo (o texto vem pronto do brief) nem calcula datas (o servidor devolve as próximas datas).
(() => {
  if (window.PSRelatorio) return

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const $ = id => document.getElementById(id)
  const brData = iso => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—'
  const brCurta = iso => iso ? String(iso).slice(0, 10).split('-').reverse().slice(0, 2).join('/') : '—'
  const api = async (url, body) => {
    const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.erro || `erro ${r.status}`)
    return j
  }
  const toast = (t, tipo) => window.PS?.toast ? PS.toast(t, tipo) : alert(t)
  const confirmarPS = o => (window.PS?.confirmar ?? (x => Promise.resolve(confirm(x.titulo + (x.texto ? '\n\n' + x.texto : '')))))(o)
  const lerNome = () => { try { return localStorage.getItem('ps_perfil_por') || '' } catch { return '' } }
  const gravarNome = v => { try { localStorage.setItem('ps_perfil_por', v) } catch { /* sem armazenamento: só não lembra o nome */ } }
  const linkSeguro = u => { try { const x = new URL(u); return x.protocol === 'https:' ? x.href : '' } catch { return '' } }
  const espera = ms => new Promise(r => setTimeout(r, ms))
  const plural = (n, um, varios) => `${Number(n || 0).toLocaleString('pt-BR')} ${n === 1 ? um : varios}`

  const css = document.createElement('style')
  css.textContent = `
  .rl-dlg{width:min(640px,calc(100vw - 32px))}
  .rl-corpo>*+*{margin-top:var(--e-3)}
  .rl-kv{display:grid;grid-template-columns:max-content 1fr;gap:6px var(--e-4);font-size:var(--t-13)}
  .rl-kv dt{color:var(--cinza)}.rl-kv dd{margin:0;overflow-wrap:anywhere}
  .rl-linhas{max-height:260px;overflow:auto;padding:var(--e-3);border:1px solid var(--borda);border-radius:var(--raio-p);background:var(--fundo-suave);font-size:var(--t-13);white-space:pre-wrap;overflow-wrap:anywhere}
  .rl-opcao{display:flex;gap:var(--e-2);align-items:flex-start;font-size:var(--t-13)}
  .rl-opcao input{margin-top:3px}
  .rl-lista{width:100%;border-collapse:collapse;font-size:var(--t-13)}
  .rl-lista td{padding:6px 8px;border-bottom:1px solid var(--borda);vertical-align:top}
  .rl-cfg .linha{align-items:flex-end}
  `
  document.head.append(css)

  // ── dados compartilhados (GET /api/relatorio/clientes) ───────────────────────────────────────────────
  let estado = { itens: [], mapa: new Map(), resumo: null, agendador: { ligado: false }, frequencias: [], quem: [] }
  async function carregar() {
    const r = await api('/api/relatorio/clientes')
    estado = { itens: r.itens || [], mapa: new Map((r.itens || []).map(i => [i.cliente, i])), resumo: r.resumo || null, agendador: r.agendador || { ligado: false }, frequencias: r.frequencias || [], quem: r.quem || [] }
    return estado
  }
  const SELO = { desligado: 'neutro', nao_liberado: 'atencao', agendado: 'azul', atrasado: 'atencao', enviado: 'bom', pausado: 'atencao', falhou: 'ruim' }
  const seloDe = i => {
    if (!i) return ''
    if (i.frequencia === 'desligado') return '<span class="selo neutro">Relatório desligado</span>'
    const prox = i.proximo_envio ? ` · próx. ${brCurta(i.proximo_envio)}` : ''
    return `<span class="selo ${SELO[i.situacao] || 'neutro'}" title="${esc(i.motivo || i.situacao_rotulo || '')}">Relatório: ${esc(i.frequencia_rotulo || i.frequencia)}${prox}${i.situacao === 'nao_liberado' ? ' · aguarda liberação' : ''}</span>`
  }
  const selo = cliente => seloDe(estado.mapa.get(cliente))

  // ── diálogo mínimo (o formulário mora DENTRO do <dialog>; ofertas.js tinha o erro inverso) ───────────
  function dialogo(titulo) {
    const d = document.createElement('dialog'); d.className = 'dlg rl-dlg'
    const f = document.createElement('form'); f.method = 'dialog'
    const h = document.createElement('h2'); h.textContent = titulo
    const corpo = document.createElement('div'); corpo.className = 'rl-corpo'
    const rodape = document.createElement('div'); rodape.className = 'dlg-rodape'
    f.append(h, corpo, rodape); d.append(f); document.body.append(d)
    d.addEventListener('close', () => d.remove())
    f.addEventListener('submit', e => e.preventDefault())
    d.showModal()
    return { d, corpo, rodape, fechar: () => d.close() }
  }
  const botao = (texto, { primario = false, aoClicar, desligado = false } = {}) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = primario ? 'btn btn-primario' : 'btn'; b.textContent = texto; b.disabled = desligado
    if (aoClicar) b.onclick = aoClicar
    return b
  }
  const campoPor = (id = 'rlPor') => `<div class="campo"><label for="${id}">Seu nome (líder ou consultor — fica registrado)</label><input id="${id}" list="${id}Lista" maxlength="80" autocomplete="name" value="${esc(lerNome())}"><datalist id="${id}Lista">${estado.quem.map(n => `<option value="${esc(n)}">`).join('')}</datalist></div>`
  const lerPor = (raiz, id = 'rlPor') => raiz.querySelector('#' + id).value.trim()
  const aviso = (tipo, html) => `<div class="aviso ${tipo}">${html}</div>`

  // pede só o nome (e mostra um texto) antes de uma ação em lote: devolve o nome ou null
  function pedirPor({ titulo, texto, rotuloOk }) {
    return new Promise(resolver => {
      const { d, corpo, rodape, fechar } = dialogo(titulo)
      corpo.innerHTML = `<p>${esc(texto)}</p>${campoPor()}<div class="aviso erro" id="rlErro" hidden></div>`
      let ok = false
      rodape.append(botao('Cancelar', { aoClicar: fechar }), botao(rotuloOk, { primario: true, aoClicar: () => {
        const por = lerPor(corpo)
        if (!por) { const e = corpo.querySelector('#rlErro'); e.textContent = 'Informe seu nome.'; e.hidden = false; return }
        gravarNome(por); ok = por; fechar()
      } }))
      d.addEventListener('close', () => resolver(ok || null), { once: true })
    })
  }

  // ── envio imediato de UM cliente: nome → prévia → confirmar ─────────────────────────────────────────
  const CATEGORIA_TXT = {
    ok: 'A categoria "Relatório de Sprints Place2u" já existe na base e será usada.',
    select_cria: 'A categoria "Relatório de Sprints Place2u" será criada nesta base ao enviar.',
    opcao_ausente_status: 'A base deste cliente não tem a opção "Relatório de Sprints Place2u" em Secção (campo de status). Crie a opção no Notion e envie de novo.',
    sem_propriedade: 'A base não tem o campo Secção: a página será criada só com o título.',
    padrao_da_base: 'A página será criada sem a categoria; o Notion usa a categoria padrão da base.',
  }
  const RESULTADO_TXT = {
    enviado: 'Relatório enviado ao Notion do cliente.',
    enviado_tarefa: 'Relatório enviado como tarefa no quadro Tarefas do cliente.',
    adotado: 'Já havia uma página com este título no Notion; ela foi vinculada e nada novo foi escrito.',
    ja_enviado: 'Este período já tinha sido enviado; nada novo foi escrito.',
    substituido: 'Relatório substituído: a página nova foi criada e a anterior foi arquivada.',
  }
  async function enviarAgora(cliente, { aoConcluir } = {}) {
    if (!estado.quem.length) { try { await carregar() } catch { /* sem lista de nomes: o campo continua livre */ } }
    const { corpo, rodape, fechar } = dialogo(`Enviar relatório ao Notion · ${cliente}`)
    corpo.innerHTML = `<p>Gera o relatório dos últimos 7 dias fechados e mostra o texto antes de enviar. Nada é escrito no Notion até você confirmar.</p>${campoPor()}<div id="rlSaida"></div>`
    const saida = corpo.querySelector('#rlSaida')
    const cancelar = botao('Fechar', { aoClicar: fechar })
    const previaBt = botao('Ver prévia', { aoClicar: () => verPrevia() })
    rodape.append(cancelar, previaBt)

    async function verPrevia() {
      const por = lerPor(corpo)
      if (!por) { saida.innerHTML = aviso('erro', 'Informe seu nome.'); return }
      gravarNome(por); previaBt.disabled = true; saida.innerHTML = '<div class="mini">Gerando a prévia…</div>'
      let r
      try { r = await api('/api/relatorio/enviar', { cliente, por }) } catch (e) { saida.innerHTML = aviso('erro', esc(e.message)); previaBt.disabled = false; return }
      if (r.ok === false) { saida.innerHTML = aviso('erro', `<b>Não dá para enviar agora.</b> ${esc(r.mensagem || r.estado || '')}`); previaBt.disabled = false; return }
      desenharPrevia(por, r)
    }

    function desenharPrevia(por, r) {
      const dest = r.destino || {}, cat = r.categoria || {}, jaEnviado = r.ja_enviado || null
      const urlInfo = linkSeguro(dest.informacoes_url), urlJa = linkSeguro(jaEnviado?.url)
      const tarefa = r.destino_tipo === 'tarefa' ? (r.tarefa || {}) : null, urlQuadro = linkSeguro(tarefa?.quadro_url)   // plano B: o relatório vai como tarefa no quadro
      const viol = r.violacoes || [], avs = r.avisos || []
      const acaoTxt = { criar: 'Cria uma página nova', criar_tarefa: 'Cria uma tarefa nova no quadro Tarefas do cliente (a base Informações não aceita o relatório)', pular: 'Este período já foi enviado; nada será escrito', adotar: 'Já existe uma página com este título; será vinculada, sem escrever', substituir: 'Cria uma página nova e arquiva a anterior' }[r.acao] || esc(r.acao || '')
      saida.innerHTML = `
        <dl class="rl-kv">
          <dt>Título</dt><dd>${esc(r.titulo)}</dd>
          <dt>Período</dt><dd>${brData(r.de)} a ${brData(r.ate)}${r.parcial_ate_hora ? ` · hoje até ${esc(r.parcial_ate_hora)}, fora da comparação` : ''}</dd>
          ${tarefa ? `<dt>Destino</dt><dd>Tarefas · Canal ${esc(tarefa.canal || '—')} · ${esc(tarefa.responsavel || 'sem responsável')}${urlQuadro ? ` · <a href="${esc(urlQuadro)}" target="_blank" rel="noopener noreferrer">abrir quadro ↗</a>` : ''}</dd>
          <dt>Categoria</dt><dd>Tarefa no quadro (Demanda ${esc(tarefa.demanda || 'Relatório')}); a base Informações não aceita o relatório.</dd>`
          : `<dt>Destino</dt><dd>Informações${dest.pagina_titulo ? ` › ${esc(dest.pagina_titulo)}` : ''}${urlInfo ? ` · <a href="${esc(urlInfo)}" target="_blank" rel="noopener noreferrer">abrir ↗</a>` : ''}</dd>
          <dt>Categoria</dt><dd>${esc(CATEGORIA_TXT[cat.estado] || cat.estado || '—')}${cat.aviso ? ` <span class="mini">${esc(cat.aviso)}</span>` : ''}</dd>`}
          ${r.proximo_envio_depois ? `<dt>Próximo envio automático</dt><dd>${brData(r.proximo_envio_depois)}</dd>` : ''}
          <dt>O que acontece</dt><dd>${acaoTxt}${r.primeiro_envio ? ' · <b>primeiro envio deste cliente</b>' : ''}${jaEnviado ? `<br><span class="mini">Enviado em ${brData(jaEnviado.em)} por ${esc(jaEnviado.por || '—')}${urlJa ? ` · <a href="${esc(urlJa)}" target="_blank" rel="noopener noreferrer">abrir ↗</a>` : ''}</span>` : ''}</dd>
        </dl>
        ${(r.dias_sem_cobertura || []).length ? aviso('', esc(r.aviso_cobertura || `Os dias ${r.dias_sem_cobertura.map(brData).join(', ')} não aparecerão em nenhum relatório: este envio antecipa o próximo.`)) : ''}
        ${viol.length ? aviso('erro', `<b>Conteúdo bloqueado por segurança.</b> ${viol.map(v => esc(v.codigo)).join(', ')}. Nada será enviado.`) : ''}
        ${avs.map(a => aviso('', esc(a))).join('')}
        <details class="recolhido"><summary>Texto que o cliente vai ler</summary><div class="rl-linhas">${(r.linhas || []).map(esc).join('\n')}</div></details>
        ${r.acao === 'pular' || r.acao === 'adotar' ? `<label class="rl-opcao"><input type="checkbox" id="rlSubst"> <span>Substituir o relatório já enviado: cria uma página nova e arquiva a anterior (a URL muda).</span></label>` : ''}
        ${cat.estado === 'opcao_ausente_status' ? `<label class="rl-opcao"><input type="checkbox" id="rlSemCat"> <span>Enviar sem a categoria: o Notion usa a categoria padrão da base, que pode não ser a certa.</span></label>` : ''}
        ${dest.estado === 'destino_compartilhado' ? `<label class="rl-opcao"><input type="checkbox" id="rlConfDest"> <span>Confirmo que a base de Informações é compartilhada com outro cliente; o título leva o nome do cliente.</span></label>` : ''}
        <div id="rlResp"></div>`
      previaBt.remove()
      const enviar = botao('Enviar ao Notion', { primario: true, aoClicar: () => confirmarEnvio(por, r) })
      const marcas = ['rlSubst', 'rlSemCat', 'rlConfDest'].map(id => saida.querySelector('#' + id))
      const pode = () => {
        if (viol.length) return false
        if (cat.estado === 'opcao_ausente_status' && !saida.querySelector('#rlSemCat')?.checked) return false
        if (dest.estado === 'destino_compartilhado' && !saida.querySelector('#rlConfDest')?.checked) return false
        if (r.acao === 'pular' && !saida.querySelector('#rlSubst')?.checked) return false   // período já enviado: só segue substituindo
        return true
      }
      const atualizar = () => { enviar.disabled = !pode() }
      marcas.filter(Boolean).forEach(m => m.addEventListener('change', atualizar))
      atualizar(); rodape.append(enviar)
    }

    async function confirmarEnvio(por, r) {
      const resp = saida.querySelector('#rlResp'), botoes = [...rodape.querySelectorAll('button')]
      botoes.forEach(b => { b.disabled = true })
      resp.innerHTML = '<div class="mini">Enviando ao Notion…</div>'
      const corpoEnvio = { cliente, por, confirmar: true, previa_id: r.previa_id }
      if (saida.querySelector('#rlSubst')?.checked) corpoEnvio.substituir = true
      if (saida.querySelector('#rlSemCat')?.checked) corpoEnvio.sem_categoria = true
      if (saida.querySelector('#rlConfDest')?.checked) corpoEnvio.confirmar_destino = true
      let x
      try { x = await api('/api/relatorio/enviar', corpoEnvio) } catch (e) { resp.innerHTML = aviso('erro', esc(e.message)); botoes.forEach(b => { b.disabled = false }); return }
      if (x.ok === false) { resp.innerHTML = aviso('erro', `<b>Não foi enviado.</b> ${esc(x.mensagem || x.estado || '')}`); botoes.forEach(b => { b.disabled = false }); return }
      const url = linkSeguro(x.url)
      const txtRes = RESULTADO_TXT[x.destino_tipo === 'tarefa' && x.estado === 'enviado' ? 'enviado_tarefa' : x.estado] || 'Concluído.'
      resp.innerHTML = aviso('ok', `<b>${esc(txtRes)}</b>${url ? ` <a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Abrir no Notion ↗</a>` : ''}${x.proximo_envio ? `<div class="mini">Próximo envio previsto: ${brData(x.proximo_envio)}</div>` : ''}`)
      rodape.replaceChildren(botao('Fechar', { primario: true, aoClicar: fechar }))
      toast(txtRes)
      aoConcluir?.(x)
    }
  }

  // ── "Enviar relatório antecipadamente" para vários clientes (prévia por cliente → job com progresso) ──
  const ACAO_LOTE = {
    enviar: ['azul', 'Será enviado'], ja_enviado_hoje: ['neutro', 'Já enviado hoje'], precisa_previa: ['atencao', 'Primeiro envio: abra o cliente e envie por lá'],
    bloqueado: ['ruim', 'Bloqueado'], ignorado: ['neutro', 'Fora do escopo'],
  }
  const ESTADO_JOB = { interrompido: 'Não enviado: o Notion ficou indisponível; tente de novo mais tarde', em_andamento: 'Já existe um envio deste cliente em andamento', cliente_inelegivel: 'Cliente que não está ativo na central' }
  async function lote(clientes, { aoConcluir } = {}) {
    if (!clientes?.length) { toast('Escolha um escopo com ao menos um cliente.', 'erro'); return }
    if (clientes.length > 40) { toast(`São ${clientes.length} clientes: o envio antecipado aceita até 40 por vez. Use "Seleção de clientes".`, 'erro'); return }
    if (!estado.quem.length) { try { await carregar() } catch { /* campo livre */ } }
    const { corpo, rodape, fechar } = dialogo('Enviar relatório antecipadamente')
    corpo.innerHTML = `<p>${plural(clientes.length, 'cliente', 'clientes')} no escopo. A prévia mostra o que aconteceria com cada um; só vai ao Notion o que você confirmar.</p>${campoPor()}<div id="rlSaida"></div>`
    const saida = corpo.querySelector('#rlSaida')
    const previaBt = botao('Ver prévia', { aoClicar: () => verPrevia() })
    rodape.append(botao('Fechar', { aoClicar: fechar }), previaBt)

    async function verPrevia() {
      const por = lerPor(corpo)
      if (!por) { saida.innerHTML = aviso('erro', 'Informe seu nome.'); return }
      gravarNome(por); previaBt.disabled = true; saida.innerHTML = '<div class="mini">Conferindo o destino de cada cliente…</div>'
      let r
      try { r = await api('/api/relatorio/lote', { clientes, por }) } catch (e) { saida.innerHTML = aviso('erro', esc(e.message)); previaBt.disabled = false; return }
      const itens = r.itens || [], enviar = itens.filter(i => i.acao === 'enviar')
      saida.innerHTML = `<table class="rl-lista"><tbody>${itens.map(i => { const [cls, rot] = ACAO_LOTE[i.acao] || ['neutro', i.acao]; return `<tr><td>${esc(i.cliente)}</td><td><span class="selo ${cls}">${esc(rot)}</span>${i.motivo ? `<div class="mini">${esc(i.motivo)}</div>` : ''}</td></tr>` }).join('')}</tbody></table>
        <p class="mini">${plural(enviar.length, 'relatório será enviado', 'relatórios serão enviados')}. Cada página fica visível ao cliente no Notion dele, em nome de ${esc(por)}.</p><div id="rlResp"></div>`
      previaBt.remove()
      rodape.append(botao(enviar.length ? `Enviar ${plural(enviar.length, 'relatório', 'relatórios')}` : 'Nada a enviar', { primario: true, desligado: !enviar.length, aoClicar: () => confirmar(por, enviar.length) }))
    }

    async function confirmar(por, n) {
      const resp = saida.querySelector('#rlResp'), botoes = [...rodape.querySelectorAll('button')]
      botoes.forEach(b => { b.disabled = true })
      resp.innerHTML = '<div class="mini">Iniciando…</div><div class="barra-progresso"><div id="rlBarra"></div></div>'
      try {
        const { job } = await api('/api/relatorio/lote', { clientes, por, confirmar: true })
        for (;;) {
          const j = await api('/api/relatorio/job/' + encodeURIComponent(job.id))
          const barra = resp.querySelector('#rlBarra'); if (barra) barra.style.width = j.total ? Math.round(100 * j.feitos / j.total) + '%' : '5%'
          resp.firstElementChild.textContent = `Enviando: ${j.feitos}/${j.total || n}`
          if (j.estado !== 'rodando') {
            const falhas = (j.itens || []).filter(i => i.estado !== 'enviado' && i.estado !== 'adotado' && i.estado !== 'ja_enviado' && i.estado !== 'substituido')
            resp.innerHTML = aviso(falhas.length ? 'erro' : 'ok', `<b>${esc(j.resumo || `${j.feitos} de ${j.total} concluídos`)}</b>`) +
              `<table class="rl-lista"><tbody>${(j.itens || []).map(i => { const u = linkSeguro(i.url); return `<tr><td>${esc(i.cliente)}</td><td>${esc(i.mensagem || ESTADO_JOB[i.estado] || i.estado)}${u ? ` · <a href="${esc(u)}" target="_blank" rel="noopener noreferrer">abrir ↗</a>` : ''}</td></tr>` }).join('')}</tbody></table>`
            rodape.replaceChildren(botao('Fechar', { primario: true, aoClicar: fechar }))
            aoConcluir?.(j); return
          }
          await espera(1500)
        }
      } catch (e) { resp.innerHTML = aviso('erro', esc(e.message)); botoes.forEach(b => { b.disabled = false }) }
    }
  }

  // ── frequência para vários clientes de uma vez ─────────────────────────────────────────────────────────
  async function frequenciaEmLote(clientes, { aoConcluir } = {}) {
    if (!clientes?.length) { toast('Escolha um escopo com ao menos um cliente.', 'erro'); return }
    if (clientes.length > 100) { toast('Defina a frequência de até 100 clientes por vez. Use "Seleção de clientes".', 'erro'); return }
    if (!estado.frequencias.length) { try { await carregar() } catch { /* usa a lista fixa abaixo */ } }
    const freqs = estado.frequencias.length ? estado.frequencias : [{ id: 'desligado', rotulo: 'Desligado' }, { id: 'semanal', rotulo: 'Semanal' }, { id: 'quinzenal', rotulo: 'Quinzenal' }, { id: 'mensal', rotulo: 'Mensal' }]
    const { corpo, rodape, fechar } = dialogo('Definir frequência dos relatórios')
    corpo.innerHTML = `<p>${plural(clientes.length, 'cliente', 'clientes')} no escopo. A mudança só vale para o que for confirmado abaixo; o envio automático continua dependendo da liberação de cada cliente.</p>
      <div class="campo"><label for="rlFreqLote">Frequência</label><select id="rlFreqLote">${freqs.map(f => `<option value="${esc(f.id)}"${f.id === 'semanal' ? ' selected' : ''}>${esc(f.rotulo)}</option>`).join('')}</select></div>
      ${campoPor()}<div id="rlSaida"></div>`
    const saida = corpo.querySelector('#rlSaida')
    const previaBt = botao('Ver prévia', { aoClicar: () => verPrevia() })
    rodape.append(botao('Fechar', { aoClicar: fechar }), previaBt)
    const dados = () => ({ clientes, frequencia: corpo.querySelector('#rlFreqLote').value, por: lerPor(corpo) })
    async function verPrevia() {
      const b = dados()
      if (!b.por) { saida.innerHTML = aviso('erro', 'Informe seu nome.'); return }
      gravarNome(b.por); previaBt.disabled = true
      let r
      try { r = await api('/api/relatorio/frequencia-lote', b) } catch (e) { saida.innerHTML = aviso('erro', esc(e.message)); previaBt.disabled = false; return }
      if (r.ok === false) { saida.innerHTML = aviso('erro', esc(r.mensagem || 'Não foi possível definir a frequência.')); previaBt.disabled = false; return }
      const ign = (r.ignorados || []).length
      saida.innerHTML = `<p><b>${plural(r.mudam, 'cliente muda', 'clientes mudam')}</b> de frequência; os demais já estão assim.${ign ? ` ${plural(ign, 'fica de fora', 'ficam de fora')} (cliente que não está ativo na central).` : ''}</p>${(r.avisos || []).map(a => aviso('', esc(a))).join('')}<div id="rlResp"></div>`
      previaBt.remove()
      rodape.append(botao('Aplicar', { primario: true, desligado: !r.mudam, aoClicar: async e => {
        e.currentTarget.disabled = true
        try { const x = await api('/api/relatorio/frequencia-lote', { ...b, confirmar: true }); if (x.ok === false) throw new Error(x.mensagem || 'Não foi possível definir a frequência.'); toast(`${plural(x.alterados, 'cliente alterado', 'clientes alterados')}.`); fechar(); aoConcluir?.(x) }
        catch (err) { saida.querySelector('#rlResp').innerHTML = aviso('erro', esc(err.message)); e.currentTarget.disabled = false }
      } }))
    }
  }

  // ── job simples (diagnóstico de bases): acompanha até terminar ─────────────────────────────────────────
  async function acompanhar(jobId, { aoProgresso } = {}) {
    for (;;) {
      const j = await api('/api/relatorio/job/' + encodeURIComponent(jobId))
      aoProgresso?.(j)
      if (j.estado !== 'rodando') return j
      await espera(1500)
    }
  }

  // ── Cliente › Configurar: frequência, data, liberação e histórico ───────────────────────────────────────
  const SITUACAO_TXT = {
    desligado: 'Envio desligado.', nao_liberado: 'Programado, mas ainda não liberado para o envio automático.', agendado: 'Agendado.', atrasado: 'Atrasado: o envio automático roda no próximo horário disponível.',
    enviado: 'Último envio concluído.', pausado: 'Pausado.', falhou: 'Falhou: veja o motivo e tente de novo.',
  }
  const ESTADO_ENVIO = { enviado: 'Enviado', adotado: 'Vinculado', arquivado: 'Arquivado', falhou: 'Falhou', bloqueado: 'Bloqueado' }
  const ORIGEM_ENVIO = { manual: 'Manual', lote: 'Lote', agendado: 'Automático' }
  async function montarConfig(alvo, cliente) {
    if (!alvo) return
    alvo.innerHTML = '<div class="mini">Carregando a programação…</div>'
    let r
    try { r = await api('/api/relatorio/cliente?cliente=' + encodeURIComponent(cliente)) }
    catch (e) { alvo.innerHTML = aviso('erro', esc(e.message)); return }
    if (r.quem?.length) estado.quem = r.quem
    const p = r.programacao || {}, freqs = r.frequencias || [], hist = r.historico || []
    const datas = (p.datas_previstas || []).map(brData).join(' · ')
    alvo.innerHTML = `<div class="rl-cfg">
      <div class="linha">
        <div class="campo"><label for="relFreq">Frequência do envio</label><select id="relFreq">${freqs.map(f => `<option value="${esc(f.id)}"${f.id === p.frequencia ? ' selected' : ''}>${esc(f.rotulo)}</option>`).join('')}</select></div>
        <div class="campo"><label for="relProximo">Próximo envio</label><input type="date" id="relProximo" value="${esc(p.proximo_envio || '')}"></div>
      </div>
      <p class="mini mt-2">A frequência define quando enviamos. O conteúdo é sempre dos últimos 7 dias, até o dia do envio. Deixe a data em branco para usar a próxima sexta-feira.</p>
      <p class="mini">${seloDe(p)} ${esc(SITUACAO_TXT[p.situacao] || '')}${p.motivo ? ` <b>${esc(p.motivo)}</b>` : ''}${datas ? `<br>Próximas datas: ${esc(datas)}` : ''}${p.ultimo_envio_em ? `<br>Último envio: ${brData(p.ultimo_envio_em)}${linkSeguro(p.ultimo_url) ? ` · <a href="${esc(linkSeguro(p.ultimo_url))}" target="_blank" rel="noopener noreferrer">abrir ↗</a>` : ''}` : ''}</p>
      <div class="linha mt-4">
        ${campoPor('relPor')}
        <button class="btn" type="button" id="btnSalvarRelatorio">Salvar programação</button>
        ${p.frequencia !== 'desligado' && !p.liberado ? '<button class="btn btn-fantasma" type="button" id="btnLiberarRelatorio" title="Permite o envio automático para este cliente">Liberar envio automático</button>' : ''}
        <button class="btn btn-fantasma" type="button" id="btnVerificarRelatorio" title="Confere, sem escrever, se a base Informações do cliente está pronta">Verificar destino</button>
      </div>
      <div id="relMsg" class="mt-2"></div>
      <div class="mini mt-2">${diagTxt(r.diag)}</div>
      <details class="recolhido"><summary>Histórico de envios <span class="n">${hist.length ? plural(hist.length, 'envio', 'envios') : ''}</span></summary>
        ${hist.length ? `<div class="tabela-wrap"><table class="t"><thead><tr><th>Período</th><th>Origem</th><th>Situação</th><th>Quando</th><th>Quem</th><th>Página</th></tr></thead><tbody>${hist.map(h => `<tr><td>${brCurta(h.de)} a ${brData(h.ate)}</td><td>${esc(ORIGEM_ENVIO[h.origem] || h.origem)}</td><td>${esc(ESTADO_ENVIO[h.estado] || h.estado)}${h.categoria === 'tarefa' ? ' · <span class="mini">tarefa no quadro</span>' : ''}${h.motivo ? `<div class="mini">${esc(h.motivo)}</div>` : ''}</td><td>${brData(h.em)}</td><td>${esc(h.por || '—')}</td><td>${linkSeguro(h.url) ? `<a href="${esc(linkSeguro(h.url))}" target="_blank" rel="noopener noreferrer">abrir ↗</a>` : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="mini">Nenhum envio ainda.</p>'}
      </details></div>`
    const msg = (tipo, t) => { alvo.querySelector('#relMsg').innerHTML = aviso(tipo, esc(t)) }
    const por = () => alvo.querySelector('#relPor').value.trim()
    const refazer = () => montarConfig(alvo, cliente)

    alvo.querySelector('#btnSalvarRelatorio').onclick = async e => {
      const nome = por(); if (!nome) return msg('erro', 'Informe seu nome — ele fica registrado na programação.')
      const b = { cliente, frequencia: alvo.querySelector('#relFreq').value, por: nome }
      const prox = alvo.querySelector('#relProximo').value; if (prox && b.frequencia !== 'desligado') b.proximo_envio = prox
      e.currentTarget.disabled = true; gravarNome(nome)
      try {
        const v = await api('/api/relatorio/programacao', b)
        if (v.ok === false) { msg('erro', v.mensagem || 'Não foi possível salvar a programação.'); e.currentTarget.disabled = false; return }
        const texto = b.frequencia === 'desligado' ? 'O cliente deixa de receber relatórios automáticos.'
          : `Próximas datas: ${(v.datas_previstas || []).map(brData).join(' · ') || '—'}. Os envios automáticos criam uma página visível ao cliente, em nome de ${nome}.${(v.avisos || []).length ? ' ' + v.avisos.join(' ') : ''}`
        if (await confirmarPS({ titulo: `Salvar a programação de ${cliente}?`, texto, rotuloOk: 'Salvar' })) {
          const ok = await api('/api/relatorio/programacao', { ...b, confirmar: true })
          if (ok.ok === false) { msg('erro', ok.mensagem || 'Não foi possível salvar a programação.'); e.currentTarget.disabled = false; return }
          toast('Programação salva.'); await refazer(); carregar().catch(() => {})
          return
        }
      } catch (x) { msg('erro', x.message) }
      e.currentTarget.disabled = false
    }
    const lib = alvo.querySelector('#btnLiberarRelatorio')
    if (lib) lib.onclick = async e => {
      const nome = por(); if (!nome) return msg('erro', 'Informe seu nome.')
      e.currentTarget.disabled = true; gravarNome(nome)
      try {
        const v = await api('/api/relatorio/liberar', { clientes: [cliente], por: nome })
        const ign = (v.ignorados || []).find(i => i.cliente === cliente)
        if (ign) { msg('erro', ign.motivo || 'Este cliente ainda não está pronto: use "Verificar destino".'); e.currentTarget.disabled = false; return }
        if (await confirmarPS({ titulo: `Liberar o envio automático de ${cliente}?`, texto: `A partir da próxima data programada, o relatório será criado no Notion do cliente sem nova confirmação, em nome de ${nome}.`, rotuloOk: 'Liberar' })) {
          await api('/api/relatorio/liberar', { clientes: [cliente], por: nome, confirmar: true }); toast('Envio automático liberado.'); await refazer(); carregar().catch(() => {}); return
        }
      } catch (x) { msg('erro', x.message) }
      e.currentTarget.disabled = false
    }
    alvo.querySelector('#btnVerificarRelatorio').onclick = async e => {
      e.currentTarget.disabled = true; msg('', 'Verificando a base Informações do cliente…')
      try { const { job } = await api('/api/relatorio/diagnostico/verificar', { clientes: [cliente] }); await acompanhar(job.id); await refazer(); carregar().catch(() => {}) }
      catch (x) { msg('erro', x.message); e.currentTarget.disabled = false }
    }
  }
  const diagTxt = d => d ? `Destino verificado em ${brData(d.em)}: ${d.pronto ? 'pronto para receber o relatório.' : esc(d.proxima_acao || 'ainda não está pronto.')}` : 'Destino ainda não verificado.'

  // ── Distribuição › Relatórios para o cliente (tabela, diagnóstico, liberação, interruptor) ──────────────
  const PAG = 50
  let limite = PAG
  let recarregarTabela = null     // a tabela se liga uma única vez; chamar montarTabela() de novo só recarrega os dados
  async function montarTabela() {
    if (recarregarTabela) return recarregarTabela()
    const tb = $('tbRelatorios'); if (!tb) return
    const desenhar = () => {
      const itens = estado.itens, r = estado.resumo || {}
      $('nRelatorios').textContent = itens.length ? Number(itens.length).toLocaleString('pt-BR') : ''
      $('relResumo').textContent = itens.length
        ? `${r.prontos ?? 0} prontos · ${r.liberados ?? 0} liberados · ${r.pausados ?? 0} pausados · ${r.sem_categoria ?? 0} sem a categoria · ${r.sem_base ?? 0} sem Informações · ${r.nao_verificados ?? 0} não verificados`
        : 'Nenhum cliente programado ainda.'
      const ligado = !!estado.agendador?.ligado
      $('btnAgendador').textContent = ligado ? 'Pausar envios automáticos' : 'Ligar envios automáticos'
      $('relAgendadorEstado').innerHTML = `<span class="selo ${ligado ? 'bom' : 'atencao'}">Envios automáticos ${ligado ? 'ligados' : 'desligados'}</span>`
      tb.innerHTML = itens.length ? itens.slice(0, limite).map(i => `<tr>
        <td>${esc(i.cliente)}</td><td>${esc(i.frequencia_rotulo || i.frequencia)}</td><td>${i.frequencia === 'desligado' ? '—' : brData(i.proximo_envio)}</td>
        <td>${i.ultimo_envio_em ? brData(i.ultimo_envio_em) : '—'}</td><td>${seloDe(i)}${i.motivo ? `<div class="mini">${esc(i.motivo)}</div>` : ''}</td>
        <td><button type="button" class="btn btn-p" data-rel="${esc(i.cliente)}">Enviar agora</button> <a class="btn btn-fantasma btn-p" href="/cliente?cliente=${encodeURIComponent(i.cliente)}&amp;aba=configurar">Configurar</a></td></tr>`).join('')
        : '<tr><td colspan="6" class="vazio"><b>Nenhum cliente programado.</b>Rode a semeadura (scripts/semear-relatorio-programacao.mjs) ou defina a frequência de um cliente.</td></tr>'
      $('pagRelatorios').innerHTML = itens.length > PAG ? `<span>1–${Math.min(limite, itens.length)} de ${itens.length}</span>${limite < itens.length ? ' · <button type="button" class="btn btn-p" id="relMais">Mostrar mais</button>' : ''}` : ''
    }
    const recarregar = async () => { try { await carregar(); desenhar() } catch (e) { tb.innerHTML = `<tr><td colspan="6"><div class="erro-bloco"><b>Não foi possível carregar</b>${esc(e.message)}</div></td></tr>` } }
    const progresso = j => { $('relJob').hidden = false; $('relJobTxt').textContent = `Verificando bases: ${j.feitos}/${j.total || '…'}`; $('relJobBarra').style.width = j.total ? Math.round(100 * j.feitos / j.total) + '%' : '5%' }

    $('btnVerificarBases').onclick = async e => {
      const b = e.currentTarget; b.disabled = true
      try { const { job } = await api('/api/relatorio/diagnostico/verificar', {}); await acompanhar(job.id, { aoProgresso: progresso }); toast('Bases verificadas.') }
      catch (x) { toast(x.message, 'erro') }
      finally { b.disabled = false; $('relJob').hidden = true; $('relJobBarra').style.width = '0'; recarregar() }
    }
    $('btnLiberarProntos').onclick = async e => {
      const b = e.currentTarget; b.disabled = true
      try {
        const por = await pedirPor({ titulo: 'Liberar envios para os prontos', texto: 'Só entram os clientes cujo destino foi verificado e está pronto. Depois da liberação, o relatório semanal vai ao Notion sem nova confirmação, na data programada de cada um.', rotuloOk: 'Ver quem entra' })
        if (!por) return
        const v = await api('/api/relatorio/liberar', { por })
        const lib = v.liberaria || []
        if (!lib.length) return toast('Nenhum cliente pronto para liberar. Rode "Verificar bases" primeiro.', 'erro')
        const primeiros = Number(v.sem_envio_anterior) || 0
        if (await confirmarPS({ titulo: `Liberar ${plural(lib.length, 'cliente', 'clientes')}?`, texto: `${(v.ignorados || []).length ? `${plural(v.ignorados.length, 'fica de fora', 'ficam de fora')} (destino não está pronto). ` : ''}${primeiros ? `${plural(primeiros, 'cliente receberá', 'clientes receberão')} o primeiro relatório sem prévia individual: faça o piloto antes. ` : ''}Os envios automáticos criam uma página visível ao cliente, em nome de ${por}.`, rotuloOk: 'Liberar' })) {
          const x = await api('/api/relatorio/liberar', { por, confirmar: true }); toast(`${plural(x.liberados, 'cliente liberado', 'clientes liberados')}.`)
        }
      } catch (x) { toast(x.message, 'erro') }
      finally { b.disabled = false; recarregar() }
    }
    $('btnAgendador').onclick = async e => {
      const b = e.currentTarget, ligar = !estado.agendador?.ligado; b.disabled = true
      try {
        const por = await pedirPor({ titulo: ligar ? 'Ligar os envios automáticos' : 'Pausar os envios automáticos', texto: ligar ? 'Quem foi liberado e está com a data vencida passa a receber o relatório no Notion, às sextas a partir das 17h (ou na data programada).' : 'Nenhum relatório automático sai até religar. Envios manuais continuam funcionando.', rotuloOk: ligar ? 'Ligar' : 'Pausar' })
        if (!por) return
        await api('/api/relatorio/agendador', { ligado: ligar, por }); toast(ligar ? 'Envios automáticos ligados.' : 'Envios automáticos pausados.')
      } catch (x) { toast(x.message, 'erro') }
      finally { b.disabled = false; recarregar() }
    }
    // ⋯ › Anexar PDF nos envios sem documento: prévia (quem entra) → confirmar → job
    const btnAnexar = $('btnRelAnexar')
    if (btnAnexar) btnAnexar.onclick = async e => {
      const b = e.currentTarget; b.closest('details.menu')?.removeAttribute('open'); b.disabled = true
      try {
        const desde = new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10)
        const por = await pedirPor({ titulo: 'Anexar PDF nos envios sem documento', texto: 'Gera o documento do relatório (PDF) a partir do mesmo texto enviado e anexa no topo da página no Notion de cada cliente que recebeu relatório nos últimos 30 dias e ainda não tem o documento. Primeiro mostra quem entra.', rotuloOk: 'Ver quem entra' })
        if (!por) return
        const v = await api('/api/relatorio/anexar-lote', { desde, por })
        const itens = v.itens || []
        if (!itens.length) return toast('Todos os envios recentes já têm o documento.')
        if (await confirmarPS({ titulo: `Anexar o PDF em ${plural(itens.length, 'página', 'páginas')}?`, texto: `${itens.slice(0, 8).map(i => `${i.cliente} (${brCurta(i.de)} a ${brCurta(i.ate)})`).join(', ')}${itens.length > 8 ? ` e mais ${itens.length - 8}` : ''}. O documento só é gerado quando o relatório de hoje cobre o mesmo período do envio.`, rotuloOk: 'Anexar' })) {
          const x = await api('/api/relatorio/anexar-lote', { desde, por, confirmar: true })
          if (x.ok === false) throw new Error(x.mensagem || 'Nada a anexar.')
          const j = await acompanhar(x.job.id, { aoProgresso: jb => { $('relJob').hidden = false; $('relJobTxt').textContent = `Anexando documentos: ${jb.feitos}/${jb.total || '…'}`; $('relJobBarra').style.width = jb.total ? Math.round(100 * jb.feitos / jb.total) + '%' : '5%' } })
          toast(j.resumo || 'Concluído.')
        }
      } catch (x) { toast(x.message, 'erro') }
      finally { b.disabled = false; $('relJob').hidden = true; $('relJobBarra').style.width = '0'; recarregar() }
    }
    document.addEventListener('click', e => {
      const m = e.target.closest('#relMais'); if (m) { limite += PAG; desenhar(); return }
      const b = e.target.closest('#tbRelatorios [data-rel]'); if (b) enviarAgora(b.dataset.rel, { aoConcluir: recarregar })
    })
    recarregarTabela = recarregar
    await recarregar()
  }

  window.PSRelatorio = { carregar, selo, enviarAgora, lote, frequenciaEmLote, montarConfig, montarTabela, estado: () => estado, ui: { dialogo, botao, campoPor, lerPor, aviso, gravarNome, pedirPor, linkSeguro } }
})()
