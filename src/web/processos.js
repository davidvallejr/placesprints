// Tela de processos: MAPA por canal (passo a passo do Manual do Analista) agrupado pelas 6 etapas do plano, e playbook da duplicação estratégica.
const $ = id => document.getElementById(id)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const lista = a => `<ul>${(a || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul>`
const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`
// nome curto da etapa (= tipo da tarefa); o rótulo completo da API vai no .sub da seção
const CURTO = { saude: 'Saúde da conta', disponibilidade: 'Disponibilidade', cadastro: 'Cadastros e duplicações', otimizacao: 'Otimização de anúncios', trafego_promocao: 'Tráfego pago e promoções', expansao: 'Expansão de catálogo' }
let dados = null, aba = 'ML'

// url do processo completo (passos, evidência, critério, roteiro) para pessoa ou máquina: GET /api/processos/6.1?canal=ML
const urlJSON = e => `/api/processos/${encodeURIComponent(e.processo)}?canal=${encodeURIComponent(e.canal)}`
function cartao(e) {
  const passos = e.bloco?.passos || []
  const txt = [e.nome, e.demanda, e.nome_manual, e.descricao, e.criterio, e.bloco?.caminho, ...passos.map(p => p.titulo + ' ' + (p.texto || '')), ...(e.evidencia || [])].join(' ').toLowerCase()
  const ol = ps => `<ol>${ps.map(p => `<li><b>${esc(p.titulo)}</b>${p.texto ? ` <small>${esc(p.texto)}</small>` : ''}</li>`).join('')}</ol>`
  const extra = e.fonte === 'manual'
  return `<details class="cart" data-txt="${esc(txt)}"><summary><b>${esc(e.nome)}</b>
      ${e.tipo ? `<span class="tg t">${esc(CURTO[e.tipo] || e.tipo)}</span>` : ''}${e.duplicacao ? '<span class="tg d">duplicação</span>' : ''}${e.dependencias?.length ? '<span class="tg">depende do cliente</span>' : ''}${extra ? '<span class="tg">fora do MAPA</span>' : ''}</summary>
    <div class="corpo">
      ${e.erro ? `<div class="aviso">${esc(e.erro)}</div>` : ''}
      <h5>Concluída quando</h5><div class="ok">${esc(e.criterio)}</div>
      <h5>Evidência a registrar no card</h5>${lista(e.evidencia)}
      ${e.descricao ? `<h5>O que é esta tarefa</h5><p>${esc(e.descricao)}</p>` : ''}
      ${e.bloco?.caminho ? `<h5>Caminho</h5><div class="cam">${esc(e.bloco.caminho)}</div>` : ''}
      ${passos.length ? `<h5>Passo a passo${e.bloco?.titulo ? ` · ${esc(e.bloco.titulo)}` : ''}</h5>${ol(passos)}` : '<div class="aviso">O Manual não traz passo a passo para este canal: a tarefa vai ao Notion só com evidência e critério.</div>'}
      ${e.atencao?.length ? `<h5>Atenção</h5>${lista(e.atencao)}` : ''}
      ${e.dependencias?.length ? `<h5>Depende do cliente</h5>${lista(e.dependencias)}` : ''}
      ${e.outros_blocos?.length ? `<h5>Outras variações</h5>${e.outros_blocos.map(b => `<details class="evid"><summary>${esc(b.titulo)}</summary>${ol(b.passos || [])}</details>`).join('')}` : ''}
      <p class="peq mudo mt-4">Manual ${esc(e.processo)} · Demanda no Notion: ${esc(e.demanda)}${e.prazo ? ` · prazo de referência: ${esc(e.prazo)}` : ''}</p>
      <p class="linha mt-2"><button class="btn btn-p" type="button" data-json="${esc(urlJSON(e))}">Copiar JSON (automação)</button><a class="peq mudo" href="${esc(urlJSON(e))}" target="_blank" rel="noopener">ver JSON</a></p>
    </div></details>`
}
// copia o processo completo como JSON: área de transferência, com seleção num textarea quando o navegador não deixa
async function copiarJSON(b) {
  const rotulo = 'Copiar JSON (automação)'
  b.disabled = true; b.textContent = 'Copiando…'
  try {
    const r = await fetch(b.dataset.json); if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const txt = JSON.stringify(await r.json(), null, 2)
    try { await navigator.clipboard.writeText(txt) } catch {
      const ta = document.body.appendChild(Object.assign(document.createElement('textarea'), { value: txt, className: 'sr' }))
      ta.select(); const ok = document.execCommand('copy'); ta.remove()
      if (!ok) throw new Error('o navegador não deixou copiar')
    }
    b.textContent = 'Copiado'
  } catch (e) {
    b.textContent = rotulo; window.PS?.toast?.(`Não deu para copiar (${e.message}). Abra "ver JSON" e copie à mão.`, 'erro'); return
  } finally { b.disabled = false }
  setTimeout(() => { b.textContent = rotulo }, 1500)
}
function viewCanal() {
  const itens = dados.mapa[aba] || [], extras = dados.extras?.[aba] || []
  const secoes = !itens.length ? `<div class="vazio-box"><b>Nenhuma tarefa do MAPA para ${esc(dados.canais[aba])}.</b>Escolha outro canal acima.</div>` : [...(dados.sequencia || [])].sort((a, b) => a.ordem - b.ordem).map(s => {
    const ts = itens.filter(e => e.sequencia === s.ordem)
    const curto = CURTO[s.k] || s.rotulo || s.k
    return `<section class="bloco" data-etapa="${esc(s.k)}">
      <div class="bloco-cab"><h2>${s.ordem}. ${esc(curto)}</h2><span class="mudo peq">${ts.length ? plural(ts.length, 'tarefa', 'tarefas') : 'sem tarefas neste canal'}</span></div>
      ${s.rotulo && s.rotulo !== curto ? `<p class="sub">${esc(s.rotulo)}</p>` : ''}
      ${ts.map(cartao).join('')}</section>`
  }).join('')
  // processos do Manual com passo a passo neste canal que não estão no MAPA: entram na busca e servem de roteiro quando a demanda não casa com o MAPA
  const secExtras = extras.length ? `<details class="recolhido" id="secExtras"><summary>Outros processos do Manual com passo a passo <span class="n">${extras.length}</span></summary>
      <div><p class="sub">Têm roteiro no Manual para ${esc(dados.canais[aba])} mas não estão no MAPA de tarefas. O card só recebe um destes quando a demanda não casa com nenhum item do MAPA.</p>${extras.map(cartao).join('')}</div></details>` : ''
  return `<p class="sub">${plural(itens.length, 'tarefa', 'tarefas')} do MAPA de ${esc(dados.canais[aba])}, na ordem do plano: cadastros e duplicações vêm antes das otimizações.${extras.length ? ` Mais ${plural(extras.length, 'processo extra', 'processos extras')} do Manual no fim da lista.` : ''}</p>
    <div id="lista">${secoes}${secExtras}<div class="vazio-box" id="buscaVazia" hidden><b>Nenhuma tarefa com esse termo neste canal.</b>Tente outra palavra ou troque de canal.<br><button class="btn" type="button" id="limparBusca">Limpar busca</button></div></div>`
}
function viewDuplicacao() {
  const d = dados.duplicacao || {}
  const tipoNome = Object.fromEntries((d.tipos || []).map(t => [t.id, t.nome]))
  const blocos = [['gatilhos', 'Quando duplicar'], ['tipos', 'Tipos e volume'], ['urgencia', 'Urgência oculta'], ['papeis', 'Quem faz o quê'], ['erros', 'Erros comuns'], ['checklist', 'Checklist']]
  const cab = (id, h2, sub) => `<div class="bloco-cab"><h2 id="dup-${id}">${h2}</h2></div>${sub ? `<p class="sub">${sub}</p>` : ''}`
  return `<div class="cart">
      <p class="forte">${esc(d.definicao)}</p>
      ${d.o_que_varia?.length ? `<p class="linha mt-2"><span class="mudo peq">O que varia:</span>${d.o_que_varia.map(v => `<span class="tg">${esc(v)}</span>`).join('')}</p>` : ''}
      <div class="aviso"><b>Regra de ouro:</b> ${esc(d.regra_de_ouro)}</div>
      ${d.primeira_pagina?.meta ? `<p class="mt-2"><b>Meta da 1ª página:</b> ${esc(d.primeira_pagina.meta)}.</p>` : ''}
    </div>
    <nav class="linha mt-4" aria-label="Seções do playbook">${blocos.map(([id, r]) => `<a class="btn btn-fantasma btn-p" href="#dup-${id}">${r}</a>`).join('')}</nav>
    <section class="bloco">${cab('gatilhos', 'Quando duplicar', `${plural((d.gatilhos || []).length, 'gatilho', 'gatilhos')}: o sistema detecta uns pelos dados; os outros exigem pesquisa do consultor.`)}
      <div class="gat">${(d.gatilhos || []).map(g => `<div class="cart"><h4>${esc(g.id)} · ${esc(g.nome)}</h4><p>${esc(g.descricao)}</p><p class="linha mt-2"><span class="tg t">${esc(tipoNome[g.tipo_sugerido] || g.tipo_sugerido)}</span><span class="tg">${g.verificavel_por_dados ? 'o sistema detecta pelos dados' : 'exige pesquisa do consultor'}</span></p></div>`).join('')}</div></section>
    <section class="bloco">${cab('tipos', 'Tipos e volume', 'Quantos anúncios criar em cada tipo de duplicação.')}
      <div class="gat">${(d.tipos || []).map(t => `<div class="cart"><h4>${esc(t.nome)}</h4><p>${esc(t.volume?.texto)}</p></div>`).join('')}</div></section>
    <section class="bloco">${cab('urgencia', 'Urgência oculta')}
      <div class="cart"><p>${esc(d.urgencia_oculta?.o_que_e)}</p><div class="aviso">${esc(d.urgencia_oculta?.regra)}</div><p class="mudo mt-2">Exemplo: ${esc(d.urgencia_oculta?.exemplo)}</p></div></section>
    <section class="bloco">${cab('papeis', 'Quem faz o quê')}
      <div class="grade"><div class="cart"><h4>Consultor</h4>${lista(d.papeis?.consultor)}</div><div class="cart"><h4>Analista</h4>${lista(d.papeis?.analista)}</div></div></section>
    <section class="bloco">${cab('erros', 'Erros comuns')}
      <div class="gat">${(d.erros_comuns || []).map(e => `<div class="cart"><h4>${esc(e.nome)}</h4><p>${esc(e.texto)}</p></div>`).join('')}</div></section>
    <section class="bloco">${cab('checklist', 'Checklist', 'Antes de executar, cada papel confere a sua lista.')}
      <div class="grade"><div class="cart"><h4>Consultor</h4>${lista(d.checklist?.consultor)}</div><div class="cart"><h4>Analista</h4>${lista(d.checklist?.analista)}</div></div></section>
    <p class="nota mt-4">O que o sistema aprendeu com as duplicações já feitas (por objetivo, volume e aderência ao método, com a canibalização do original) aparece na tela de cada cliente, em "Duplicação estratégica". <a href="/cliente">Abrir a tela do cliente</a></p>`
}
function filtrar() {
  const q = $('busca').value.trim().toLowerCase()
  const carts = document.querySelectorAll('#lista .cart')
  carts.forEach(c => { c.hidden = !!q && !c.dataset.txt.includes(q) })
  document.querySelectorAll('#lista section, #lista details.recolhido').forEach(s => { s.hidden = !!q && !s.querySelector('.cart:not([hidden])') })
  const ex = $('secExtras'); if (ex && q && !ex.hidden) ex.open = true   // acerto nos extras abre a seção para o resultado aparecer
  const vazio = $('buscaVazia'); if (vazio) vazio.hidden = !q || ![...carts].every(c => c.hidden)
}
function desenhar() {
  document.querySelectorAll('#abas button').forEach(b => { const on = b.dataset.a === aba; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on) })
  $('campoBusca').hidden = aba === 'DUP'
  $('conteudo').innerHTML = aba === 'DUP' ? viewDuplicacao() : viewCanal()
  $('conteudo').onclick = e => { const b = e.target.closest('button[data-json]'); if (b) copiarJSON(b) }
  const busca = $('busca')
  if (busca && aba !== 'DUP') { busca.oninput = filtrar; filtrar(); const l = $('limparBusca'); if (l) l.onclick = () => { busca.value = ''; filtrar(); busca.focus() } }
}
function regras(r) {
  const R = [['sequencia', 'Ordem do plano'], ['movimentar_diariamente', 'Movimentação diária'], ['responsavel', 'Responsável único'], ['prazos', 'Prazos'], ['criterio_conclusao', 'Critério de conclusão'], ['evidencia', 'Evidência'], ['nome_do_arquivo', 'Nome do arquivo'], ['registro', 'Registro']]
  const corpo = v => Array.isArray(v) ? lista(v.map(x => x?.texto ?? x)) : (typeof v === 'string' && /^[\w-]+$/.test(v) ? `<p><code>${esc(v)}</code></p>` : `<p>${esc(v)}</p>`)
  $('regras').innerHTML = R.filter(([k]) => r[k]).map(([k, t]) => `<div class="cartao"><h3>${t}</h3>${corpo(r[k])}</div>`).join('')
  $('secRegras').querySelector('.n').textContent = R.filter(([k]) => r[k]).length
  $('secRegras').hidden = false
}
function carregar() {
  const c = $('conteudo')
  c.setAttribute('aria-busy', 'true')
  fetch('/api/processos').then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() }).then(d => {
    if (d.erro) throw new Error(d.erro)
    dados = d
    const canais = Object.keys(d.mapa).sort((a, b) => (a === 'ML' ? -1 : b === 'ML' ? 1 : 0))   // Mercado Livre primeiro
    const todas = canais.flatMap(k => d.mapa[k]), nExtras = canais.reduce((n, k) => n + (d.extras?.[k]?.length || 0), 0)
    $('meta').replaceChildren(...[`${plural(todas.length, 'tarefa', 'tarefas')} do MAPA em ${plural(canais.length, 'canal', 'canais')}`, `${plural(nExtras, 'processo extra', 'processos extras')} do Manual`, `${todas.filter(e => e.dependencias?.length).length} dependem do cliente`, `${todas.filter(e => e.duplicacao).length} de duplicação`]
      .map(t => Object.assign(document.createElement('span'), { textContent: t })))
    $('abas').innerHTML = canais.map(k => `<button type="button" data-a="${esc(k)}">${esc(d.canais[k])} <span class="tg">${d.mapa[k].length}</span></button>`).join('') + '<span class="sep" aria-hidden="true"></span><button type="button" data-a="DUP">Duplicação estratégica</button>'
    $('abas').onclick = e => { const b = e.target.closest('button'); if (b) { aba = b.dataset.a; desenhar() } }
    $('abas').hidden = false
    aba = canais.includes('ML') ? 'ML' : canais[0]
    regras(d.regras_gerais || {})
    c.removeAttribute('aria-busy')
    desenhar()
  }).catch(e => {
    c.removeAttribute('aria-busy')
    c.innerHTML = `<div class="erro-bloco"><b>Não foi possível carregar</b>Os processos não vieram do servidor. Tente de novo em instantes.<br><button class="btn" type="button" id="tentar">Tentar de novo</button><details><summary>Detalhe técnico</summary><pre>${esc(e.message)}</pre></details></div>`
    $('tentar').onclick = carregar
  })
}
carregar()
