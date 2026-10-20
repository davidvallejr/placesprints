// Aba «Do cliente» do /cliente (15/10/2026): o que depende do cliente num lugar só — pendências, ações do plano com caminho cliente, compras do dia, tarefas do Notion
// em dependência e a comunicação de cada ponto. Só desenha o que GET /api/cliente/do-cliente devolve (o servidor junta e ordena; nada é decidido aqui).
// window.PSDoCliente.montar(alvo, cliente, { aoCarregar }) e .movidos(alvo, r). Botões secundários; o primário só dentro do diálogo (Confirmar).
// Marcar (resolvido / resposta / mover para o consultor) = prévia → confirmar:true; lembrete = só prepara o texto, nada é enviado por esta tela.
(() => {
  if (window.PSDoCliente) return
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const brData = iso => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—'
  const brl = v => v == null ? '—' : 'R$ ' + Math.round(v).toLocaleString('pt-BR')
  const brl2 = v => v == null ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const plural = (n, um, varios) => `${Number(n || 0).toLocaleString('pt-BR')} ${n === 1 ? um : varios}`
  const api = async (url, body) => {
    const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.erro || `erro ${r.status}`)
    return j
  }
  const toast = (t, tipo) => window.PS?.toast ? PS.toast(t, tipo) : alert(t)
  const ui = () => window.PSRelatorio?.ui || null

  const SELO_GRAV = { critico: 'ruim', atencao: 'atencao', info: 'neutro' }
  const SELO_FAIXA = { aguardando: 'neutro', cobrar: 'atencao', revisar: 'ruim' }
  const FONTE = { pendencia: 'pendência medida ou registrada', plano: 'ação do plano', compras: 'compras do dia', tarefa: 'tarefa no Notion' }
  const LOTE = { semanal: 'plano semanal', imediato: 'aviso urgente', compras: 'micro de compras' }
  const ST = { proposta: 'proposta', aprovada: 'aprovada', distribuida: 'no Notion' }
  const CANAL = { ml: 'Mercado Livre', shopee: 'Shopee', amazon: 'Amazon', tiktok: 'TikTok Shop', magalu: 'Magalu', geral: 'Geral' }
  const MOSTRA = 8

  const avisoTxt = u => !u ? 'nenhum aviso registrado' : `${brData(u.enviado_em)} · ${esc(LOTE[u.tipo] || u.tipo || 'aviso')}${u.estado ? ` · ${esc(u.estado)}` : ''}${(u.recibos || []).length ? ` (${u.recibos.map(x => `${esc(x.canal)}: ${esc(x.estado || '—')}`).join(', ')})` : ''}`
  const perdaTxt = p => !p ? '—' : p.b > 0 ? `${p.c === p.b ? brl(p.b) : `${brl(p.c)} a ${brl(p.b)}`} em ${p.dias} dias` : 'pedir para não faltar'
  const estoqueTxt = p => p.estoque == null ? '—' : `${p.estoque} un${p.cobertura != null ? ` · ${p.cobertura} dia(s)` : ''}`

  function tabelaProdutos(i) {
    if (!i.produtos.length) return ''
    const linha = (p, k) => `<tr${k >= MOSTRA ? ' hidden data-extra' : ''}><td class="mono">${esc(p.id)}</td><td>${esc(p.titulo || '—')}${p.curva ? ` <span class="mudo">curva ${esc(p.curva)}</span>` : ''}</td><td class="n">${brl2(p.preco)}</td><td class="n">${estoqueTxt(p)}</td><td class="n">${perdaTxt(p.perda)}</td></tr>`
    const t = i.total_em_jogo
    return `<div class="tabela-wrap mt-2"><table class="t empilha"><caption class="sr">Produtos de ${esc(i.titulo)}</caption>
      <thead><tr><th scope="col">MLB</th><th scope="col">Título</th><th scope="col" class="n">Preço</th><th scope="col" class="n">Estoque · cobertura</th><th scope="col" class="n">Perda se não repor</th></tr></thead>
      <tbody>${i.produtos.map(linha).join('')}</tbody></table></div>
      ${i.produtos.length > MOSTRA ? `<button class="btn btn-p mt-2" type="button" data-mais-prod>Mostrar mais ${i.produtos.length - MOSTRA} produtos</button>` : ''}
      ${t ? `<p class="mini mt-2"><b>Total em jogo:</b> ${t.c === t.b ? brl(t.b) : `${brl(t.c)} a ${brl(t.b)}`} em vendas${t.dias.length === 1 ? ` nos próximos ${t.dias[0]} dias` : ''} se a reposição não acontecer (estimativa pelo ritmo de 28 dias; a mesma conta do micro de compras).</p>` : ''}`
  }

  function cartao(i) {
    const c = i.comunicacao || {}
    const imp = i.total_em_jogo ? '' : i.impacto?.valor_brl != null ? `<div class="mini mt-2"><b>Possível impacto (estimativa):</b> ${esc(i.impacto.rotulo)}${i.impacto.premissa ? `<div class="mudo">${esc(i.impacto.premissa)}</div>` : ''}</div>` : `<div class="mini mt-2">${/^Impacto não estimado/.test(i.impacto?.rotulo || '') ? esc(i.impacto.rotulo) : `<b>Impacto não estimado.</b> ${esc(i.impacto?.rotulo || '')}`}</div>`
    return `<div class="acao" data-dc="${esc(i.chave)}"><div class="acao-topo">
      ${i.prioridade?.p ? `<span class="p-badge p-${esc(i.prioridade.p)}" title="a mesma prioridade do plano (maior nota entre as ações ligadas)">${esc(i.prioridade.p)}</span>` : ''}
      <div class="acao-corpo">
        <b>${esc(i.titulo)}</b> <span class="selo ${SELO_GRAV[i.gravidade] || 'neutro'}">${esc(i.gravidade_rotulo || i.gravidade)}</span> <span class="selo neutro">${esc(CANAL[i.canal] || i.canal)}</span>
        <div class="acao-meta"><span>${i.desde ? `desde ${brData(i.desde)}${i.dias != null ? ` (${i.dias} dias)` : ''}` : 'medido na leitura de hoje'}</span><span>${i.fontes.map(f => esc(FONTE[f] || f)).join(' · ')}</span></div>
        ${i.evidencia ? `<div class="mini mt-2">${esc(i.evidencia)}</div>` : ''}
        ${imp}
        ${i.o_que_precisamos ? `<div class="mini mt-2"><b>O que precisamos:</b> ${esc(i.o_que_precisamos)}</div>` : ''}
        ${i.o_que_fazemos ? `<div class="mini"><b>O que a Place2u faz ao receber:</b> ${esc(i.o_que_fazemos)}</div>` : ''}
        ${tabelaProdutos(i)}
        ${i.acoes.length ? `<details class="evid"><summary>${plural(i.acoes.length, 'ação do plano', 'ações do plano')} ligada${i.acoes.length === 1 ? '' : 's'}</summary><div class="box">${i.acoes.map(a => `<div><span class="p-badge p-${esc(a.p || 'P3')}">${esc(a.p || '—')}</span> ${esc(a.titulo)} <span class="mudo">(${esc(ST[a.status] || a.status)}${a.caminho === 'cliente' ? ', caminho do cliente' : ''})</span>${a.notion_url ? ` <a href="${esc(a.notion_url)}" target="_blank" rel="noopener">Notion</a>` : ''}</div>`).join('')}</div></details>` : ''}
        ${i.tarefas.length ? `<details class="evid"><summary>${plural(i.tarefas.length, 'tarefa aguardando o cliente', 'tarefas aguardando o cliente')}</summary><div class="box">${i.tarefas.map(t => `<div><a href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.titulo)}</a> <span class="selo ${SELO_FAIXA[t.faixa] || 'neutro'}">${esc(t.faixa_rotulo || t.faixa)}</span> <span class="mudo">${t.dias != null ? `${t.dias} dias` : 'sem data'}${t.tipo_rotulo ? ` · ${esc(t.tipo_rotulo)}` : ''}</span></div>`).join('')}</div></details>` : ''}
        <div class="acao-meta mt-2"><span><b>Último aviso:</b> ${avisoTxt(c.ultimo)}</span>
          <span>${c.resposta ? `<b>Resposta:</b> ${brData(c.resposta.em)} «${esc(c.resposta.texto.slice(0, 140))}» <span class="mudo">(${esc(c.resposta.origem)})</span>` : c.sem_resposta_dias === 0 ? '<span class="mudo">aguardando resposta ao aviso de hoje</span>' : c.sem_resposta_dias != null ? `<b>Sem resposta há ${c.sem_resposta_dias} dia(s)</b>` : '<span class="mudo">sem resposta registrada</span>'}</span></div>
        <div class="acao-botoes mt-2">
          <button class="btn-mini" type="button" data-dc-acao="resposta">Registrar resposta</button>
          <button class="btn-mini ok" type="button" data-dc-acao="resolvido">Marcar resolvido</button>
          <button class="btn-mini" type="button" data-dc-acao="movido">Mover para o consultor</button>
          <button class="btn-mini" type="button" data-dc-lembrete>Preparar lembrete</button>
        </div>
      </div></div></div>`
  }

  async function montar(alvo, cliente, { aoCarregar } = {}) {
    if (!alvo) return
    alvo.innerHTML = '<div aria-busy="true"><div class="sk-kpi"></div><div class="sk-tabela"></div></div>'
    let r
    try { r = await api('/api/cliente/do-cliente?cliente=' + encodeURIComponent(cliente)) }
    catch (e) { alvo.innerHTML = `<div class="erro-bloco"><b>Não foi possível carregar</b><div>${esc(e.message)}</div><button class="btn btn-p" type="button" data-denovo>Tentar de novo</button></div>`; alvo.querySelector('[data-denovo]').onclick = () => montar(alvo, cliente, { aoCarregar }); return }
    aoCarregar?.(r)
    const s = r.resumo || {}
    alvo.innerHTML = `<p class="veredito-frase"><b>${plural(s.total, 'ponto aberto', 'pontos abertos')} do cliente</b>${s.criticas ? ` · ${plural(s.criticas, 'crítico', 'críticos')}` : ''}${s.em_jogo_brl ? ` · até ${brl(s.em_jogo_brl)} em vendas em jogo (estimativa)` : ''}</p>
      <p class="mini">Último aviso ao cliente: ${avisoTxt(s.ultimo_aviso)} · Última resposta: ${s.ultima_resposta ? `${brData(s.ultima_resposta.em)} (${esc(s.ultima_resposta.origem)})` : 'nenhuma registrada'}</p>
      ${(r.itens || []).length ? r.itens.map(cartao).join('') : '<div class="vazio-box"><b>Nada depende do cliente agora.</b>Quando o sistema medir, a equipe registrar ou o plano gerar algo que só o cliente pode fazer, aparece aqui.</div>'}
      ${(r.movidos || []).length ? `<p class="mini mt-4">${plural(r.movidos.length, 'item foi movido', 'itens foram movidos')} para a equipe: aparecem no filtro Equipe da aba Plano.</p>` : ''}`
    const recarrega = () => montar(alvo, cliente, { aoCarregar })
    alvo.querySelectorAll('[data-dc]').forEach(el => {
      const chave = el.dataset.dc, it = r.itens.find(x => x.chave === chave)
      el.querySelector('[data-mais-prod]')?.addEventListener('click', e => { el.querySelectorAll('[data-extra]').forEach(x => { x.hidden = false }); e.currentTarget.remove() })
      el.querySelectorAll('[data-dc-acao]').forEach(b => { b.onclick = () => marcar(cliente, it, b.dataset.dcAcao, recarrega) })
      el.querySelector('[data-dc-lembrete]').onclick = () => lembrete(cliente, it)
    })
  }

  const TITULO_ACAO = { resposta: 'Registrar resposta do cliente', resolvido: 'Marcar como resolvido', movido: 'Mover para o consultor' }
  async function marcar(cliente, it, acao, aoConcluir) {
    const U = ui(); if (!U) { toast('Recarregue a página: o módulo de diálogos não carregou.', 'erro'); return }
    const { corpo, rodape, fechar } = U.dialogo(`${TITULO_ACAO[acao]} · ${it.titulo}`)
    corpo.innerHTML = `<div class="campo"><label for="dcTexto">${acao === 'resposta' ? 'O que o cliente respondeu (resumo interno, de 3 a 300 caracteres)' : 'Nota interna (opcional, até 300 caracteres)'}</label><textarea id="dcTexto" maxlength="300" rows="3"></textarea></div>
      ${U.campoPor('dcPor')}<div id="dcSaida"></div>`
    const saida = corpo.querySelector('#dcSaida'), corpoReq = () => ({ cliente, chave: it.chave, acao, texto: corpo.querySelector('#dcTexto').value.trim(), por: U.lerPor(corpo, 'dcPor') })
    const previaBt = U.botao('Ver prévia', { aoClicar: async () => {
      const b = corpoReq()
      if (!b.por) { saida.innerHTML = U.aviso('erro', 'Informe seu nome.'); return }
      previaBt.disabled = true
      let v
      try { v = await api('/api/cliente/do-cliente/marcar', b) } catch (e) { saida.innerHTML = U.aviso('erro', esc(e.message)); previaBt.disabled = false; return }
      U.gravarNome(b.por)
      saida.innerHTML = U.aviso('info', `<b>O que acontece:</b> ${esc(v.efeito)}`)
      previaBt.remove()
      rodape.append(U.botao('Confirmar', { primario: true, aoClicar: async e => {
        e.currentTarget.disabled = true
        try { await api('/api/cliente/do-cliente/marcar', { ...b, confirmar: true }); toast('Registrado.'); fechar(); aoConcluir?.() }
        catch (x) { saida.insertAdjacentHTML('beforeend', U.aviso('erro', esc(x.message))); e.currentTarget.disabled = false }
      } }))
    } })
    rodape.append(U.botao('Cancelar', { aoClicar: fechar }), previaBt)
  }

  async function lembrete(cliente, it) {
    const U = ui(); if (!U) { toast('Recarregue a página: o módulo de diálogos não carregou.', 'erro'); return }
    const { corpo, rodape, fechar } = U.dialogo(`Lembrete ao cliente · ${it.titulo}`)
    corpo.innerHTML = '<div class="mini">Preparando o texto…</div>'
    rodape.append(U.botao('Fechar', { aoClicar: fechar }))
    try {
      const v = await api('/api/cliente/do-cliente/lembrete', { cliente, chave: it.chave })
      corpo.innerHTML = v.ok ? `<p>Texto preparado (${v.caracteres} caracteres). <b>Nada foi enviado nem gravado.</b></p><div class="rl-linhas">${esc(v.texto)}</div><p class="mini">${esc(v.como_enviar)}</p>`
        : U.aviso('atencao', esc(v.mensagem || 'Sem texto para este item.'))
    } catch (e) { corpo.innerHTML = U.aviso('erro', esc(e.message)) }
  }

  // aba Plano (filtro Equipe/Tudo): o que saiu da aba do cliente e virou da equipe
  function movidos(alvo, r) {
    if (!alvo) return
    const l = r?.movidos || []
    alvo.hidden = !l.length
    alvo.innerHTML = l.length ? `<div class="aviso info"><b>Movidos da aba Do cliente para a equipe:</b> ${l.map(m => `${esc(m.titulo)} <span class="mudo">(${esc(m.por)}, ${brData(m.em)}${m.texto ? ` · ${esc(m.texto)}` : ''})</span>`).join('; ')}</div>` : ''
  }

  window.PSDoCliente = { montar, movidos }
})()
