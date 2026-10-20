// Pendências do cliente por canal no Resumo (08/10/2026): o que só o cliente pode fazer, desde quando, por que importa, o que acontece se atrasar
// e o possível impacto (só o que o sistema mede ou prevê). window.PSPendencias.montar(alvo, cliente, { faixa }) e .registrar(cliente).
// Tudo que vem do servidor passa por esc()/textContent; o módulo não decide nada: o avaliador (GET /api/cliente/pendencias) devolve o texto pronto.
(() => {
  if (window.PSPendencias) return

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const brData = iso => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—'
  const api = async (url, body) => {
    const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.erro || `erro ${r.status}`)
    return j
  }
  const toast = (t, tipo) => window.PS?.toast ? PS.toast(t, tipo) : alert(t)
  const plural = (n, um, varios) => `${Number(n || 0).toLocaleString('pt-BR')} ${n === 1 ? um : varios}`
  const brl = v => v == null ? '—' : 'R$ ' + Math.round(v).toLocaleString('pt-BR')
  const ui = () => window.PSRelatorio?.ui || null      // diálogos e campos compartilhados com relatorio.js (carrega antes)

  const css = document.createElement('style')
  css.textContent = `
  .pc-resumo{display:flex;flex-wrap:wrap;gap:var(--e-2) var(--e-4);align-items:center;margin:0 0 var(--e-3);font-size:var(--t-13)}
  .pc-acoes{display:flex;gap:var(--e-2);flex-wrap:wrap;align-items:center;margin-left:auto}
  .pc-texto p{margin:6px 0;font-size:var(--t-13)}
  .pc-texto b{font-weight:600}
  .pc-impacto{margin-top:6px;font-size:var(--t-13)}
  `
  document.head.append(css)

  const SELO_GRAV = { critico: 'ruim', atencao: 'atencao', info: 'neutro' }
  const FONTE = { medido: 'Medido pelo sistema', tarefa: 'Tarefa aguardando no Notion', registro: 'Registrado pela equipe' }

  const semRotuloEstimativa = t => String(t || '').replace(/^Estimativa:\s*/i, '')
  const linhaImpacto = i => {
    const im = i.impacto || {}
    if (im.tipo === 'medido' || im.tipo === 'previsto') {
      const temValor = /R\$/.test(String(im.rotulo || ''))      // o rótulo do avaliador já traz o valor: não repetir
      return `<div class="pc-impacto"><b>${im.tipo === 'medido' ? 'Impacto medido' : 'Possível impacto (estimativa)'}:</b> ${im.valor_brl != null && !temValor ? esc(brl(im.valor_brl)) + ' · ' : ''}${esc(im.rotulo || '')}${im.premissa ? `<div class="mini">Premissa: ${esc(semRotuloEstimativa(im.premissa))}</div>` : ''}</div>`
    }
    return `<div class="pc-impacto"><b>Impacto não estimado.</b> ${esc(im.rotulo || 'Sem dado medido neste canal para calcular um valor.')}</div>`
  }

  function cartao(i) {
    return `<div class="acao" data-pend="${esc(i.id)}"><div class="acao-topo"><div class="acao-corpo">
      <b>${esc(i.rotulo)}</b> <span class="selo neutro">${esc(i.canal_rotulo || i.canal)}</span> <span class="selo ${SELO_GRAV[i.gravidade] || 'neutro'}">${esc(i.gravidade_rotulo || i.gravidade)}</span>
      <div class="acao-meta"><span>${i.desde ? `desde ${brData(i.desde)}${i.dias != null ? ` (${i.dias} dias)` : ''}` : i.fonte === 'medido' && i.medido_em ? `leitura de ${brData(i.medido_em)}` : 'data não registrada'}</span><span>${esc(FONTE[i.fonte] || i.fonte)}</span>${i.tarefas ? `<span>${plural(i.tarefas, 'tarefa parada', 'tarefas paradas')}</span>` : ''}</div>
      <div class="mini mt-2">${esc(i.evidencia || '')}</div>
      ${linhaImpacto(i)}
      <details class="lin"><summary class="mudo peq">por que importa e o que acontece se atrasar</summary><div class="pc-texto">
        <p><b>Por que importa:</b> ${esc(i.por_que_importa)}</p><p><b>Se atrasar:</b> ${esc(i.efeito_se_atrasar)}</p>
        <p><b>O que precisamos:</b> ${esc(i.o_que_precisamos)}</p><p><b>O que fazemos quando recebermos:</b> ${esc(i.o_que_fazemos)}</p></div></details>
      ${i.registro_id ? `<div class="mt-2"><button type="button" class="btn btn-p" data-resolver="${esc(String(i.registro_id))}">Marcar como resolvida</button></div>` : ''}
    </div></div></div>`
  }

  function faixaAlerta(el, r) {
    if (!el) return
    const crit = (r.itens || []).filter(i => i.gravidade === 'critico')
    if (!crit.length) { el.hidden = true; el.innerHTML = ''; return }
    const im = r.resumo?.impacto
    el.hidden = false
    el.innerHTML = `<div class="aviso erro" role="alert"><b>Alerta: ${plural(crit.length, 'pendência crítica do cliente', 'pendências críticas do cliente')}.</b> ${esc(crit.slice(0, 3).map(i => `${i.rotulo} (${i.canal_rotulo || i.canal})`).join('; '))}${crit.length > 3 ? ` e mais ${crit.length - 3}` : ''}.${im && im.valor_brl != null ? ` Possível impacto: ${esc(brl(im.valor_brl))} (${im.tipo === 'medido' ? 'medido' : 'estimativa'}).` : ''} <a href="#secDoCliente" data-ir-aba="do-cliente">Ver na aba Do cliente</a></div>`
  }

  async function montar(alvo, cliente, { faixa } = {}) {
    if (!alvo) return
    alvo.innerHTML = '<div class="mini">Carregando as pendências do cliente…</div>'
    let r
    try { r = await api('/api/cliente/pendencias?cliente=' + encodeURIComponent(cliente)) }
    catch (e) { alvo.innerHTML = `<div class="erro-bloco"><b>Não foi possível carregar as pendências</b><div>${esc(e.message)}</div><button class="btn btn-p" type="button" data-denovo>Tentar de novo</button></div>`; alvo.querySelector('[data-denovo]').onclick = () => montar(alvo, cliente, { faixa }); faixaAlerta(faixa, { itens: [] }); return }
    const itens = r.itens || [], res = r.resumo || {}, im = res.impacto
    faixaAlerta(faixa, r)
    alvo.innerHTML = `<div class="pc-resumo"><span><b>${plural(res.total ?? itens.length, 'pendência', 'pendências')}</b>${res.criticas ? ` · ${plural(res.criticas, 'crítica', 'críticas')}` : ''}</span>
      <span class="mini">${im && im.valor_brl != null ? `Possível impacto somado: ${esc(brl(im.valor_brl))} (${im.tipo === 'medido' ? 'medido' : 'estimativa'}${im.premissa ? '; ' + esc(semRotuloEstimativa(im.premissa)) : ''})` : 'Impacto em R$ só onde o sistema mede ou prevê; nos demais casos aparece como não estimado.'}</span>
      <span class="pc-acoes"><button type="button" class="btn btn-p" id="btnRegistrarPendencia">Registrar pendência do cliente</button></span></div>
      ${itens.length ? itens.map(cartao).join('') : '<div class="vazio-box"><b>Nenhuma pendência do cliente agora.</b>Quando o sistema medir ou a equipe registrar algo que só o cliente pode fazer, aparece aqui.</div>'}`
    alvo.querySelector('#btnRegistrarPendencia').onclick = () => registrar(cliente, { aoConcluir: () => montar(alvo, cliente, { faixa }) })
    alvo.querySelectorAll('[data-resolver]').forEach(b => { b.onclick = () => resolver(b.dataset.resolver, { aoConcluir: () => montar(alvo, cliente, { faixa }) }) })
  }

  // ── registrar pendência (canal sem integração ou obrigação sem card): prévia → confirmar ───────────────
  async function registrar(cliente, { aoConcluir } = {}) {
    const U = ui(); if (!U) { toast('Recarregue a página: o módulo de diálogos não carregou.', 'erro'); return }
    let cat
    try { cat = await api('/api/pendencias/catalogo') } catch (e) { toast(e.message, 'erro'); return }
    const { corpo, rodape, fechar } = U.dialogo(`Registrar pendência do cliente · ${cliente}`)
    const canais = cat.canais || [], hoje = new Date().toISOString().slice(0, 10)
    corpo.innerHTML = `<p>Use para o que o sistema não enxerga (Shopee, Amazon, TikTok) ou para uma obrigação sem tarefa no Notion. O texto que o cliente lê vem do catálogo; você só informa o que e desde quando.</p>
      <div class="campo"><label for="pcCanal">Canal</label><select id="pcCanal">${canais.map(c => `<option value="${esc(c.id)}">${esc(c.rotulo)}</option>`).join('')}</select></div>
      <div class="campo"><label for="pcItem">O que depende do cliente</label><select id="pcItem"></select></div>
      <div class="campo"><label for="pcDetalhe">Detalhe (o que falta, em uma frase, até 300 caracteres)</label><textarea id="pcDetalhe" maxlength="300" rows="3"></textarea></div>
      <div class="linha"><div class="campo"><label for="pcDesde">Desde quando</label><input type="date" id="pcDesde" value="${esc(hoje)}" max="${esc(hoje)}"></div>
      <div class="campo"><label for="pcGrav">Gravidade</label><select id="pcGrav"><option value="atencao">Atenção</option><option value="critico">Crítico</option></select></div></div>
      <div class="campo"><label for="pcEvid">Evidência (link opcional: print, e-mail, WhatsApp)</label><input type="url" id="pcEvid" maxlength="500" placeholder="https://…"></div>
      ${U.campoPor('pcPor')}<div id="pcSaida"></div>`
    const itensDoCanal = () => (cat.itens || []).filter(i => !i.canais || i.canais.includes(corpo.querySelector('#pcCanal').value))
    const atualizarItens = () => { corpo.querySelector('#pcItem').innerHTML = itensDoCanal().map(i => `<option value="${esc(i.id)}">${esc(i.rotulo)}</option>`).join('') }
    corpo.querySelector('#pcCanal').onchange = atualizarItens; atualizarItens()
    const saida = corpo.querySelector('#pcSaida')
    const dados = () => ({ cliente, canal: corpo.querySelector('#pcCanal').value, item: corpo.querySelector('#pcItem').value, detalhe: corpo.querySelector('#pcDetalhe').value.trim(),
      desde: corpo.querySelector('#pcDesde').value, gravidade: corpo.querySelector('#pcGrav').value, evidencia: corpo.querySelector('#pcEvid').value.trim(), por: U.lerPor(corpo, 'pcPor') })
    const previaBt = U.botao('Ver prévia', { aoClicar: async () => {
      const b = dados()
      if (!b.por) { saida.innerHTML = U.aviso('erro', 'Informe seu nome.'); return }
      if (b.detalhe.length < 3) { saida.innerHTML = U.aviso('erro', 'Descreva o que falta (pelo menos 3 caracteres).'); return }
      U.gravarNome(b.por); previaBt.disabled = true
      let v
      try { v = await api('/api/pendencias/registrar', b) } catch (e) { saida.innerHTML = U.aviso('erro', esc(e.message)); previaBt.disabled = false; return }
      const p = v.pendencia || {}
      saida.innerHTML = `<div class="aviso info"><b>O cliente vai ler:</b><div class="pc-texto"><p><b>Por que importa:</b> ${esc(p.por_que_importa)}</p><p><b>Se atrasar:</b> ${esc(p.efeito_se_atrasar)}</p><p><b>O que precisamos:</b> ${esc(p.o_que_precisamos)}</p></div>${linhaImpacto(p)}</div>`
      previaBt.remove()
      rodape.append(U.botao('Registrar', { primario: true, aoClicar: async e => {
        e.currentTarget.disabled = true
        try { await api('/api/pendencias/registrar', { ...b, confirmar: true }); toast('Pendência registrada.'); fechar(); aoConcluir?.() }
        catch (x) { saida.insertAdjacentHTML('beforeend', U.aviso('erro', esc(x.message))); e.currentTarget.disabled = false }
      } }))
    } })
    rodape.append(U.botao('Cancelar', { aoClicar: fechar }), previaBt)
  }

  async function resolver(registroId, { aoConcluir } = {}) {
    const U = ui(); if (!U) { toast('Recarregue a página: o módulo de diálogos não carregou.', 'erro'); return }
    const { corpo, rodape, fechar } = U.dialogo('Marcar pendência como resolvida')
    corpo.innerHTML = `<p>A pendência deixa de aparecer no Resumo e nos relatórios. O registro fica guardado.</p>
      <div class="campo"><label for="pcNota">Nota (opcional)</label><input id="pcNota" maxlength="300"></div>${U.campoPor('pcPor2')}<div id="pcSaida2"></div>`
    rodape.append(U.botao('Cancelar', { aoClicar: fechar }), U.botao('Marcar como resolvida', { primario: true, aoClicar: async e => {
      const por = U.lerPor(corpo, 'pcPor2'), saida = corpo.querySelector('#pcSaida2')
      if (!por) { saida.innerHTML = U.aviso('erro', 'Informe seu nome.'); return }
      U.gravarNome(por); e.currentTarget.disabled = true
      try { await api('/api/pendencias/resolver', { registro_id: Number(registroId), por, nota: corpo.querySelector('#pcNota').value.trim(), confirmar: true }); toast('Pendência resolvida.'); fechar(); aoConcluir?.() }
      catch (x) { saida.innerHTML = U.aviso('erro', esc(x.message)); e.currentTarget.disabled = false }
    } }))
  }

  window.PSPendencias = { montar, registrar, resolver }
})()
