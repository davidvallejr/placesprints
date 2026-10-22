// Estruturas (/estrutura; docs/ux/arquitetura-5-menus.md § A.6, F3 21/10/2026): uma linha por estrutura com o estado REAL (GET /api/estrutura), filtros,
// Ligar/Desligar só nas chaves de banco (reusa as rotas que já existem; nome pelo PSRelatorio.ui.pedirPor, padrão «Quem sou»), (i) por linha e o bloco
// Equipe só-leitura. Tudo que vem do servidor passa por esc(). 0 botão primário; valor de KPI nunca colorido; sem emoji; sem hex. O selo do sistema por
// linha vem de SELO (catálogo fechado, na ordem de config/sistemas.json — scripts/teste-sistemas.mjs confere).
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
  const pedirPor = o => window.PSRelatorio?.ui ? window.PSRelatorio.ui.pedirPor(o) : (toast('Recarregue a página: o módulo de diálogos não carregou.', 'erro'), Promise.resolve(null))
  const brData = iso => /^\d{4}-\d{2}-\d{2}/.test(iso || '') ? iso.slice(0, 10).split('-').reverse().join('/') : esc(iso || '')
  const hora = iso => iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'
  const kp = (rot, v, det) => `<div class="kpi"><div class="rotulo">${rot}</div><div class="valor">${v}</div><div class="detalhe">${det}</div></div>`
  const SELO = {
    trinity: '<span class="sis" data-sistema="trinity" title="Sistema de origem: Trinity">Trinity</span><small class="sis-papel">· coleta</small>',
    arquiteto: '<span class="sis" data-sistema="arquiteto" title="Sistema de origem: Arquiteto">Arquiteto</span><small class="sis-papel">· algoritmo</small>',
    oraculo: '<span class="sis" data-sistema="oraculo" title="Sistema de origem: Oráculo">Oráculo</span><small class="sis-papel">· previsão</small>',
    merovingio: '<span class="sis" data-sistema="merovingio" title="Sistema de origem: Merovíngio">Merovíngio</span><small class="sis-papel">· medição</small>',
    chaveiro: '<span class="sis" data-sistema="chaveiro" title="Sistema de origem: Chaveiro">Chaveiro</span><small class="sis-papel">· execução</small>',
    morpheus: '<span class="sis" data-sistema="morpheus" title="Sistema de origem: Morpheus">Morpheus</span><small class="sis-papel">· comunicação</small>',
    smith: '<span class="sis" data-sistema="smith" title="Sistema de origem: Smith">Smith</span><small class="sis-papel">· financeiro</small>',
    neo: '<span class="sis" data-sistema="neo" title="Sistema de origem: Neo">Neo</span><small class="sis-papel">· autonomia</small>',
  }
  const NOME_SIS = { trinity: 'Trinity', arquiteto: 'Arquiteto', oraculo: 'Oráculo', merovingio: 'Merovíngio', chaveiro: 'Chaveiro', morpheus: 'Morpheus', smith: 'Smith', neo: 'Neo' }
  const ESTADO = { ligado: ['bom', 'Ligado'], pronto: ['azul', 'Pronto'], desligado: ['neutro', 'Desligado'], pendente: ['atencao', 'Pendente'], erro: ['ruim', 'Erro'] }
  const seloEstado = r => { const [cls, rot] = r.tipo === 'freio' ? (r.ligado ? ['atencao', 'Acionado'] : ['neutro', 'Solto']) : (ESTADO[r.estado] || ['neutro', r.estado || '—']); return `<span class="selo ${cls}">${esc(rot)}</span>` }
  const pedeAcao = r => r.estado === 'pendente' || r.estado === 'erro'

  const st = { dados: null, f: 'todas', sis: '' }

  function linha(r) {
    const rotAcao = r.acao ? (r.acao.tipo === 'freio' ? r.acao.rotulos[r.ligado ? 1 : 0] : (r.ligado ? 'Desligar' : 'Ligar')) : ''
    const desde = r.desde ? `${brData(r.desde)}${r.por ? ' · ' + esc(r.por) : ''}` : r.por ? esc(r.por) : r.nasceu ? `<span class="est-sub">${esc(r.nasceu)}</span>` : '—'
    const falta = r.falta?.length ? `<ul>${r.falta.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : '—'
    return `<tr data-id="${esc(r.id)}" data-estado="${esc(r.estado)}" data-sistema="${esc(r.sistema)}">
      <td data-rotulo="Estrutura"><div><b>${esc(r.nome)}</b><span class="est-sub">${esc(r.escopo)}</span><code class="est-chave">${esc(r.chave)}</code></div></td>
      <td data-rotulo="Sistema"><div>${SELO[r.sistema] || esc(r.sistema)}</div></td>
      <td data-rotulo="Estado"><div>${seloEstado(r)}${r.detalhe ? `<span class="est-sub">${esc(r.detalhe)}</span>` : ''}</div></td>
      <td data-rotulo="Desde / por"><div>${desde}</div></td>
      <td data-rotulo="Falta" class="est-falta"><div>${falta}<span class="est-sub">${esc(r.como_mudar)}</span></div></td>
      <td data-rotulo="Ação"><div class="est-acoes">${r.acao ? `<button class="btn btn-p" type="button" data-acao="${esc(r.id)}">${esc(rotAcao)}</button>` : `<a class="btn btn-p btn-fantasma" href="${esc(r.ir)}">Onde</a>`}${r.ajuda ? `<button class="btn-icone btn-ajuda" type="button" aria-label="Como fazer: ${esc(r.nome)}" data-ajuda-id="${esc(r.ajuda)}"></button>` : ''}</div></td>
    </tr>`
  }

  function desenhar() {
    const d = st.dados; if (!d) return
    const L = d.linhas, R = d.resumo, inc = d.incidentes
    const pedem = R.pendentes + R.erros
    $('veredito').innerHTML = `<b>${R.ligadas} de ${R.total}</b> estruturas ligadas · <b>${pedem}</b> ${pedem === 1 ? 'pede' : 'pedem'} ação · ${inc ? `<b>${inc.abertos}</b> incidente${inc.abertos === 1 ? '' : 's'} aberto${inc.abertos === 1 ? '' : 's'}` : 'incidentes: saúde do sistema não lida'}.`
    $('kpis').innerHTML = kp('Ligadas', R.ligadas, `de ${R.total} estruturas`) + kp('Desligadas', R.desligadas + R.prontas, R.prontas ? `${R.prontas} prontas para ligar por esta tela` : 'nenhuma pronta para ligar') + kp('Pedem ação', pedem, `${R.pendentes} pendente${R.pendentes === 1 ? '' : 's'} · ${R.erros} com erro`) + kp('Incidentes abertos', inc ? inc.abertos : '—', inc ? `${inc.criticos} crítico${inc.criticos === 1 ? '' : 's'} · dono Head de canais` : 'saúde do sistema não lida')
    $('kpis').removeAttribute('aria-busy')
    const porCamada = k => L.filter(l => l.camada === k).length
    const sec = $('kpisSec'); sec.hidden = false; sec.innerHTML = `Banco (muda aqui) <b>${porCamada('banco')}</b> · Arquivo <b>${porCamada('arquivo')}</b> · .env <b>${porCamada('env')}</b> · Fora do sistema <b>${porCamada('externo')}</b>${L.some(l => l.reinicio_pendente) ? ` · <b>${L.filter(l => l.reinicio_pendente).length}</b> com reinício pendente` : ''}`
    const conta = { todas: L.length, acao: L.filter(pedeAcao).length, ligado: L.filter(l => l.estado === 'ligado').length, desligado: L.filter(l => l.estado === 'desligado' || l.estado === 'pronto').length }
    for (const b of document.querySelectorAll('.f-chip[data-f]')) { b.querySelector('.n').textContent = conta[b.dataset.f] ?? ''; const on = b.dataset.f === st.f; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)) }
    const sel = $('fSistema'); if (sel.options.length === 1) for (const s of [...new Set(L.map(l => l.sistema))]) sel.append(new Option(NOME_SIS[s] || s, s))
    const vis = L.filter(l => (st.f === 'todas' || (st.f === 'acao' ? pedeAcao(l) : st.f === 'desligado' ? (l.estado === 'desligado' || l.estado === 'pronto') : l.estado === st.f)) && (!st.sis || l.sistema === st.sis))
    const tb = $('tbEstruturas')
    tb.innerHTML = vis.length ? vis.map(linha).join('') : '<tr><td colspan="6"><div class="vazio-box"><b>Nenhuma estrutura neste filtro.</b>Troque o filtro de estado ou de sistema.</div></td></tr>'
    for (const b of tb.querySelectorAll('[data-ajuda-id]')) b.dataset.ajuda = b.dataset.ajudaId   // ids vêm do servidor (scripts/teste-estrutura.mjs confere cada um em config/ajuda.json); ajuda.js delega em [data-ajuda]
    for (const b of tb.querySelectorAll('[data-acao]')) b.onclick = () => acionar(L.find(l => l.id === b.dataset.acao))
    $('estNota').textContent = `${vis.length} de ${L.length} estruturas${inc?.itens?.length ? ' · incidentes abertos: ' + inc.itens.map(i => `${i.rotulo} (${i.nivel})`).join('; ') : ''}`
    $('estLido').textContent = `lido às ${hora(d.lido_em)}`
    desenharEquipe(d.equipe)
  }

  function desenharEquipe(e) {
    const alvo = $('eqCorpo'); alvo.removeAttribute('aria-busy')
    if (!e) { alvo.innerHTML = '<div class="vazio-box"><b>Equipe não lida.</b>config/equipe.json não pôde ser lido agora.</div>'; return }
    const lista = (itens, vazio) => itens?.length ? `<ul>${itens.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : `<p class="mini">${esc(vazio)}</p>`
    const cartao = (t, html) => `<div class="cartao"><h3>${t}</h3>${html}</div>`
    alvo.innerHTML = `<div class="est-grade">
      ${cartao('Quem pode aprovar, liberar e enviar', lista(e.quem_pode, 'ninguém resolvido: consultores e líderes da central do Notion + prestadores com cargo de liderança') + `<p class="mini">${e.quem_pode?.length || 0} pessoas · dono passa em toda validação</p>`)}
      ${cartao('Donos', lista(e.donos, 'nenhum dono em config/equipe.json'))}
      ${cartao('Squads', e.squads?.length ? `<ul>${e.squads.map(s => `<li><b>${esc(s.nome)}</b>${s.lider ? ' · líder ' + esc(s.lider) : ''}${s.consultores?.length ? ' · ' + s.consultores.map(esc).join(', ') : ''}</li>`).join('')}</ul>` : '<p class="mini">sem squads declarados: squad = líder do canal («Squad Nome»)</p>')}
      ${cartao('Nomes unificados (aliases)', e.aliases?.length ? `<ul>${e.aliases.map(a => `<li>${esc(a.de)} → ${esc(a.para)}</li>`).join('')}</ul>` : '<p class="mini">nenhum alias</p>')}
      ${cartao('Analistas oficiais', `<p class="mini">cargos: ${e.analistas_oficiais?.cargos?.length ? e.analistas_oficiais.cargos.map(esc).join(', ') : '—'} · incluir ${e.analistas_oficiais?.incluir?.length || 0} · excluir ${e.analistas_oficiais?.excluir?.length || 0}</p><p class="mini">status de cliente fora: ${(e.status_cliente_excluidos || []).map(esc).join(', ') || '—'}</p>`)}
      ${cartao('Discord do time', lista(e.discord?.cargos, 'nenhum cargo em config/discord-time.json') + `<p class="mini">canal «${esc(e.discord?.canal || '—')}»${e.discord?.marcar_consultor ? ' · marca também o consultor do cliente' : ''} · canal interno, nunca ao cliente</p>`)}
    </div>`
  }

  async function acionar(r) {
    if (!r?.acao) return
    const freio = r.acao.tipo === 'freio', ligar = !r.ligado
    const rot = freio ? r.acao.rotulos[ligar ? 0 : 1] : (ligar ? 'Ligar' : 'Desligar')
    const texto = freio
      ? (ligar ? `Aciona «${r.nome}»: nenhuma escrita sai e as ordens na fila são canceladas. O que já foi enviado só é conferido.` : `Solta «${r.nome}»: as travas por operação, por cliente e a estreia continuam valendo.`)
      : (ligar ? `Liga «${r.nome}». Só sai para quem um líder liberou; o auditor de texto continua antes de qualquer envio.` : `Desliga «${r.nome}». Nada sai até ligar de novo; o que já saiu não é desfeito.`)
    const por = await pedirPor({ titulo: `${rot}: ${r.nome}`, texto, rotuloOk: rot }); if (!por) return
    try {
      await api(ligar ? r.acao.ligar : r.acao.desligar, freio ? { por, confirmar: true } : { ligado: ligar, por })
      toast(`${r.nome}: ${freio ? (ligar ? 'acionado' : 'solto') : (ligar ? 'ligado' : 'desligado')}.`)
      carregar()
    } catch (e) { toast(e.message, 'erro') }
  }

  async function carregar() {
    try { st.dados = await api('/api/estrutura'); desenhar() } catch (e) {
      $('tbEstruturas').innerHTML = `<tr><td colspan="6"><div class="erro-bloco"><b>Não foi possível carregar</b><div>${esc(e.message)}</div><button class="btn btn-p" type="button" data-denovo>Tentar de novo</button></div></td></tr>`
      $('tbEstruturas').querySelector('[data-denovo]').onclick = carregar
      $('veredito').textContent = 'Não foi possível ler o estado das estruturas agora.'; $('kpis').removeAttribute('aria-busy')
    }
  }

  document.addEventListener('click', e => { const b = e.target.closest('.f-chip[data-f]'); if (b) { st.f = b.dataset.f; desenhar() } })
  $('fSistema').addEventListener('change', () => { st.sis = $('fSistema').value; desenhar() })
  $('btnEstAtualizar').onclick = carregar
  carregar()
})()
