// Progresso do processo (F4 dos 5 menus, 21/10/2026; docs/ux/arquitetura-5-menus.md § D): um módulo só para o stepper do cliente (cabeçalho do /cliente)
// e o da carteira (/, /estrutura; /fila na F5). window.PSProgresso.montar(el, { cliente }) → GET /api/cliente/progresso?cliente= e preenche o <ol class="passos">;
// montar(el, { escopo }) → GET /api/progresso?tipo=&consultor=&squad=&cliente= e desenha as 3 contagens por etapa, os 10 contadores «parados nesta etapa»,
// «ciclo completo: N de M» e a tabela 1 linha por cliente (5 colunas: Cliente · Etapa · Número · Atraso · Próxima ação), ordenada por atraso, com a linha expansível.
// Devolve a Promise com os dados (cliente.js usa para o #btnRevisar e o «Pronto para operar»; planos.js para os 3 KPIs). 0 primário; valor nunca colorido;
// sem emoji; sem hex. O (i) por passo recebe o id por dataset depois do render (o template nunca usa data-ajuda dinâmico — scripts/teste-ajuda.mjs).
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const fmt = n => Number(n ?? 0).toLocaleString('pt-BR')
  const ROTULO = { feito: 'feito', atual: 'atual', pendente: 'pendente', atrasado: 'atrasado', desligado: 'desligado', aguardando: 'aguardando' }
  const api = async url => { const r = await fetch(url); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.erro || `erro ${r.status}`); return j }
  const erroHtml = e => `<div class="erro-bloco"><b>Não foi possível carregar o progresso</b><div>${esc(e.message)}</div><button class="btn btn-p" type="button" data-denovo>Tentar de novo</button></div>`
  const ligarAjuda = el => { for (const b of el.querySelectorAll('[data-ajuda-id]')) b.dataset.ajuda = b.dataset.ajudaId }   // ids vêm do servidor (ETAPAS[].ajuda, conferidos em config/ajuda.json pelo teste); ajuda.js delega em [data-ajuda]
  const papelFila = () => { try { return window.PS?.quem?.().papel || 'lider' } catch { return 'lider' } }   // «N atrasados» → /fila?por=&etapa= (F5): a fila de quem está usando, filtrada pela etapa
  const qsEscopo = e => { const p = new URLSearchParams(); if (e?.tipo) p.set('tipo', e.tipo); if (e?.consultor) p.set('consultor', e.consultor); if (e?.squad) p.set('squad', e.squad); for (const c of e?.clientes || []) p.append('cliente', c); return p.toString() }

  // li de um passo: estado + «atual» (classes do ui.css), link para a tela que resolve, número neutro, atraso com limiar, (i)
  const passo = (e, { compacto = false } = {}) => `<li class="${esc(e.estado)}${e.atual ? ' atual' : ''}" data-etapa="${e.n}" title="${esc(e.motivo || e.numero || '')}">
    ${e.ir ? `<a href="${esc(e.ir)}">${esc(e.nome)}</a>` : `<span>${esc(e.nome)}</span>`}${compacto ? '' : `<small class="num">${esc(e.numero)}</small>${e.atraso_txt ? `<small class="atraso">${esc(e.atraso_txt)}</small>` : ''}${e.ajuda ? `<button class="btn-icone btn-ajuda" type="button" aria-label="Como fazer: ${esc(e.nome)}" data-ajuda-id="${esc(e.ajuda)}"></button>` : ''}`}
  </li>`

  async function montarCliente(el, cliente) {
    el.setAttribute('aria-busy', 'true')
    try {
      const p = await api('/api/cliente/progresso?cliente=' + encodeURIComponent(cliente))
      el.innerHTML = p.etapas.map(e => passo(e)).join('')
      el.removeAttribute('aria-busy'); ligarAjuda(el)
      return p
    } catch (e) {
      el.removeAttribute('aria-busy'); el.innerHTML = `<li class="pendente">${erroHtml(e)}</li>`
      el.querySelector('[data-denovo]').onclick = () => montarCliente(el, cliente)
      return null
    }
  }

  const linhaCliente = c => `<tr data-cli="${esc(c.cliente)}">
      <td data-rotulo="Cliente"><button type="button" class="nome-btn" data-abrir aria-expanded="false">${esc(c.cliente)}</button><div class="mini">pronto para operar: ${c.pronto} de 8</div></td>
      <td data-rotulo="Etapa"><span class="selo ${c.estado === 'atrasado' ? 'ruim' : c.estado === 'feito' ? 'bom' : c.estado === 'desligado' ? 'neutro' : c.estado === 'aguardando' ? 'azul' : 'atencao'}">${c.etapa ? c.etapa + ' · ' : ''}${esc(c.nome)}</span></td>
      <td data-rotulo="Número">${esc(c.numero)}</td>
      <td data-rotulo="Atraso">${c.atraso_txt ? `${esc(c.atraso_txt)}${c.atraso_etapa && c.atraso_etapa !== c.etapa ? ` <span class="mini">(etapa ${c.atraso_etapa})</span>` : ''}` : '—'}</td>
      <td data-rotulo="Próxima ação">${c.ir ? `<a class="btn btn-p" href="${esc(c.ir)}">${esc(c.acao || 'Abrir')}</a>` : '<span class="mini">ciclo completo</span>'}</td>
    </tr>
    <tr class="prog-detalhe" hidden><td colspan="5"><ol class="passos passos-estatico passos-compacto">${c.etapas.map(e => passo(e, { compacto: true })).join('')}</ol></td></tr>`

  async function montarCarteira(el, escopo) {
    el.setAttribute('aria-busy', 'true')
    try {
      const d = await api('/api/progresso?' + qsEscopo(escopo))
      const tem = d.total > 0
      el.innerHTML = `
        <p class="kpis-sec">Ciclo completo nesta semana <b>${fmt(d.ciclo_completo.n)}</b> de <b>${fmt(d.ciclo_completo.de)}</b> clientes${d.escopo?.sem_quadro ? ` · <b>${fmt(d.escopo.sem_quadro)}</b> ainda sem quadro no Notion (parados em Cadastrado)` : ''} · parado = cliente cuja etapa atual é esta</p>
        <ol class="passos passos-estatico passos-carteira" aria-label="Carteira por etapa">${d.etapas.map(e => `<li class="${e.atrasado ? 'atrasado' : e.feito === d.total && d.total ? 'feito' : 'pendente'}" data-etapa="${e.n}">
          <b>${esc(e.nome)}</b><small class="num">feito ${fmt(e.feito)} · atrasado ${e.atrasado ? `<a href="/fila?por=${esc(papelFila())}&amp;etapa=${e.n}">${fmt(e.atrasado)}</a>` : fmt(e.atrasado)} · desligado ${fmt(e.desligado)}</small><small class="num">parados nesta etapa: ${fmt(e.parados)}</small>
        </li>`).join('')}</ol>
        ${tem ? `<div class="tabela-wrap"><table class="t empilha prog-tabela"><thead><tr><th>Cliente</th><th>Etapa</th><th>Número</th><th>Atraso</th><th>Próxima ação</th></tr></thead>
          <tbody>${d.clientes.slice(0, 30).map(linhaCliente).join('')}</tbody></table></div>
          ${d.clientes.length > 30 ? `<div class="t-pag">1–30 de ${fmt(d.clientes.length)} <button class="btn btn-p" type="button" data-prog-mais>Mostrar todos</button></div>` : ''}` : '<div class="vazio-box"><b>Nenhum cliente no escopo.</b>Escolha outro recorte.</div>'}`
      el.removeAttribute('aria-busy'); ligarAjuda(el)
      el.querySelector('[data-prog-mais]')?.addEventListener('click', ev => { el.querySelector('tbody').innerHTML = d.clientes.map(linhaCliente).join(''); ev.currentTarget.closest('.t-pag').remove() })
      el.addEventListener('click', ev => { const b = ev.target.closest('[data-abrir]'); if (!b || !el.contains(b)) return; const det = b.closest('tr').nextElementSibling; det.hidden = !det.hidden; b.setAttribute('aria-expanded', String(!det.hidden)) })
      return d
    } catch (e) {
      el.removeAttribute('aria-busy'); el.innerHTML = erroHtml(e)
      el.querySelector('[data-denovo]').onclick = () => montarCarteira(el, escopo)
      return null
    }
  }

  const montar = (el, o = {}) => !el ? Promise.resolve(null) : o.cliente ? montarCliente(el, o.cliente) : montarCarteira(el, o.escopo || { tipo: 'total' })
  window.PSProgresso = { montar }
})()
