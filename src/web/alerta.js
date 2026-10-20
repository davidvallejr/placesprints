// Avisos do sistema em TODAS as telas: sino com contador, faixa na tela, SOM e notificação do navegador quando algo importante acontece
// (cliente conectou o Mercado Livre, dados prontos, vínculo caiu, prospect conectou). Consulta /api/notificacoes a cada 8 s.
// Só texto: tudo passa por textContent (nenhum dado do servidor vira HTML). Autoplay de som exige um clique uma vez na página.
(() => {
  if (window.__psAlerta) return
  window.__psAlerta = true
  const INTERVALO = 8000
  const guarda = {
    ler: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v } catch { return d } },
    gravar: (k, v) => { try { localStorage.setItem(k, v) } catch { /* sem armazenamento: só não lembra a preferência */ } },
  }
  let ultimo = null, somLigado = guarda.ler('ps_alerta_som', '1') === '1', ctx = null, painelAberto = false, naoLidas = 0, historico = []
  const canal = 'BroadcastChannel' in window ? new BroadcastChannel('ps_alerta') : null
  const jaTocou = new Set()

  const css = document.createElement('style')
  css.textContent = `
  #psSino{position:fixed;right:18px;bottom:18px;z-index:9998;font:600 13px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
  #psSino button.sino{display:flex;align-items:center;gap:8px;background:#222;color:#fff;border:0;border-radius:999px;padding:11px 16px;box-shadow:0 6px 22px rgba(0,0,0,.28);cursor:pointer}
  #psSino .cont{background:#ff6b1a;color:#fff;border-radius:999px;min-width:20px;padding:1px 6px;font-size:12px;text-align:center}
  #psSino .cont[hidden]{display:none}
  #psPainel{position:absolute;right:0;bottom:52px;width:min(380px,92vw);max-height:60vh;overflow:auto;background:#fff;color:#222;border:1px solid #ebebeb;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.25);padding:10px}
  #psPainel[hidden]{display:none}
  #psPainel .topo{display:flex;gap:8px;align-items:center;justify-content:space-between;padding:4px 6px 10px;border-bottom:1px solid #ebebeb;margin-bottom:6px;flex-wrap:wrap}
  #psPainel button.mini{border:1px solid #ebebeb;background:#fff;border-radius:9px;padding:5px 10px;font:600 12px inherit;cursor:pointer}
  .psItem{padding:9px 8px;border-radius:10px;font-weight:400;font-size:13px;line-height:1.35;border-left:4px solid #b0b0b0;margin:6px 0;background:#fafafa}
  .psItem b{display:block;font-weight:700}.psItem small{color:#717171;display:block;margin-top:2px}
  .psItem.sucesso{border-left-color:#008a05;background:#e8f6e9}.psItem.alerta{border-left-color:#b45309;background:#fef3e2}.psItem.erro{border-left-color:#c13515;background:#fdeae3}
  .psItem.nova{outline:2px solid #ff6b1a}
  .psItem a{color:#e55600;font-weight:700;text-decoration:none}
  #psToasts{position:fixed;right:18px;bottom:78px;z-index:9999;display:flex;flex-direction:column;gap:10px;max-width:min(380px,92vw)}
  .psToast{background:#222;color:#fff;border-radius:14px;padding:12px 14px;box-shadow:0 10px 30px rgba(0,0,0,.35);border-left:6px solid #ff6b1a;font:400 13.5px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;animation:psEntra .25s ease-out}
  .psToast.sucesso{border-left-color:#2fb344}.psToast.erro{border-left-color:#e5483a}.psToast.alerta{border-left-color:#f0a020}
  .psToast b{display:block;font-size:14.5px;margin-bottom:3px}.psToast a{color:#ffb27d;font-weight:700;text-decoration:none}
  .psToast .fechar{float:right;background:none;border:0;color:#bbb;font-size:18px;line-height:1;cursor:pointer;margin:-4px -4px 0 8px}
  @keyframes psEntra{from{transform:translateY(12px);opacity:0}to{transform:none;opacity:1}}
  @media print{#psSino,#psToasts{display:none!important}}`
  document.head.appendChild(css)

  const raiz = document.createElement('div')
  raiz.id = 'psSino'
  raiz.innerHTML = '<div id="psPainel" hidden></div><button class="sino" type="button" aria-label="Avisos do sistema"><span class="ico">🔔</span><span>Avisos</span><span class="cont" hidden>0</span></button>'
  const toasts = document.createElement('div'); toasts.id = 'psToasts'; toasts.setAttribute('aria-live', 'polite')
  document.body.append(toasts, raiz)
  const painel = raiz.querySelector('#psPainel'), botao = raiz.querySelector('button.sino'), cont = raiz.querySelector('.cont')

  const el = (tag, props = {}, ...filhos) => { const e = document.createElement(tag); Object.assign(e, props); e.append(...filhos); return e }
  const hora = iso => { try { return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) } catch { return '' } }
  const linkSeguro = l => /^\/(?![\/\\])[^\s\\]*$/.test(l || '') ? l : ''

  // ── som: dois toques curtos gerados no navegador (sem arquivo de áudio) ──
  function tocar(nivel) {
    if (!somLigado) return
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)()
      if (ctx.state === 'suspended') ctx.resume()
      const notas = nivel === 'erro' ? [440, 330, 440] : [660, 880]
      notas.forEach((f, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + i * 0.22
        o.type = 'sine'; o.frequency.value = f
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2)
        o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.22)
      })
    } catch { /* navegador bloqueou o áudio: a faixa e a notificação continuam */ }
  }
  const destravarSom = () => { try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === 'suspended') ctx.resume() } catch { /* sem áudio */ } }
  document.addEventListener('click', destravarSom, { once: true })

  function toast(n) {
    const t = el('div', { className: 'psToast ' + n.nivel, role: 'status' })
    const x = el('button', { className: 'fechar', type: 'button', title: 'Fechar', textContent: '×' }); x.onclick = () => t.remove()
    t.append(x, el('b', { textContent: n.titulo }))
    if (n.corpo) t.append(document.createTextNode(n.corpo))
    const l = linkSeguro(n.link); if (l) { t.append(document.createElement('br'), el('a', { href: l, textContent: 'Abrir →' })) }
    toasts.append(t)
    while (toasts.children.length > 4) toasts.firstChild.remove()     // 30 contas caindo não empilham 30 faixas: ficam as 4 mais novas (todas seguem no sino)
    setTimeout(() => t.remove(), n.nivel === 'erro' ? 120000 : 20000)   // erro fica 2 min (ou até alguém fechar)
  }
  function notificacaoNavegador(n) {
    try { if ('Notification' in window && Notification.permission === 'granted') new Notification(n.titulo, { body: n.corpo || '', tag: 'ps-' + n.id }) } catch { /* sem notificação do sistema */ }
  }

  function desenharPainel(novosIds = new Set()) {
    painel.replaceChildren()
    const topo = el('div', { className: 'topo' })
    const som = el('button', { className: 'mini', type: 'button', textContent: somLigado ? '🔊 Som ligado' : '🔇 Som desligado' })
    som.onclick = () => { somLigado = !somLigado; guarda.gravar('ps_alerta_som', somLigado ? '1' : '0'); destravarSom(); if (somLigado) tocar('sucesso'); desenharPainel() }
    const lidas = el('button', { className: 'mini', type: 'button', textContent: 'Marcar todas como lidas' })
    lidas.onclick = async () => { try { await fetch('/api/notificacoes/lidas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); naoLidas = 0; historico.forEach(h => h.lida_em = h.lida_em || 'x'); atualizarContador(); desenharPainel() } catch { /* tenta de novo no próximo clique */ } }
    topo.append(som, lidas)
    if ('Notification' in window && Notification.permission === 'default') {
      const perm = el('button', { className: 'mini', type: 'button', textContent: 'Ativar avisos do navegador' }); perm.onclick = () => Notification.requestPermission().then(() => desenharPainel()); topo.append(perm)
    }
    painel.append(topo)
    if (!historico.length) painel.append(el('div', { className: 'psItem', textContent: 'Nenhum aviso ainda. Quando um cliente conectar a conta do Mercado Livre, você é avisado aqui, com som.' }))
    for (const n of [...historico].reverse()) {
      const it = el('div', { className: `psItem ${n.nivel}${novosIds.has(n.id) ? ' nova' : ''}` }, el('b', { textContent: n.titulo }))
      if (n.corpo) it.append(document.createTextNode(n.corpo))
      const l = linkSeguro(n.link)
      it.append(el('small', { textContent: hora(n.criado_em) }))
      if (l) it.append(el('a', { href: l, textContent: 'Abrir →' }))
      painel.append(it)
    }
  }
  function atualizarContador() {
    cont.hidden = naoLidas <= 0; cont.textContent = naoLidas > 99 ? '99+' : String(naoLidas)
    const base = document.title.replace(/^\(\d+\) /, ''); document.title = naoLidas > 0 ? `(${naoLidas}) ${base}` : base
  }
  botao.onclick = () => { painelAberto = !painelAberto; painel.hidden = !painelAberto; destravarSom(); if (painelAberto) desenharPainel() }
  document.addEventListener('click', e => { if (painelAberto && !raiz.contains(e.target)) { painelAberto = false; painel.hidden = true } })

  canal?.addEventListener('message', e => { if (e.data?.id) jaTocou.add(e.data.id) })   // outra aba já avisou: esta não repete o som

  async function consultar() {
    try {
      const r = await fetch('/api/notificacoes?limite=100&desde=' + (ultimo ?? 0))
      if (!r.ok) return
      const d = await r.json()
      if (ultimo === null) {                                      // 1ª consulta: mostra o que existe no sino, sem tocar nada antigo
        historico = d.itens.slice(-30); ultimo = d.ultimo_id; naoLidas = d.nao_lidas; atualizarContador(); return
      }
      naoLidas = d.nao_lidas
      const novas = d.itens.filter(n => n.id > ultimo)
      if (novas.length) {
        ultimo = d.ultimo_id
        historico = [...historico, ...novas].slice(-30)
        const tocarAgora = novas.filter(n => !jaTocou.has(n.id))
        for (const n of novas) { toast(n); if (!jaTocou.has(n.id)) notificacaoNavegador(n) }
        if (tocarAgora.length) { tocar(tocarAgora.some(n => n.nivel === 'erro') ? 'erro' : 'sucesso'); for (const n of tocarAgora) canal?.postMessage({ id: n.id }) }
        if (painelAberto) desenharPainel(new Set(novas.map(n => n.id)))
      }
      atualizarContador()
    } catch { /* servidor reiniciando ou sem rede: tenta de novo no próximo ciclo */ }
  }
  consultar()
  setInterval(consultar, INTERVALO)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) consultar() })
})()
