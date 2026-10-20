// Alertas de pendência crítica do cliente (08/10/2026): o aviso interno soa na hora; a página de alerta vai ao Notion do cliente, automática
// para cliente liberado (interruptor "alerta automático") ou manual, com prévia, por um líder ou consultor. window.PSAlertas.montarResumo(alvo, cliente)
// (Resumo do cliente) e .montarTabela() (Distribuição). Tudo que vem do servidor passa por esc(); o módulo não decide: o servidor guarda o estado e o motivo.
(() => {
  if (window.PSAlertas) return

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const $ = id => document.getElementById(id)
  const brData = iso => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—'
  const api = async (url, body) => {
    const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.erro || `erro ${r.status}`)
    return j
  }
  const toast = (t, tipo) => window.PS?.toast ? PS.toast(t, tipo) : alert(t)
  const ui = () => window.PSRelatorio?.ui || null
  const plural = (n, um, varios) => `${Number(n || 0).toLocaleString('pt-BR')} ${n === 1 ? um : varios}`

  const ESTADO = {
    pendente: ['atencao', 'Aguardando envio'], enviado: ['bom', 'Enviado ao Notion'], suprimido: ['neutro', 'Suprimido'],
    bloqueado: ['ruim', 'Bloqueado'], falhou: ['ruim', 'Falhou'], resolvido: ['bom', 'Resolvido'],
  }
  const selo = e => { const [cls, rot] = ESTADO[e] || ['neutro', e]; return `<span class="selo ${cls}">${esc(rot)}</span>` }
  const SELO_GRAV = { critico: 'ruim', atencao: 'atencao', info: 'neutro' }

  // ── enviar um alerta (prévia → confirmar), igual ao relatório: o que o líder viu é o que sai ─────────────
  async function enviar(alerta, { aoConcluir } = {}) {
    const U = ui(); if (!U) { toast('Recarregue a página: o módulo de diálogos não carregou.', 'erro'); return }
    const { corpo, rodape, fechar } = U.dialogo(`Alerta ao Notion do cliente${alerta.cliente ? ` · ${alerta.cliente}` : ''}`)
    corpo.innerHTML = `<p>${esc(alerta.rotulo || 'Pendência do cliente')}. Cria uma página de alerta na base Informações do cliente, com a explicação e o possível impacto. Nada é escrito até você confirmar.</p>${U.campoPor('alPor')}<div id="alSaida"></div>`
    const saida = corpo.querySelector('#alSaida')
    const previaBt = U.botao('Ver prévia', { aoClicar: async () => {
      const por = U.lerPor(corpo, 'alPor')
      if (!por) { saida.innerHTML = U.aviso('erro', 'Informe seu nome.'); return }
      U.gravarNome(por); previaBt.disabled = true; saida.innerHTML = '<div class="mini">Gerando a prévia…</div>'
      let r
      try { r = await api('/api/alertas/enviar', { id: alerta.id, por }) } catch (e) { saida.innerHTML = U.aviso('erro', esc(e.message)); previaBt.disabled = false; return }
      if (r.ok === false) { saida.innerHTML = U.aviso('erro', `<b>Não dá para enviar agora.</b> ${esc(r.mensagem || r.estado || '')}`); previaBt.disabled = false; return }
      const dest = r.destino || {}, url = U.linkSeguro(dest.informacoes_url), viol = r.violacoes || []
      saida.innerHTML = `<dl class="rl-kv"><dt>Título</dt><dd>${esc(r.titulo)}</dd><dt>Destino</dt><dd>Informações${dest.pagina_titulo ? ` › ${esc(dest.pagina_titulo)}` : ''}${url ? ` · <a href="${esc(url)}" target="_blank" rel="noopener noreferrer">abrir ↗</a>` : ''}</dd></dl>
        ${viol.length ? U.aviso('erro', `<b>Conteúdo bloqueado por segurança.</b> ${viol.map(v => esc(v.codigo)).join(', ')}. Nada será enviado.`) : ''}
        ${(r.avisos || []).map(a => U.aviso('', esc(a))).join('')}
        <details class="recolhido" open><summary>Texto que o cliente vai ler</summary><div class="rl-linhas">${(r.linhas || []).map(esc).join('\n')}</div></details>
        ${dest.estado === 'destino_compartilhado' ? '<label class="rl-opcao"><input type="checkbox" id="alConfDest"> <span>Confirmo que a base de Informações é compartilhada com outro cliente.</span></label>' : ''}<div id="alResp"></div>`
      previaBt.remove()
      const ok = U.botao('Enviar ao Notion', { primario: true, aoClicar: async e => {
        const resp = saida.querySelector('#alResp'); e.currentTarget.disabled = true; resp.innerHTML = '<div class="mini">Enviando ao Notion…</div>'
        const body = { id: alerta.id, por, confirmar: true, previa_id: r.previa_id }
        if (saida.querySelector('#alConfDest')?.checked) body.confirmar_destino = true
        try {
          const x = await api('/api/alertas/enviar', body)
          if (x.ok === false) { resp.innerHTML = U.aviso('erro', `<b>Não foi enviado.</b> ${esc(x.mensagem || x.estado || '')}`); e.currentTarget.disabled = false; return }
          const u = U.linkSeguro(x.url)
          resp.innerHTML = U.aviso('ok', `<b>Alerta enviado ao Notion do cliente.</b>${u ? ` <a href="${esc(u)}" target="_blank" rel="noopener noreferrer">Abrir no Notion ↗</a>` : ''}`)
          rodape.replaceChildren(U.botao('Fechar', { primario: true, aoClicar: fechar })); toast('Alerta enviado ao Notion do cliente.'); aoConcluir?.(x)
        } catch (err) { resp.innerHTML = U.aviso('erro', esc(err.message)); e.currentTarget.disabled = false }
      } })
      const marca = saida.querySelector('#alConfDest')
      const pode = () => !viol.length && (dest.estado !== 'destino_compartilhado' || !!marca?.checked)
      const atualizar = () => { ok.disabled = !pode() }
      marca?.addEventListener('change', atualizar); atualizar(); rodape.append(ok)
    } })
    rodape.append(U.botao('Fechar', { aoClicar: fechar }), previaBt)
  }

  // ── Resumo do cliente: alertas deste cliente (estado, motivo, link) ──────────────────────────────────
  async function montarResumo(alvo, cliente) {
    if (!alvo) return
    let r
    try { r = await api('/api/alertas/cliente?cliente=' + encodeURIComponent(cliente)) } catch (e) { alvo.innerHTML = `<div class="mini">Alertas ao Notion indisponíveis: ${esc(e.message)}</div>`; return }
    const itens = r.itens || []
    if (!itens.length) { alvo.innerHTML = `<div class="mini mt-2">Nenhum alerta ao Notion deste cliente. O envio automático está ${r.automatico?.ligado ? 'ligado' : 'desligado'}.</div>`; return }
    alvo.innerHTML = `<h3 class="mt-4">Alertas ao Notion do cliente <span class="mini">(automático ${r.automatico?.ligado ? 'ligado' : 'desligado'})</span></h3>` + itens.slice(0, 10).map(a => `
      <div class="acao"><div class="acao-topo"><div class="acao-corpo"><b>${esc(a.rotulo)}</b> <span class="selo neutro">${esc(a.canal_rotulo || '')}</span> <span class="selo ${SELO_GRAV[a.gravidade] || 'neutro'}">${esc(a.gravidade === 'critico' ? 'Crítico' : a.gravidade || '')}</span> ${selo(a.estado)}
        <div class="acao-meta"><span>detectado em ${brData(a.criado_em)}</span>${a.enviado_em ? `<span>enviado em ${brData(a.enviado_em)}</span>` : ''}${a.resolvido_em ? `<span>resolvido em ${brData(a.resolvido_em)}</span>` : ''}${ui()?.linkSeguro(a.page_url) ? `<a href="${esc(ui().linkSeguro(a.page_url))}" target="_blank" rel="noopener noreferrer">abrir no Notion ↗</a>` : ''}</div>
        ${a.motivo ? `<div class="mini mt-2">${esc(a.motivo)}</div>` : ''}
        ${a.estado === 'pendente' || a.estado === 'suprimido' || a.estado === 'falhou' ? `<div class="mt-2"><button type="button" class="btn btn-p" data-alerta="${esc(String(a.id))}">Ver prévia e enviar</button></div>` : ''}
      </div></div></div>`).join('')
    alvo.querySelectorAll('[data-alerta]').forEach(b => { b.onclick = () => enviar({ ...itens.find(x => String(x.id) === b.dataset.alerta), cliente }, { aoConcluir: () => montarResumo(alvo, cliente) }) })
  }

  // ── Distribuição: alertas aguardando envio + interruptor do automático ─────────────────────────────────
  const PAG = 50
  let limite = PAG, recarregarTabela = null
  async function montarTabela() {
    if (recarregarTabela) return recarregarTabela()
    const tb = $('tbAlertas'); if (!tb) return
    let estado = { itens: [], automatico: { ligado: false }, resumo: {} }
    const desenhar = () => {
      const itens = estado.itens || [], ligado = !!estado.automatico?.ligado
      $('nAlertas').textContent = itens.length ? Number(itens.length).toLocaleString('pt-BR') : ''
      $('alResumo').textContent = itens.length ? `${estado.resumo?.pendentes ?? 0} aguardando envio · ${estado.resumo?.enviados_7d ?? 0} enviados nos últimos 7 dias · ${estado.resumo?.bloqueados ?? 0} bloqueados` : 'Nenhum alerta registrado ainda.'
      $('alAutoEstado').innerHTML = `<span class="selo ${ligado ? 'bom' : 'atencao'}">Alerta automático ${ligado ? 'ligado' : 'desligado'}</span>`
      $('btnAlertaAuto').textContent = ligado ? 'Desligar alerta automático' : 'Ligar alerta automático'
      tb.innerHTML = itens.length ? itens.slice(0, limite).map(a => `<tr><td>${esc(a.cliente)}</td><td>${esc(a.rotulo)} <span class="mini">${esc(a.canal_rotulo || '')}</span></td>
        <td><span class="selo ${SELO_GRAV[a.gravidade] || 'neutro'}">${esc(a.gravidade === 'critico' ? 'Crítico' : a.gravidade || '')}</span><div class="mini">${brData(a.criado_em)}</div></td>
        <td>${selo(a.estado)}${a.motivo ? `<div class="mini">${esc(a.motivo)}</div>` : ''}</td>
        <td>${a.estado === 'pendente' || a.estado === 'suprimido' || a.estado === 'falhou' ? `<button type="button" class="btn btn-p" data-alerta-id="${esc(String(a.id))}">Ver prévia e enviar</button>` : (ui()?.linkSeguro(a.page_url) ? `<a href="${esc(ui().linkSeguro(a.page_url))}" target="_blank" rel="noopener noreferrer">abrir no Notion ↗</a>` : '—')}
          <a class="btn btn-fantasma btn-p" href="/cliente?cliente=${encodeURIComponent(a.cliente)}&amp;aba=resumo">Resumo</a></td></tr>`).join('')
        : '<tr><td colspan="5" class="vazio"><b>Nenhum alerta aguardando envio.</b>Quando uma pendência crítica do cliente for detectada, aparece aqui.</td></tr>'
      $('pagAlertas').innerHTML = itens.length > PAG ? `<span>1–${Math.min(limite, itens.length)} de ${itens.length}</span>${limite < itens.length ? ' · <button type="button" class="btn btn-p" id="alMais">Mostrar mais</button>' : ''}` : ''
    }
    const recarregar = async () => {
      try { estado = await api('/api/alertas/pendentes'); desenhar() }
      catch (e) { tb.innerHTML = `<tr><td colspan="5"><div class="erro-bloco"><b>Não foi possível carregar</b>${esc(e.message)}</div></td></tr>` }
    }
    $('btnAlertaAuto').onclick = async e => {
      const U = ui(); if (!U) return
      const b = e.currentTarget, ligar = !estado.automatico?.ligado; b.disabled = true
      try {
        const por = await U.pedirPor({ titulo: ligar ? 'Ligar o alerta automático' : 'Desligar o alerta automático', texto: ligar
          ? 'Pendência crítica de cliente liberado e já atendido por relatório passa a gerar uma página de alerta no Notion dele na hora, dentro da janela 08h–20h em dia útil. O aviso interno com som sempre soa, com o automático ligado ou não.'
          : 'Nenhum alerta sai sozinho para o Notion dos clientes. O aviso interno com som continua, e dá para enviar à mão, com prévia.', rotuloOk: ligar ? 'Ligar' : 'Desligar' })
        if (!por) return
        await api('/api/alertas/agendador', { ligado: ligar, por }); toast(ligar ? 'Alerta automático ligado.' : 'Alerta automático desligado.')
      } catch (x) { toast(x.message, 'erro') }
      finally { b.disabled = false; recarregar() }
    }
    document.addEventListener('click', e => {
      if (e.target.closest('#alMais')) { limite += PAG; desenhar(); return }
      const b = e.target.closest('#tbAlertas [data-alerta-id]'); if (!b) return
      const a = (estado.itens || []).find(x => String(x.id) === b.dataset.alertaId); if (a) enviar(a, { aoConcluir: recarregar })
    })
    recarregarTabela = recarregar
    await recarregar()
  }

  window.PSAlertas = { montarResumo, montarTabela, enviar }
})()
