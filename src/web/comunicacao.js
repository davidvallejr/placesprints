// Comunicação (/comunicacao; docs/desenho-comunicacao-esteira.md § 0 e § 2, F1+tela só leitura, 22/10/2026): GET /api/comunicacao/fila → interruptores banco × arquivo
// (só mostra), faixas Cliente/Time vindas separadas do servidor, contadores por estado, modo Lote (tabela de 6 colunas) e Assistida (uma linha por cliente
// que expande). Botões SÓ nas rotas de escrita que já existem (item.acao do servidor: liberar, reenviar com prévia) + «Preparar lote (prévia)», que nunca
// confirma. O ÚNICO botão primário é #btnComPreparar. Sem emoji, sem hex; tudo do servidor passa por esc(). Sem atualização automática (decisão 9 do desenho).
(() => {
  const $ = id => document.getElementById(id)
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const api = async (url, body) => {
    const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.erro || `erro ${r.status}`)
    return j
  }
  const toast = (t, tipo) => window.PS?.toast ? PS.toast(t, tipo) : alert(t)
  const confirmar = o => window.PS?.confirmar ? PS.confirmar(o) : Promise.resolve(confirm(o.texto || o.titulo))
  const pedirPor = o => window.PSRelatorio?.ui ? window.PSRelatorio.ui.pedirPor(o) : (toast('Recarregue a página: o módulo de diálogos não carregou.', 'erro'), Promise.resolve(null))
  const hora = iso => iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'
  const dataHora = iso => /^\d{4}-\d{2}-\d{2}T/.test(iso || '') ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : esc(iso || '—')
  const ROT = { processando: 'Processando', aguardando: 'Aguardando você', prontos: 'Prontos', enviado: 'Enviado', falhou: 'Falhou', pausado: 'Pausado', nao_elegivel: 'Não elegível' }
  const COR = { processando: 'azul', aguardando: 'atencao', prontos: 'bom', enviado: 'bom', falhou: 'ruim', pausado: 'neutro', nao_elegivel: 'neutro' }
  const NOME_SIS = { trinity: 'Trinity', arquiteto: 'Arquiteto', oraculo: 'Oráculo', merovingio: 'Merovíngio', chaveiro: 'Chaveiro', morpheus: 'Morpheus', smith: 'Smith', neo: 'Neo' }
  const seloEstado = e => `<span class="selo ${COR[e] || 'neutro'}">${esc(ROT[e] || e)}</span>`
  const ESTAGIO_S = { feito: 'feito', falta: 'falta', barrado: 'barrado pelo auditor', na: 'não se aplica' }
  const pontos = it => `<span class="com-est" role="img" aria-label="${esc(it.estagios.map(s => `${s.nome}: ${ESTAGIO_S[s.s]}`).join('; '))}">${it.estagios.map(s => `<i class="${s.s}" title="${esc(s.nome)}: ${esc(ESTAGIO_S[s.s])}"></i>`).join('')}</span>`
  const liga = v => v == null ? '—' : v ? 'ligado' : 'desligado'

  const st = { dados: null, faixa: 'cliente', e: 'aguardando', modo: 'lote' }
  const ACOES = new Map()   // chave → item.acao (o que o servidor mandou; nunca rota montada aqui)

  function desenharGate(G) {
    const tb = $('tbGate')
    if (!G) { tb.innerHTML = '<tr><td colspan="5"><div class="vazio-box"><b>Interruptores não lidos.</b>O contexto da tela de Estruturas não pôde ser lido agora.</div></td></tr>'; return }
    tb.innerHTML = G.map(g => `<tr data-id="${esc(g.id)}">
      <td data-rotulo="Interruptor"><div><b>${esc(g.nome)}</b><span class="com-sub">faixa ${g.faixa === 'time' ? 'Time' : 'Cliente'}</span></div></td>
      <td data-rotulo="Banco"><div>${esc(liga(g.banco))}${g.banco_chave ? `<span class="com-sub">${esc(g.banco_chave)}</span>` : '<span class="com-sub">sem chave no banco</span>'}${g.banco_por ? `<span class="com-sub">${esc(g.banco_por)}${g.banco_desde ? ' · ' + esc(g.banco_desde.split('-').reverse().join('/')) : ''}</span>` : ''}</div></td>
      <td data-rotulo="Arquivo"><div>${esc(liga(g.arquivo))}${g.arquivo_chave ? `<span class="com-sub">${esc(g.arquivo_chave)}</span>` : '<span class="com-sub">sem chave no arquivo</span>'}</div></td>
      <td data-rotulo="Efeito hoje"><div>${esc(g.efeito ? 'ligado' : 'desligado')}</div></td>
      <td data-rotulo="Situação"><div>${g.conflito ? '<span class="selo atencao">Conflito</span>' : '<span class="selo neutro">Sem conflito</span>'}${g.nota ? `<span class="com-sub">${esc(g.nota)}</span>` : ''}</div></td>
    </tr>`).join('')
  }

  const visiveis = () => {
    const L = st.dados?.faixas?.[st.faixa]?.itens || []
    return st.e === 'historico' ? L.filter(i => i.historico) : st.e === 'todos' ? L.filter(i => !i.historico) : L.filter(i => i.estado === st.e)
  }
  const botao = (it, k) => { if (!it.acao) return ''; ACOES.set(k, it); return `<button class="btn btn-p" type="button" data-acao="${esc(k)}">${esc(it.acao.rotulo)}</button>` }
  const proxima = (it, k) => `${botao(it, k)}${it.falta ? `<span class="com-sub">${esc(it.falta)}</span>` : ''}${it.motivo ? `<span class="com-sub">motivo: ${esc(it.motivo)}</span>` : ''}` || '—'

  function modoLote(L) {
    return `<div class="tabela-wrap"><table class="t empilha">
      <thead><tr><th>Cliente</th><th>Mensagem</th><th>Estágio</th><th>Estado</th><th>Espera desde</th><th>Próxima ação</th></tr></thead>
      <tbody>${L.map((it, n) => `<tr data-id="${esc(it.id)}" data-estado="${esc(it.estado)}">
        <td data-rotulo="Cliente"><div>${esc(it.cliente || '—')}<span class="com-sub">${esc(NOME_SIS[it.sistema] || it.sistema)}</span></div></td>
        <td data-rotulo="Mensagem"><div>${esc(it.mensagem)}${it.marca ? ` <span class="selo neutro">${esc(it.marca)}</span>` : ''}<span class="com-sub">${esc(it.canal || '—')}</span></div></td>
        <td data-rotulo="Estágio"><div>${pontos(it)}<span class="com-sub">${esc(it.estagio || 'nada cumprido')}</span></div></td>
        <td data-rotulo="Estado"><div>${seloEstado(it.estado)}</div></td>
        <td data-rotulo="Espera desde"><div>${dataHora(it.desde)}</div></td>
        <td data-rotulo="Próxima ação"><div class="com-acoes">${proxima(it, 'l' + n)}</div></td>
      </tr>`).join('')}</tbody></table></div>`
  }

  function modoAssistida(L) {
    const grupos = new Map()
    for (const it of L) { const c = it.cliente || 'Sistema (sem cliente)'; if (!grupos.has(c)) grupos.set(c, []); grupos.get(c).push(it) }
    let n = 0
    return [...grupos].map(([c, its]) => {
      const conta = Object.entries(its.reduce((m, i) => (m[i.estado] = (m[i.estado] || 0) + 1, m), {})).map(([e, k]) => `${k} ${ROT[e].toLowerCase()}`).join(' · ')
      return `<details class="com-cli"><summary><b>${esc(c)}</b><span class="com-sub">${esc([...new Set(its.map(i => i.canal).filter(Boolean))].join(' · '))}</span><span>${esc(conta)}</span></summary>
        ${its.map(it => { const k = 'a' + n++; return `<div class="com-msg" data-id="${esc(it.id)}">
          <h3>${esc(it.mensagem)} ${seloEstado(it.estado)}</h3>
          <ol class="com-passos">${it.estagios.map(s => `<li class="${s.s}">${esc(s.nome)}: ${esc(ESTAGIO_S[s.s])}${s.em ? ' ' + dataHora(s.em) : ''}</li>`).join('')}</ol>
          ${it.motivo ? `<p class="com-falta">Motivo: ${esc(it.motivo)}</p>` : ''}
          <p class="com-falta">${it.falta ? 'Falta: ' + esc(it.falta) : 'Nada falta.'}</p>
          ${it.previa ? `<p class="com-previa">Texto ao cliente: ${esc(it.previa)}</p>` : ''}
          ${it.acao ? `<div class="com-acoes">${botao(it, k)}</div>` : ''}
        </div>` }).join('')}
      </details>`
    }).join('')
  }

  function desenhar() {
    const d = st.dados; if (!d) return
    desenharGate(d.gate)
    for (const b of document.querySelectorAll('#comFaixa .f-chip')) { const on = b.dataset.faixa === st.faixa; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); b.querySelector('.n').textContent = d.faixas[b.dataset.faixa]?.contadores.todos ?? '—' }
    const C = d.faixas[st.faixa]?.contadores || {}
    for (const b of document.querySelectorAll('#comEstados .f-chip')) { const on = b.dataset.e === st.e; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); b.querySelector('.n').textContent = C[b.dataset.e] ?? '—' }
    for (const b of document.querySelectorAll('#comModo .f-chip')) { const on = b.dataset.modo === st.modo; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)) }
    ACOES.clear()
    const L = visiveis(), corpo = $('comCorpo'); corpo.removeAttribute('aria-busy')
    corpo.innerHTML = !L.length ? `<div class="vazio-box"><b>Nada em «${esc(st.e === 'historico' ? 'Histórico' : st.e === 'todos' ? 'Todos na fila' : ROT[st.e])}» na faixa ${st.faixa === 'time' ? 'Time' : 'Cliente'}.</b>Troque o estado ou a faixa.</div>`
      : st.modo === 'lote' ? modoLote(L) : modoAssistida(L)
    $('comNota').textContent = `${L.length} ${L.length === 1 ? 'item' : 'itens'} · Cliente ${d.faixas.cliente?.contadores.todos ?? '—'} na fila · Time ${d.faixas.time?.contadores.todos ?? '—'} na fila${d.nao_lidos?.length ? ' · não lidas: ' + d.nao_lidos.join(', ') : ''}`
    $('comLido').textContent = `atualizado às ${hora(d.lido_em)}`
  }

  // ação de um item: o servidor mandou rota e corpo; com previa:true chama sem confirmar, mostra e só então confirma (previa_id/hash da prévia)
  async function agir(it) {
    const a = it?.acao; if (!a) return
    const por = await pedirPor({ titulo: `${a.rotulo}: ${it.cliente}`, texto: a.previa ? 'Primeiro sai uma prévia (nada é gravado nem enviado); você confirma depois de ver.' : `${a.rotulo} grava a liberação com o seu nome: o plano de terça passa a sair para este cliente na próxima janela.`, rotuloOk: a.previa ? 'Ver prévia' : a.rotulo })
    if (!por) return
    try {
      if (!a.previa) { if (!(await confirmar({ titulo: `${a.rotulo}: ${it.cliente}`, texto: 'Confirma a liberação? Ela pode ser revogada na tela do cliente.', rotuloOk: a.rotulo }))) return; await api(a.rota, { ...a.corpo, por }); toast(`${it.cliente}: feito.`); return carregar() }
      const p = await api(a.rota, { ...a.corpo, por, confirmar: false })
      if (p.ok === false) { toast(p.mensagem || p.motivo || 'A prévia recusou: veja a tela do cliente.', 'erro'); return }
      const resumo = p.confirmacao || [p.titulo, typeof p.texto === 'string' ? p.texto.slice(0, 400) : '', p.liberaria ? `Liberaria: ${[].concat(p.liberaria).map(x => x?.cliente || x).join(', ')}` : ''].filter(Boolean).join(' · ') || 'Prévia gerada.'
      if (!(await confirmar({ titulo: `Confirmar: ${a.rotulo} (${it.cliente})`, texto: resumo, rotuloOk: a.rotulo }))) return
      const r = await api(a.rota, { ...a.corpo, por, confirmar: true, ...(p.previa_id ? { previa_id: p.previa_id } : {}), ...(p.hash ? { hash: p.hash } : {}) })
      toast(r.ok === false ? (r.mensagem || r.motivo || 'Não saiu: veja o motivo na fila.') : `${it.cliente}: ${a.rotulo.toLowerCase()} feito.`, r.ok === false ? 'erro' : 'ok')
      carregar()
    } catch (e) { toast(e.message, 'erro') }
  }

  // «Preparar lote (prévia)»: a rota de liberação em lote SEM confirmar (nada gravado). Esta tela nunca manda confirmar:true para ela.
  async function preparar() {
    const por = await pedirPor({ titulo: 'Preparar lote (prévia)', texto: 'Mostra quem a liberação em lote do plano de terça liberaria, quem fica sem grupo do ML e quem fica sem integração. Nada é gravado nem enviado.', rotuloOk: 'Ver prévia' })
    if (!por) return
    const alvo = $('comPrevia')
    try {
      const j = await api('/api/gatilhos/preparar-lote', { por, confirmar: false })
      const n = v => Array.isArray(v) ? v.length : 0, nomes = v => Array.isArray(v) ? v.slice(0, 12).map(x => x?.cliente || x).join(', ') + (v.length > 12 ? '…' : '') : ''
      alvo.hidden = false
      alvo.textContent = j.ok === false ? `Prévia recusada: ${j.motivo || j.mensagem || 'motivo não informado'}.` : `Prévia do lote (nada gravado): liberaria ${n(j.liberados)}${n(j.liberados) ? ' (' + nomes(j.liberados) + ')' : ''} · sem grupo do ML ${n(j.sem_grupo_ml)} · sem integração ML ${n(j.sem_integracao)} · não lidos ${n(j.nao_lidos)}. Para gravar, use Planos › Avisos automáticos.`
    } catch (e) { alvo.hidden = false; alvo.textContent = `Prévia indisponível: ${e.message}` }
  }

  async function carregar() {
    try { st.dados = await api('/api/comunicacao/fila'); desenhar() } catch (e) {
      $('comCorpo').removeAttribute('aria-busy')
      $('comCorpo').innerHTML = `<div class="erro-bloco"><b>Não foi possível carregar</b><div>${esc(e.message)}</div><button class="btn btn-p" type="button" data-denovo>Tentar de novo</button></div>`
      $('comCorpo').querySelector('[data-denovo]').onclick = carregar
      $('comLido').textContent = 'leitura falhou'
    }
  }

  document.addEventListener('click', e => {
    const f = e.target.closest('#comFaixa .f-chip'); if (f) { st.faixa = f.dataset.faixa; return desenhar() }
    const s = e.target.closest('#comEstados .f-chip'); if (s) { st.e = s.dataset.e; return desenhar() }
    const m = e.target.closest('#comModo .f-chip'); if (m) { st.modo = m.dataset.modo; return desenhar() }
    const a = e.target.closest('#comCorpo [data-acao]'); if (a) agir(ACOES.get(a.dataset.acao))
  })
  $('btnComAtualizar').onclick = carregar
  $('btnComPreparar').onclick = preparar
  carregar()
})()
