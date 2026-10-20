// Perfil de informação do cliente (src/lib/perfil-informacao.js): o que cada cliente quer receber no relatório.
// window.PSPerfilInfo.montarCliente(alvo, cliente) → /cliente › Configurar (#secPerfilCliente): serviço, temas ordenáveis (checkbox + ordem), nível, observação, fonte, histórico.
// window.PSPerfilInfo.montarPlanos(alvo) → /planos › #secPerfilInfo «O que os clientes querem receber»: matriz tema × clientes (6 colunas) + sugestões pendentes.
// O servidor decide tudo; aqui só mostra e pede. Tudo que vem do servidor passa por esc(). Sem primário na tela (o confirmar do shell é o diálogo); sem cor nova, sem emoji.
// Gravação: prévia → confirmar:true (cada mudança entra no histórico e no livro de registro).
(() => {
  if (window.PSPerfilInfo) return
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const brHora = iso => { const d = new Date(iso); return Number.isNaN(+d) ? '—' : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }
  const brData = iso => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—'
  const fmt = n => n == null ? '—' : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 1 })
  const api = async (url, body) => {
    const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.erro || `erro ${r.status}`)
    return j
  }
  const toast = (t, tipo) => window.PS?.toast ? PS.toast(t, tipo) : alert(t)
  const confirmar = o => (window.PS?.confirmar ?? (x => Promise.resolve(confirm(x.titulo + (x.texto ? '\n\n' + x.texto : '')))))(o)
  const lerNome = () => { try { return localStorage.getItem('ps_perfil_por') || '' } catch { return '' } }
  const gravarNome = v => { try { localStorage.setItem('ps_perfil_por', v) } catch { /* sem armazenamento: só não lembra o nome */ } }
  const erroBloco = (alvo, e, denovo) => { alvo.innerHTML = `<div class="erro-bloco"><b>Não foi possível carregar</b><div>${esc(e.message)}</div><button class="btn btn-p" type="button" data-denovo>Tentar de novo</button></div>`; alvo.querySelector('[data-denovo]').onclick = denovo }
  const linkCli = c => `<a href="/cliente?cliente=${encodeURIComponent(c)}&amp;aba=configurar">${esc(c)}</a>`

  // ── /cliente › Configurar ─────────────────────────────────────────────────────────────────────────────
  async function montarCliente(alvo, cliente) {
    if (!alvo) return
    let r
    try { r = await api('/api/cliente/perfil-informacao?cliente=' + encodeURIComponent(cliente)) } catch (e) { erroBloco(alvo, e, () => montarCliente(alvo, cliente)); return }
    const C = r.catalogo, rot = t => C.temas.find(x => x.tema === t)?.rotulo || t, base = r.perfil || r.sugestao
    const ordem = new Map((base?.temas || []).map((t, i) => [t, i + 1]))
    const resumo = p => `${p.servico ? C.servicos[p.servico] : 'serviço não informado'} · ${p.temas?.length ? p.temas.map(rot).join(', ') : 'só a base fixa'} · nível ${String(C.niveis[p.nivel] || p.nivel).split(' (')[0].toLowerCase()}`
    alvo.innerHTML = `
      <p class="veredito-frase" id="piVeredito">${r.perfil ? `<b>Perfil salvo</b> por ${esc(r.perfil.por)} em ${esc(brHora(r.perfil.atualizado_em))} · ${esc(C.fontes[r.perfil.fonte] || r.perfil.fonte)}.` : r.sugestao ? '<b>Sem perfil salvo.</b> Há uma sugestão pelas respostas no WhatsApp: confira e salve.' : '<b>Sem perfil salvo:</b> o relatório leva só a base fixa.'}</p>
      ${r.sugestao ? `<div class="aviso amb">Sugestão pelas ${esc(String(r.sugestao.respostas))} resposta(s) no grupo (até ${esc(brData(r.sugestao.ate))}): ${esc(r.sugestao.temas.map(rot).join(', '))}. Só sugere: o relatório não muda até alguém salvar.</div>` : ''}
      <p class="mini" id="piOrdem">Ordem dos blocos no relatório hoje: ${esc(r.efetivo.ordem.map((t, i) => `${i + 1}. ${rot(t)}`).join(' · '))}. Pedidos sobem para o topo; a base fixa (${esc(C.base_fixa.map(rot).join(', '))}) vem para todos.</p>
      <div class="pf-grid">
        <div class="pf-campo"><label for="piServico">Serviço</label><select id="piServico"><option value="">Não informado</option>${Object.entries(C.servicos).map(([k, v]) => `<option value="${esc(k)}"${base?.servico === k ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></div>
        <div class="pf-campo"><label for="piNivel">Nível</label><select id="piNivel">${Object.entries(C.niveis).map(([k, v]) => `<option value="${esc(k)}"${(base?.nivel || 'padrao') === k ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></div>
        <div class="pf-campo"><label for="piFonte">De onde veio</label><select id="piFonte">${['equipe', 'whatsapp'].map(k => `<option value="${k}"${(r.perfil?.fonte || (r.sugestao ? 'whatsapp' : 'equipe')) === k ? ' selected' : ''}>${esc(C.fontes[k])}</option>`).join('')}</select></div>
        <div class="pf-campo"><label for="piPor">Seu nome (líder, consultor ou CS deste cliente)</label><input id="piPor" list="piPorLista" maxlength="80" autocomplete="name" value="${esc(lerNome())}"><datalist id="piPorLista">${(r.quem || []).map(n => `<option value="${esc(n)}">`).join('')}</datalist></div>
      </div>
      <div class="pf-campo mt-2"><label for="piObs">Observação interna (até 500 caracteres, sem telefone)</label><textarea id="piObs" maxlength="500" rows="2">${esc(r.perfil?.observacao || '')}</textarea></div>
      <div class="tabela-wrap mt-2"><table class="t" id="piTemas"><caption class="sr">Temas que ${esc(cliente)} quer receber</caption><thead><tr><th scope="col">Receber</th><th scope="col">Ordem</th><th scope="col">Tema</th></tr></thead><tbody>${C.temas.map(t => `<tr>
        <td><input type="checkbox" data-pi-tema="${esc(t.tema)}" aria-label="Receber ${esc(t.rotulo)}"${ordem.has(t.tema) ? ' checked' : ''}></td>
        <td><input type="number" min="1" max="${C.temas.length}" step="1" data-pi-ordem="${esc(t.tema)}" aria-label="Ordem de ${esc(t.rotulo)}" value="${ordem.get(t.tema) || ''}"></td>
        <td>${esc(t.rotulo)}${t.base_fixa ? ' <span class="selo neutro">base fixa</span>' : ''}</td></tr>`).join('')}</tbody></table></div>
      <div class="linha mt-2"><button class="btn" type="button" id="btnPiSalvar">Salvar preferências</button><span class="mini">Marque o que o cliente pediu e numere a ordem; tema da base fixa só precisa ser marcado para subir ao topo.</span></div>
      <div id="piMsg"></div>
      <details class="mini mt-2" id="piHist"><summary>Histórico (${esc(String(r.historico.length))})</summary><ul>${r.historico.map(x => `<li>${esc(brHora(x.em))} · ${esc(x.por)} · ${esc(C.fontes[x.depois.fonte] || x.depois.fonte)}: ${esc(resumo(x.depois))}${x.antes ? '' : ' (primeiro registro)'}${x.depois.observacao ? ` — ${esc(x.depois.observacao)}` : ''}</li>`).join('') || '<li>Nenhuma mudança registrada.</li>'}</ul></details>`
    const q = s => alvo.querySelector(s), msg = t => { q('#piMsg').innerHTML = `<div class="aviso erro">${esc(t)}</div>` }
    // marcar sem número = vai para o fim da fila; desmarcar limpa o número
    q('#piTemas').addEventListener('change', e => {
      const t = e.target.dataset?.piTema; if (!t) return
      const n = q(`[data-pi-ordem="${t}"]`)
      if (!e.target.checked) n.value = ''
      else if (!n.value) n.value = 1 + Math.max(0, ...[...alvo.querySelectorAll('[data-pi-ordem]')].map(x => Number(x.value) || 0))
    })
    q('#btnPiSalvar').onclick = async e => {
      const b = e.currentTarget, por = q('#piPor').value.trim()
      if (!por) return msg('Informe seu nome.')
      const pos = t => Number(q(`[data-pi-ordem="${t}"]`).value) || Infinity
      const temas = C.temas.map(x => x.tema).filter(t => q(`[data-pi-tema="${t}"]`).checked).sort((a, z) => pos(a) - pos(z))   // sort estável: empate = ordem do catálogo
      const corpo = { cliente, servico: q('#piServico').value, nivel: q('#piNivel').value, fonte: q('#piFonte').value, observacao: q('#piObs').value.trim(), temas, por }
      gravarNome(por); b.disabled = true
      try {
        const v = await api('/api/cliente/perfil-informacao', corpo)
        if (!v.mudou) { q('#piMsg').innerHTML = '<div class="aviso info">Nada mudou: igual ao perfil salvo.</div>'; return }
        const ok = await confirmar({ titulo: `Salvar o que ${cliente} quer receber`, rotuloOk: 'Salvar',
          texto: `${v.antes ? `Antes: ${resumo(v.antes)}. ` : ''}Depois: ${resumo(v.depois)}. Fonte: ${C.fontes[v.depois.fonte]}. A mudança entra no histórico e no livro de registro do cliente.` })
        if (!ok) return
        await api('/api/cliente/perfil-informacao', { ...corpo, confirmar: true })
        toast('Preferências salvas; valem a partir do próximo relatório.'); montarCliente(alvo, cliente)
      } catch (x) { msg(x.message) } finally { b.disabled = false }
    }
  }

  // ── /planos › #secPerfilInfo ──────────────────────────────────────────────────────────────────────────
  async function montarPlanos(alvo) {
    if (!alvo) return
    let m
    try { m = await api('/api/perfil-informacao/matriz') } catch (e) { erroBloco(alvo, e, () => montarPlanos(alvo)); return }
    const rot = t => m.catalogo.temas.find(x => x.tema === t)?.rotulo || t, n = document.getElementById('nPerfilInfo')
    if (n) n.textContent = m.com_perfil ? String(m.com_perfil) : ''
    const S = m.por_servico
    alvo.innerHTML = `
      <p class="mini" id="piResumo">Carteira: ${fmt(m.carteira)} cliente(s) ativo(s) · ${fmt(m.com_perfil)} com perfil (${fmt(m.pct_com_perfil)}%) · assessoria ${fmt(S.assessoria)} · consultoria ${fmt(S.consultoria)} · sem serviço ${fmt(S.sem_servico)} · didático ${fmt(m.por_nivel.didatico)} · completo ${fmt(m.por_nivel.completo)}.
        Temas mais pedidos: ${m.temas_padrao.length ? esc(m.temas_padrao.map(rot).join(', ')) : 'nenhum ainda'}. Quem não tem perfil recebe a base fixa nesta ordem: ${esc(m.ordem_sem_perfil.map(rot).join(', '))}.</p>
      <div class="tabela-wrap fixa mt-2"><table class="t" id="piMatriz"><caption class="sr">Temas pedidos pelos clientes</caption>
        <thead><tr><th scope="col">Tema</th><th scope="col" class="n">Clientes</th><th scope="col" class="n">% dos perfis</th><th scope="col" class="n">Assessoria</th><th scope="col" class="n">Consultoria</th><th scope="col">Quem pediu</th></tr></thead>
        <tbody>${m.por_tema.map(t => `<tr><td>${esc(t.rotulo)}${t.base_fixa ? ' <span class="selo neutro">base fixa</span>' : ''}</td><td class="n">${fmt(t.n)}</td><td class="n">${t.pct_com_perfil == null ? '—' : fmt(t.pct_com_perfil) + '%'}</td>
          <td class="n">${fmt(t.por_servico.assessoria)}</td><td class="n">${fmt(t.por_servico.consultoria)}</td>
          <td>${t.clientes.length ? t.clientes.map(c => `${linkCli(c.cliente)} <span class="mini">${esc(String(c.posicao))}º</span>`).join(', ') : '<span class="mudo">—</span>'}${t.n_sugestao ? `<div class="mini">sugestão: ${t.sugestoes.map(esc).join(', ')}</div>` : ''}</td></tr>`).join('')}</tbody></table></div>
      <p class="mini mt-2" id="piSugestoes">${m.sugestoes.length ? `Sugestões pelas respostas no WhatsApp, ainda sem perfil (confira e salve em Configurar): ${m.sugestoes.map(s => `${linkCli(s.cliente)} — ${esc(s.temas.map(rot).join(', '))}`).join(' · ')}` : 'Nenhuma sugestão pendente: quem respondeu no grupo já tem perfil salvo.'}</p>`
  }

  window.PSPerfilInfo = { montarCliente, montarPlanos }
})()
