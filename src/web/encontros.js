// Place Prime no /cliente (docs/desenho-place-prime.md § D): #secEncontros (Resumo), #secTrilha (Plano) e #secNaoExecuta (Pelo cliente).
// Só desenha o que o servidor devolve (GET /api/cliente/encontros e /api/cliente/nao-executa); nada é decidido aqui.
// window.PSEncontros.montar({ encontros, trilha, naoExecuta }, cliente). Botões secundários; o único primário é o Confirmar do diálogo (PSRelatorio.ui).
// Toda escrita é prévia → confirmar:true. «Registrar encontro» cria o card no Notion SÓ no confirmar (distribuição de sempre). Aprovar um passo = «puxar» (mesma rota do plano).
(() => {
  if (window.PSEncontros) return
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const brData = iso => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—'
  const api = async (url, body) => {
    const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.erro || `erro ${r.status}`)
    return j
  }
  const toast = (t, tipo) => window.PS?.toast ? PS.toast(t, tipo) : alert(t)
  const ui = () => window.PSRelatorio?.ui || null
  const erroBloco = (alvo, e, denovo) => { alvo.innerHTML = `<div class="erro-bloco"><b>Não foi possível carregar</b><div>${esc(e.message)}</div><button class="btn btn-p" type="button" data-denovo>Tentar de novo</button></div>`; alvo.querySelector('[data-denovo]').onclick = denovo }
  const ESTADO = { realizado: ['bom', 'realizado'], previsto: ['neutro', 'previsto'], confirmar: ['atencao', 'confirmar com o consultor'], sem_data: ['neutro', 'sem data'], cancelado: ['neutro', 'cancelado'] }
  const ST = { proposta: ['neutro', 'proposto'], aprovada: ['bom', 'puxado'], distribuida: ['bom', 'no Notion'], descartada: ['neutro', 'descartado'] }
  const SITU = { nao_puxado: ['neutro', 'não puxado'], aguardando_sync: ['neutro', 'aguardando o Notion'], no_prazo: ['neutro', 'no prazo'], vencido: ['atencao', 'vencido'], feito_no_prazo: ['bom', 'feito no prazo'], feito_atrasado: ['atencao', 'feito com atraso'], feito_sem_data: ['neutro', 'feito (sem data)'] }
  const FAIXA = { cobrar: 'ruim', revisar: 'ruim', aguardando: 'atencao' }
  const selo = ([c, t]) => `<span class="selo ${c}">${esc(t)}</span>`
  let ultimo = null

  async function montar(alvos, cliente) {
    ultimo = { alvos, cliente }
    const { encontros: aE, trilha: aT, naoExecuta: aN } = alvos
    let p
    try { p = await api('/api/cliente/encontros?cliente=' + encodeURIComponent(cliente)) }
    catch (e) { for (const a of [aE, aT]) if (a) erroBloco(a, e, () => montar(alvos, cliente)); return }
    if (aE) desenharEncontros(aE, p)
    if (aT) desenharTrilha(aT, p)
    if (aN) api('/api/cliente/nao-executa?cliente=' + encodeURIComponent(cliente)).then(r => desenharNaoExecuta(aN, r)).catch(e => erroBloco(aN, e, () => montar(alvos, cliente)))
  }
  const recarregar = () => ultimo && montar(ultimo.alvos, ultimo.cliente)

  function desenharEncontros(alvo, p) {
    const c = p.contagens, tipo = id => p.tipos.find(t => t.id === id)?.nome || 'tipo não marcado'
    alvo.innerHTML = `<p class="veredito-frase"><b>${c.realizados} realizado(s)</b> · ${c.previstos} previsto(s)${c.confirmar ? ` · ${c.confirmar} a confirmar` : ''} · com ata ${c.com_ata} de ${c.realizados} · com o treinado marcado ${c.com_treinado} de ${c.realizados}</p>
      <p class="mini">Próximo encontro: ${c.proximo ? `${brData(c.proximo.data)} (${esc(tipo(c.proximo.tipo))})` : 'nenhum previsto registrado'}${c.ultimo?.treinado?.length ? ` · último treinado: ${esc(c.ultimo.treinado.join(', '))}` : ''}</p>
      <div class="aviso info">${esc(p.calendario.motivo)}</div>
      ${p.encontros.length ? `<div class="tabela-wrap mt-2"><table class="t empilha" id="encTabela"><caption class="sr">Encontros do cliente</caption>
        <thead><tr><th scope="col">Data</th><th scope="col">Encontro</th><th scope="col">Situação</th><th scope="col">Ata · gravação</th><th scope="col">Treinado</th><th scope="col">Registrar</th></tr></thead>
        <tbody>${p.encontros.map(e => `<tr data-enc="${esc(e.id)}"><td>${brData(e.data)}</td>
          <td>${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.titulo)}</a>` : esc(e.titulo)}<div class="mudo">${esc(tipo(e.tipo))}${e.consultor ? ` · ${esc(e.consultor)}` : ''}</div></td>
          <td>${selo(ESTADO[e.estado] || ['neutro', e.estado])}${e.aguardando_sync ? ' <span class="mudo">aguardando o Notion</span>' : ''}</td>
          <td>${e.com_ata ? 'ata no card' : '—'}${e.gravado ? ' · gravado' : ''}${e.transcricao ? ' · transcrição' : ''}</td>
          <td>${e.treinado.length ? esc(e.treinado.map(x => x.nome).join(', ')) : e.sugestao_treinado?.length ? `<span class="mudo">sugestão pela ata: ${esc(e.sugestao_treinado.join(', '))}</span>` : '—'}</td>
          <td>${e.aguardando_sync ? '—' : `<button class="btn-mini" type="button" data-enc-marcar>Marcar</button>${e.estado === 'realizado' ? ' <button class="btn-mini" type="button" data-enc-transcricao>Transcrição</button>' : ''}`}</td></tr>`).join('')}</tbody></table></div>`
        : '<div class="vazio-box"><b>Nenhum card de encontro neste cliente.</b>Os encontros vêm dos cards «Reunião de Alinhamento» do Notion ou do «Registrar encontro».</div>'}
      <button class="btn btn-p mt-2" type="button" id="btnEncRegistrar">Registrar encontro</button>`
    alvo.querySelector('#btnEncRegistrar').onclick = () => registrar(p)
    alvo.querySelectorAll('[data-enc]').forEach(tr => {
      const e = p.encontros.find(x => x.id === tr.dataset.enc)
      tr.querySelector('[data-enc-marcar]')?.addEventListener('click', () => marcar(p, e))
      tr.querySelector('[data-enc-transcricao]')?.addEventListener('click', () => transcricao(p, e))
    })
  }

  // prévia → Confirmar (o único primário da tela fica no diálogo)
  function fluxo(titulo, html, corpoReq, url, { aoPrevia, rotuloConfirmar = 'Confirmar' } = {}) {
    const U = ui(); if (!U) { toast('Recarregue a página: o módulo de diálogos não carregou.', 'erro'); return }
    const { corpo, rodape, fechar } = U.dialogo(titulo)
    corpo.innerHTML = `${html}${U.campoPor('encPor')}<div id="encSaida"></div>`
    const saida = corpo.querySelector('#encSaida')
    const previaBt = U.botao('Ver prévia', { aoClicar: async () => {
      let b
      try { b = { ...(await corpoReq(corpo)), por: U.lerPor(corpo, 'encPor') } } catch (e) { saida.innerHTML = U.aviso('erro', esc(e.message)); return }
      if (!b.por) { saida.innerHTML = U.aviso('erro', 'Informe seu nome.'); return }
      previaBt.disabled = true
      let v
      try { v = await api(url(b), b) } catch (e) { saida.innerHTML = U.aviso('erro', esc(e.message)); previaBt.disabled = false; return }
      U.gravarNome(b.por)
      saida.innerHTML = U.aviso('info', aoPrevia(v))
      previaBt.remove()
      rodape.append(U.botao(rotuloConfirmar, { primario: true, aoClicar: async ev => {
        ev.currentTarget.disabled = true
        try { const r = await api(url(b), { ...b, confirmar: true }); toast(r.distribuicao?.erros?.length ? `Registrado; o Notion respondeu: ${r.distribuicao.erros[0]}` : 'Registrado.', r.distribuicao?.erros?.length ? 'erro' : undefined); fechar(); recarregar() }
        catch (x) { saida.insertAdjacentHTML('beforeend', U.aviso('erro', esc(x.message))); ev.currentTarget.disabled = false }
      } }))
    } })
    rodape.append(U.botao('Cancelar', { aoClicar: fechar }), previaBt)
  }
  const opcoesTipo = (p, atual) => `<option value="">tipo não marcado</option>${p.tipos.map(t => `<option value="${esc(t.id)}"${t.id === atual ? ' selected' : ''}>${esc(t.nome)}</option>`).join('')}`

  function registrar(p) {
    fluxo(`Registrar encontro · ${p.cliente}`, `<p class="mini">Cria o card «Reunião de Alinhamento» no quadro do cliente no Notion com a data do encontro, só depois de você confirmar. O tipo diz qual passo da trilha ele dispara.</p>
      <div class="campo"><label for="encData">Data do encontro</label><input id="encData" type="date" required></div>
      <div class="campo"><label for="encTipo">Tipo</label><select id="encTipo">${p.tipos.map(t => `<option value="${esc(t.id)}">${esc(t.nome)}</option>`).join('')}</select></div>
      <div class="campo"><label for="encCons">Quem conduz (opcional; vazio = consultor da central)</label><input id="encCons" maxlength="80"></div>`,
      c => ({ cliente: p.cliente, data: c.querySelector('#encData').value, tipo: c.querySelector('#encTipo').value, consultor: c.querySelector('#encCons').value.trim() }),
      () => '/api/cliente/encontros/registrar', { aoPrevia: v => `<b>${esc(v.acao.titulo)}</b>${v.acao.consultor ? ` · conduz ${esc(v.acao.consultor)}` : ''}<br>${esc(v.efeito)}`, rotuloConfirmar: 'Confirmar e criar no Notion' })
  }

  function marcar(p, e) {
    const marcados = new Set(e.treinado.length ? e.treinado.map(x => x.processo_id) : e.sugestao_treinado || [])
    fluxo(`Registrar o encontro · ${brData(e.data)}`, `<p class="mini">Grava só neste painel (nada vai ao Notion): o tipo do encontro, quem conduziu, o link da gravação (sem parâmetros) e o que foi treinado, da lista do Manual.${!e.treinado.length && marcados.size ? ' Os processos já marcados são sugestão pela ata: confira.' : ''}</p>
      <div class="campo"><label for="encTipo">Tipo</label><select id="encTipo">${opcoesTipo(p, e.tipo)}</select></div>
      <div class="campo"><label for="encCons">Quem conduziu</label><input id="encCons" maxlength="80" value="${esc(e.consultor)}"></div>
      <div class="campo"><label for="encGrav">Link da gravação (opcional)</label><input id="encGrav" type="url" maxlength="500" value="${esc(e.gravacao_url)}"></div>
      <div class="campo"><label for="encTreino">O que foi treinado (Ctrl/Cmd para vários)</label><select id="encTreino" multiple size="8">${p.processos.map(x => `<option value="${esc(x.id)}"${marcados.has(x.id) ? ' selected' : ''}>${esc(x.id)} · ${esc(x.nome)}</option>`).join('')}</select></div>`,
      c => ({ cliente: p.cliente, tipo: c.querySelector('#encTipo').value, consultor: c.querySelector('#encCons').value.trim(), gravacao_url: c.querySelector('#encGrav').value.trim(), treinado: [...c.querySelector('#encTreino').selectedOptions].map(o => o.value) }),
      () => `/api/cliente/encontros/${encodeURIComponent(e.id)}`, { aoPrevia: v => `Tipo: <b>${esc(p.tipos.find(t => t.id === v.depois.tipo)?.nome || 'não marcado')}</b> · conduziu: ${esc(v.depois.consultor || '—')} · treinado: ${esc(v.depois.treinado.map(x => x.nome).join(', ') || '—')}<br>${esc(v.efeito)}` })
  }

  function transcricao(p, e) {
    fluxo(`Transcrição do encontro · ${brData(e.data)}`, `<p class="mini">Arquivo .txt com a transcrição. Fica guardado fora do banco, identificado pela impressão digital (sha256). Os combinados do lado do cliente viram ações PROPOSTAS no plano, que você aprova ou descarta. ${esc(p.ia)}.</p>
      <div class="campo"><label for="encArq">Arquivo (.txt, até 500 KB)</label><input id="encArq" type="file" accept=".txt,text/plain"></div>
      <label class="campo"><input id="encConsent" type="checkbox"> O cliente consentiu com a gravação e a transcrição deste encontro</label>`,
      async c => {
        const f = c.querySelector('#encArq').files[0]
        if (!f) throw new Error('Escolha o arquivo .txt.')
        if (f.size > 512000) throw new Error('O arquivo passa de 500 KB.')
        return { cliente: p.cliente, texto: await f.text(), consentimento: c.querySelector('#encConsent').checked }
      },
      () => `/api/cliente/encontros/${encodeURIComponent(e.id)}/transcricao`,
      { aoPrevia: v => `${v.bytes.toLocaleString('pt-BR')} bytes · ${v.candidatos.length} combinado(s) do lado do cliente${v.candidatos.length ? `:<ul>${v.candidatos.map(x => `<li>${esc(x.titulo)}</li>`).join('')}</ul>` : '.'}${esc(v.redacao)}.` })
  }

  function desenharTrilha(alvo, p) {
    const passos = p.trilha
    alvo.innerHTML = passos.length ? `<div class="tabela-wrap"><table class="t empilha" id="trilhaTabela"><caption class="sr">Passos da trilha</caption>
      <thead><tr><th scope="col">Passo</th><th scope="col">O que fazer</th><th scope="col">Quem executa</th><th scope="col">Prazo</th><th scope="col">Situação</th><th scope="col">Decisão</th></tr></thead>
      <tbody>${passos.map(a => `<tr data-passo="${esc(a.id)}"><td class="n">${a.passo_n ?? '—'}</td><td>${esc(a.titulo)}</td><td>${a.executor === 'cliente' ? 'o cliente' : 'o consultor'}</td><td>${brData(a.prazo)}</td>
        <td>${selo(ST[a.status] || ['neutro', a.status])}${a.notion_url ? ` <a href="${esc(a.notion_url)}" target="_blank" rel="noopener">Notion</a>` : ''}</td>
        <td>${a.status === 'proposta' ? '<button class="btn-mini ok" type="button" data-puxar>Puxar</button> <button class="btn-mini no" type="button" data-descartar>Descartar</button>' : '—'}</td></tr>`).join('')}</tbody></table></div>
      <p class="mini mt-2">Puxar = aprovar a ação do plano; ela vai ao Notion na distribuição (prévia antes). O prazo conta do encontro que dispara o passo; regerar o plano refaz as datas se o encontro mudar.</p>`
      : `<div class="vazio-box"><b>Nenhum passo da trilha no plano.</b>${p.produto === 'prime' ? 'Os passos nascem na próxima geração do plano, datados a partir do encontro de abertura marcado em Encontros (aba Resumo).' : 'A trilha é do Place Prime.'}</div>`
    alvo.querySelectorAll('[data-passo]').forEach(tr => {
      const id = tr.dataset.passo
      tr.querySelector('[data-puxar]')?.addEventListener('click', async ev => {
        ev.currentTarget.disabled = true
        try { await api('/api/planos/acoes/status', { ids: [id], status: 'aprovada' }); avisar(id, 'aprovada') } catch (e) { toast(e.message, 'erro'); ev.currentTarget.disabled = false }
      })
      tr.querySelector('[data-descartar]')?.addEventListener('click', async ev => {
        ev.currentTarget.disabled = true
        if (await window.PSAlinhamentos?.descartar({ ids: [id] })) avisar(id, 'descartada'); else ev.currentTarget.disabled = false
      })
    })
  }
  // o /cliente atualiza a lista do plano e os contadores (cliente.js escuta ps:acao-status)
  const avisar = (id, status) => { document.dispatchEvent(new CustomEvent('ps:acao-status', { detail: { id, status } })); recarregar() }

  function desenharNaoExecuta(alvo, r) {
    const s = r.resumo, nada = !s.com_executor
    alvo.innerHTML = `<p class="veredito-frase">${nada ? '<b>—</b> nenhuma tarefa com o cliente como executor registrada' : `<b>${s.vencidos} vencida(s)</b> de ${s.com_executor} tarefa(s) do cliente · ${s.vencidos_14} há 14+ dias · ${s.vencidos_30} há 30+ dias · feitas no prazo ${s.pct_no_prazo == null ? '—' : `${s.pct_no_prazo}%`} (${s.feitos_no_prazo} de ${s.feitos})`}</p>
      <p class="mini">${esc(r.cobertura)}${s.nao_puxados ? ` ${s.nao_puxados} passo(s) ainda não puxado(s) pelo consultor.` : ''}</p>
      ${r.itens.length ? `<div class="tabela-wrap mt-2"><table class="t empilha" id="naoExecTabela"><caption class="sr">Tarefas do cliente</caption>
        <thead><tr><th scope="col">Tarefa</th><th scope="col">Prazo</th><th scope="col">Situação</th><th scope="col" class="n">Dias vencida</th></tr></thead>
        <tbody>${r.itens.map(i => `<tr><td>${i.url ? `<a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.titulo)}</a>` : esc(i.titulo)}</td><td>${brData(i.prazo)}</td>
          <td>${selo(SITU[i.estado] || ['neutro', i.estado])}${i.faixa ? ` <span class="selo ${FAIXA[i.faixa] || 'neutro'}">${i.faixa === 'revisar' ? '30+ dias' : i.faixa === 'cobrar' ? '14+ dias' : 'menos de 14 dias'}</span>` : ''}</td><td class="n">${i.dias ?? '—'}</td></tr>`).join('')}</tbody></table></div>` : ''}
      <h3 class="mt-4">Treinado e ainda não feito (30 dias)</h3>
      ${r.treinos_30d ? (r.treinado_nao_feito.length ? `<ul>${r.treinado_nao_feito.map(t => `<li>${esc(t.nome)} <span class="mudo">treinado em ${brData(t.em)}${t.por ? ` por ${esc(t.por)}` : ''}</span></li>`).join('')}</ul>` : '<p class="mini">Tudo o que foi treinado tem tarefa do cliente concluída depois do treino.</p>')
        : '<p class="mini">— nenhum encontro com o treinado marcado nos últimos 30 dias.</p>'}`
  }

  window.PSEncontros = { montar }
})()
