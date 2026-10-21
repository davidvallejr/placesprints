// Integrações: quem está conectado ao Mercado Livre, quem caiu e o que fazer agora (docs/ux/sistema-de-design.md, 7.11).
const $ = id => document.getElementById(id)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const api = async (url, body) => {
  const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.erro || 'erro ' + r.status)
  return j
}
// toast e confirmação do shell, com fallback nativo se o shell não carregou
const toast = (t, tipo = 'ok') => (window.PS?.toast ?? (x => alert(x)))(t, tipo)
const confirmar = o => (window.PS?.confirmar ?? (x => Promise.resolve(confirm(x.titulo))))(o)
const fmtInt = n => Number(n).toLocaleString('pt-BR')
const plural = (n, um, varios) => `${fmtInt(n)} ${n === 1 ? um : varios}`

const ativo = c => !['Desligado', 'Processo de Desligamento'].includes(c.situacao)
const caiu = c => ['erro', 'expirando'].includes(c.ml.status)
const pendente = c => c.opera_ml && c.ml.status === 'desconectado'        // opera ML e ainda não conectou
const precisaAcao = c => caiu(c) || pendente(c)
const peso = c => (caiu(c) ? 0 : pendente(c) ? 1 : 2)                      // caídas primeiro
// Mercado Livre por cliente: rótulo em português e instrução; o erro técnico fica só no title do selo
const ML = {
  conectado: ['Conectado', 's-ok', ''],
  erro: ['Conexão caída', 's-erro', 'cliente precisa autorizar de novo: enviar link'],
  expirando: ['Sem renovar há mais de 24 h', 's-pend', 'se não voltar sozinho, enviar link de reconexão'],
  desconectado: ['Sem conexão', 's-neutro', ''],
}
const TITULO = { acao: 'Precisa de ação', conectado: 'Conectados', desconectado: 'Sem conexão', todos: 'Todos os clientes' }
let dados = null, filtro = 'acao', limite = 50

const erroBloco = m => `<div class="erro-bloco"><b>Não foi possível carregar</b>Confira se o servidor está no ar e tente de novo.<div><button class="btn" type="button" data-tentar>Tentar de novo</button></div><details><summary>Detalhe técnico</summary><pre>${esc(m)}</pre></details></div>`
const kpi = (rotulo, valor, detalhe, estado = '') => `<div class="kpi ${estado}"><span class="rotulo">${esc(rotulo)}</span><span class="valor${valor == null ? ' mudo' : ''}">${valor == null ? '—' : typeof valor === 'number' ? fmtInt(valor) : esc(valor)}</span><span class="detalhe">${esc(detalhe)}</span></div>`

async function carregar() {
  const cards = $('cards'), tab = $('tabela')
  cards.setAttribute('aria-busy', 'true'); tab.setAttribute('aria-busy', 'true')
  try { dados = await api('/api/integracoes') } catch (e) {
    dados = null
    $('veredito').textContent = 'Não foi possível ler as conexões do Mercado Livre.'
    window.PS?.regua?.('regua', { valor: NaN })   // sem dado, sem régua
    cards.classList.remove('kpis'); cards.innerHTML = erroBloco(e.message)
    $('tb').innerHTML = `<tr><td colspan="6">${erroBloco(e.message)}</td></tr>`
    $('proxima').hidden = true
    return
  } finally { cards.removeAttribute('aria-busy'); tab.removeAttribute('aria-busy') }
  cards.classList.add('kpis')
  const sel = $('fplano'), atual = sel.value
  sel.innerHTML = '<option value="">Todos os planos</option>' + [...new Set(dados.clientes.map(c => c.tier).filter(Boolean))].sort().map(t => `<option value="${esc(t)}">${esc(t)} (${dados.clientes.filter(c => c.tier === t).length})</option>`).join('')
  sel.value = [...sel.options].some(o => o.value === atual) ? atual : ''
  resumo(); configuracao(); desenhar()
}

// veredito, 3 KPIs e a próxima ação, calculados com o que a tela já recebeu
function resumo() {
  const cs = dados.clientes.filter(ativo), base = cs.filter(c => c.opera_ml)
  const con = base.filter(c => c.ml.status === 'conectado').length, naoCon = cs.filter(pendente).length
  const caidas = cs.filter(caiu).sort((a, b) => a.cliente.localeCompare(b.cliente))
  const pct = base.length ? Math.round(con / base.length * 100) : null
  const fr = caidas.length ? `<b>${plural(caidas.length, 'conexão caída', 'conexões caídas')}.</b>` : 'Nenhuma conexão caída.'
  $('veredito').innerHTML = `Mercado Livre: <b>${fmtInt(con)} de ${fmtInt(base.length)}</b> clientes que operam ML conectados${pct == null ? '' : ` (${pct}%)`}. ${fr} Amazon e Shopee aguardam app oficial.${dados.ml.configurado ? '' : ' O app do Mercado Livre ainda não está configurado: nenhum link de conexão pode ser gerado.'}`
  // régua: cobertura real conectados ÷ quem opera ML, sem marco (não há meta declarada); some sem base — PS.regua esconde com valor não numérico
  window.PS?.regua?.('regua', { valor: base.length ? 100 * con / base.length : NaN, rotulo: `${fmtInt(con)} de ${fmtInt(base.length)} conectados${pct == null ? '' : ` (${pct}%)`}` })
  $('cards').innerHTML = kpi('Cobertura ML', pct == null ? null : pct + '%', `${fmtInt(con)} de ${fmtInt(base.length)} que operam ML`)
    + kpi('Conexões caídas', caidas.length, caidas.length ? 'risco: o cliente precisa autorizar de novo' : 'nenhuma: os tokens renovam sozinhos', caidas.length ? 'risco' : 'bom')
    + kpi('Operam ML e não conectaram', naoCon, naoCon ? 'enviar o link de conexão' : 'todos conectados')
  const bt = $('proximaBtn')
  if (caidas.length) {
    $('proximaTexto').textContent = `Reconectar ${caidas[0].cliente}`; bt.textContent = 'Copiar link de reconexão'
    bt.onclick = () => copiarLink(caidas[0].cliente, bt)
  } else if (naoCon) {
    $('proximaTexto').textContent = plural(naoCon, 'cliente que opera ML ainda não conectou', 'clientes que operam ML ainda não conectaram'); bt.textContent = 'Ver quem não conectou'
    bt.onclick = () => { escolherFiltro('acao'); $('secLista').scrollIntoView({ block: 'start' }); $('tabela').focus({ preventScroll: true }) }
  }
  $('proxima').hidden = !caidas.length && !naoCon
}

// recolhido "Configuração técnica": .env e DevCenter do ML, roadmap Amazon/Shopee; abre sozinho só com o app incompleto
function configuracao() {
  const ml = dados.ml, dc = ml.devcenter
  const item = ([k, v]) => `<div class="linha mt-2"><span class="selo ${v ? 's-ok' : 's-erro'}">${v ? 'ok' : 'falta'}</span><span>${esc(k)}</span></div>`
  const url = (rot, u) => `<p class="mini mt-2">${rot}</p><div class="cu-url"><code>${esc(u)}</code><button class="btn btn-p" type="button" data-copia="${esc(u)}">Copiar</button></div>`
  $('configEstado').textContent = ml.configurado ? 'ML ok' : plural((ml.pendente_config || []).length, 'pendência', 'pendências')   // curto no summary; a frase inteira fica no .aviso
  $('secConfig').open = !ml.configurado
  $('avisoConfig').innerHTML = `${ml.configurado ? '' : `<div class="aviso"><b>App do Mercado Livre incompleto.</b> Falta: ${ml.pendente_config.map(esc).join(' · ')}. Sem isso a tela mostra o estado real, mas não gera links de autorização.</div>`}
    <div class="grade">
      <div><h3>Mercado Livre no servidor (.env)</h3>${ml.app_id ? `<p class="mini">app ${esc(ml.app_id)}</p>` : ''}${Object.entries(ml.checklist).map(item).join('')}</div>
      <div><h3>Para colar no DevCenter</h3><p class="mini">developers.mercadolivre.com.br → sua aplicação</p>${url('URI de redirect', dc.redirect_uri)}${url('URL de notificações (callbacks)', dc.notificacoes_url)}
        <p class="mini mt-2">PKCE: ${esc(dc.pkce)} · Fluxos: Authorization Code + Refresh Token · Notificações recebidas: <b>${fmtInt(ml.notificacoes_recebidas)}</b></p></div>
    </div>`
  const canal = (x, n) => `<div><h3>${esc(x.nome)} <span class="selo s-pend">aguardando app</span></h3><p class="mini">${plural(n, 'cliente no canal', 'clientes no canal')} · fluxo oficial: ${esc(x.fluxo)}</p><p class="mini mt-2">Falta providenciar:</p><ul class="mini">${x.requisitos.map(r => `<li>${esc(r)}</li>`).join('')}</ul></div>`
  $('roadmap').innerHTML = `<div class="grade mt-4">${canal(dados.amazon, dados.clientes.filter(c => c.amazon.status === 'aguardando_app').length)}${canal(dados.shopee, dados.clientes.filter(c => c.shopee.status === 'aguardando_app').length)}</div>
    <p class="nota mt-4">Aplicativo público da Place2u no Bling: fica no fim do painel Custos de qualquer cliente (configuração global, cifrada no servidor).</p>`
}
$('avisoConfig').addEventListener('click', ev => {
  const b = ev.target.closest('[data-copia]'); if (!b) return
  navigator.clipboard.writeText(b.dataset.copia).then(() => { b.textContent = 'Copiado'; setTimeout(() => { b.textContent = 'Copiar' }, 1500) }, () => toast('O navegador não deixou copiar: selecione o texto e copie à mão.', 'erro'))
})

const casaFiltro = c => (filtro === 'acao' ? precisaAcao(c) : filtro === 'conectado' ? c.ml.status === 'conectado' : filtro === 'desconectado' ? c.ml.status === 'desconectado' : true)
const linha = c => {
  const [rot, cls, dica] = ML[c.ml.status] || [c.ml.status, 's-neutro', '']
  const outros = [c.amazon.status === 'aguardando_app' && 'AMZ', c.shopee.status === 'aguardando_app' && 'SHO'].filter(Boolean)
  const extras = c.canais.filter(k => !['ML', 'AMZ', 'SHO'].includes(k))
  const menu = (c.ml.restauravel ? `<button type="button" data-rest="${esc(c.cliente)}">Restaurar conexão guardada</button>` : '')
    + (['conectado', 'erro', 'expirando'].includes(c.ml.status) ? `${c.ml.restauravel ? '<hr>' : ''}<button type="button" class="menu-perigo" data-desc="${esc(c.cliente)}">Desconectar</button>` : '')
  // cada célula tem um único <div>: abaixo de 640px a linha vira cartão (table.empilha) e o td passa a ser flex (rótulo + conteúdo)
  return `<tr>
    <td data-rotulo="Cliente"><div><a href="/cliente?cliente=${encodeURIComponent(c.cliente)}">${esc(c.cliente)}</a><div class="mini">${esc(c.tier || 'plano não informado')} · ${esc(c.consultor || 'consultor a definir')}</div></div></td>
    <td data-rotulo="Mercado Livre"><div><span class="selo ${cls}"${c.ml.erro ? ` title="${esc(c.ml.erro)}"` : ''}>${esc(rot)}</span>${dica ? `<div class="mini">${dica}</div>` : ''}${c.ml.nickname ? `<div class="mini">${esc(c.ml.nickname)}${c.ml.seller_id ? ' · seller ' + esc(String(c.ml.seller_id)) : ''}</div>` : ''}${c.opera_ml ? '' : '<div class="mini">ML não consta nos canais da central</div>'}</div></td>
    <td data-rotulo="Outros canais"><div>${outros.length ? `<span class="chip">${outros.join(' · ')} aguardando app</span>` : ''}${extras.length ? `<div class="mini">${esc(extras.join(' · '))}</div>` : ''}${outros.length || extras.length ? '' : '<span class="mini">—</span>'}</div></td>
    <td data-rotulo="Custos"><div>${celCustos(c)}</div></td>
    <td data-rotulo="Situação"><div>${c.situacao === 'Ativo' ? '<span class="mini">Ativo</span>' : `<span class="selo ${c.situacao === 'Congelado' ? 's-pend' : 's-neutro'}">${esc(c.situacao || '—')}</span>`}</div></td>
    <td data-rotulo="Ações" class="direita"><div><button class="btn btn-p" type="button" data-link="${esc(c.cliente)}">${c.ml.status === 'conectado' ? 'Novo link' : caiu(c) ? 'Copiar link de reconexão' : 'Copiar link de conexão'}</button>${menu ? ` <details class="menu"><summary class="btn btn-p" aria-label="Mais ações">⋯</summary><div class="menu-lista">${menu}</div></details>` : ''}</div></td></tr>`
}

function desenhar() {
  if (!dados) return
  const q = $('fq').value.trim().toLowerCase(), plano = $('fplano').value, mostraDesl = $('fdesl').checked
  const base = dados.clientes.filter(c => (!q || c.cliente.toLowerCase().includes(q)) && (!plano || c.tier === plano) && (mostraDesl || ativo(c)))
  const n = { acao: base.filter(precisaAcao).length, conectado: base.filter(c => c.ml.status === 'conectado').length, desconectado: base.filter(c => c.ml.status === 'desconectado').length, todos: base.length }
  document.querySelectorAll('.f-chip').forEach(b => { const on = b.dataset.f === filtro; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); b.querySelector('.n').textContent = fmtInt(n[b.dataset.f] ?? 0) })
  const lista = base.filter(casaFiltro).sort((a, b) => peso(a) - peso(b) || a.cliente.localeCompare(b.cliente)), pag = lista.slice(0, limite)
  $('tituloLista').textContent = TITULO[filtro]
  $('subLista').textContent = plural(lista.length, 'cliente', 'clientes') + (filtro === 'acao' ? ' · conexões caídas primeiro, depois quem opera ML e ainda não conectou' : '')
  $('tb').innerHTML = pag.length
    ? pag.map(linha).join('') + (lista.length > limite ? `<tr><td colspan="6"><div class="t-pag">1–${fmtInt(limite)} de ${fmtInt(lista.length)}<button class="btn btn-p" type="button" data-mais>Mostrar mais</button></div></td></tr>` : '')
    : `<tr><td colspan="6" class="vazio">${filtro === 'acao' ? '<b>Ninguém precisa de ação.</b>As conexões do Mercado Livre estão em dia neste filtro.' : '<b>Nenhum cliente nesse filtro.</b>Limpe a busca ou troque o chip acima.'}</td></tr>`
  $('btnLinksCsv').href = '/api/integracoes/links.csv?status=desconectado' + (plano ? '&tier=' + encodeURIComponent(plano) : '') + (mostraDesl ? '&desligados=1' : '')
}

const copiarLink = async (cliente, b) => {
  b.disabled = true; b.setAttribute('aria-busy', 'true')
  try {
    const { url, nota } = await api('/api/integracoes/meli/link', { cliente })
    await navigator.clipboard.writeText(url).catch(() => { throw new Error('O navegador não deixou copiar: use "Baixar links de quem não conectou".') })
    toast(`Link de conexão de ${cliente} copiado (válido 60 dias). ${nota || ''}`)
  } catch (e) { toast(e.message, 'erro') } finally { b.disabled = false; b.removeAttribute('aria-busy') }
}
// ações das linhas por delegação: a tabela é redesenhada a cada filtro
$('tb').addEventListener('click', async ev => {
  const b = ev.target.closest('button'); if (!b || b.disabled) return
  if (b.dataset.custos) return abrirCustos(b.dataset.custos)
  if (b.dataset.link) return copiarLink(b.dataset.link, b)
  if (b.hasAttribute('data-mais')) { limite += 50; return desenhar() }
  if (b.dataset.rest) {
    try { const r = await api('/api/meli/restaurar', { cliente: b.dataset.rest }); toast(r.nota || `Conexão de ${b.dataset.rest} restaurada.`); carregar() } catch (e) { toast(e.message, 'erro') }
    return
  }
  if (b.dataset.desc) {
    const cli = b.dataset.desc; b.closest('details')?.removeAttribute('open')
    if (!await confirmar({ titulo: `Desconectar o Mercado Livre de ${cli}?`, texto: 'A conexão fica guardada e pode ser restaurada sem o cliente autorizar de novo; os dados coletados são apagados e o plano volta a rodar só com o Notion.', rotuloOk: 'Desconectar', perigo: true })) return
    try { await api('/api/meli/desconectar', { cliente: cli }); toast(`Mercado Livre de ${cli} desconectado.`); carregar() } catch (e) { toast(e.message, 'erro') }
  }
})
// <custos> ── Custos por SKU vindos da planilha (webhook), do Bling ou do Tiny: cartão por cliente (docs/integracao-custos-erp-SPEC.md, 10.2).
// Só leitura de ERP/planilha. Todo dado passa por esc(). Nenhum segredo de ERP volta do servidor; o segredo do webhook vive só no diálogo
// (textContent) e é apagado ao fechar — nunca vai para localStorage. Ação destrutiva pede 2º clique no mesmo botão (sem confirm()).
// <custos-puro> — sem DOM: scripts/teste-custos-ui.mjs executa este trecho isolado com dados-sonda
const enc = encodeURIComponent
const fmtN = n => (n == null || n === '' || !Number.isFinite(Number(n)) ? '—' : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 1 }))
const fmtR = n => (fmtN(n) === '—' ? '—' : 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const fmtPct = n => (fmtN(n) === '—' ? '—' : fmtN(n) + '%')
// carimbo ISO → Brasília; valor que não é data volta como veio (sempre passa por esc() no HTML)
const brHora = iso => { const d = new Date(iso || NaN); return Number.isNaN(d.getTime()) ? (iso ? String(iso) : '—') : d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) }
const qtd = v => (Array.isArray(v) ? v.length : v)
const FONTES_CUSTO = [['sheets', 'Planilha (Google Sheets)'], ['bling', 'Bling'], ['tiny', 'Tiny / Olist']]
const EST_CUSTO = { conectado: ['conectado', 's-ok'], erro: ['erro', 's-erro'], reautorizar: ['reautorizar', 's-erro'], pausado: ['pausado', 's-pend'], desconectado: ['desconectado', 's-neutro'] }
const MOTIVO_Q = { variacao_brusca: 'variação brusca', custo_ge_preco: 'custo ≥ preço cheio do anúncio', kit_divergente: 'kit diverge da soma dos componentes' }
const LISTAS_REC = [['sku_erp_sem_anuncio', 'SKU do ERP sem anúncio'], ['anuncio_sem_custo', 'Anúncio sem custo'], ['conflito', 'Conflito SKU × MLB'], ['anuncio_sem_sku', 'Anúncio sem SKU'], ['rejeitadas', 'Rejeitadas'], ['nao_visto', 'Não vistos'], ['kits_pendentes', 'Kits pendentes'], ['divergencia_fontes', 'Divergência entre fontes']]
const AUTORIZA_OFICIAL = /^https:\/\/(www\.bling\.com\.br|accounts\.tiny\.com\.br)\//   // só abre link de autorização do próprio ERP
const celCustos = c => (['conectado', 'erro', 'expirando'].includes(c.ml.status) ? `<button class="btn-mini" data-custos="${esc(c.cliente)}" aria-controls="custosPainel">Custos</button>` : '<span class="mini">exige conta ML</span>')

const hPlanilha = w => `<div class="mini">${w ? `webhook <b>${w.ativo ? 'ativo' : 'desativado'}</b> · criado ${esc(brHora(w.criado_em))}${w.rotacionado_em ? ` · segredo rotacionado ${esc(brHora(w.rotacionado_em))}` : ''} · último envio ${esc(brHora(w.ultimo_uso_em))}` : 'sem webhook: gere um para a planilha enviar os custos'}</div>
  ${w?.ativo ? `<div class="cu-url"><code>${esc(w.url)}</code><button class="btn-mini" data-cu-copia="${esc(w.url)}">Copiar URL</button></div>` : ''}
  <div class="cu-acoes">${w?.ativo ? '<button class="btn-mini" data-cacao="wh-rotacionar" data-armar="Confirmar: novo segredo (o atual vale mais 24 h)">Rotacionar segredo</button><button class="btn-mini no" data-cacao="wh-desativar" data-armar="Confirmar: desativar (envios passam a ser recusados)">Desativar</button>'
    : `<button class="btn-mini" data-cacao="wh-gerar"${w ? ' data-armar="Confirmar: novo webhook (a URL antiga deixa de valer)"' : ''}>Gerar webhook</button>`}</div>
  <div class="mini">A planilha envia sozinha a cada 10 min se algo mudou (e 1× por dia mesmo sem mudança). Para forçar: menu “Custos → Sincronizar agora” dentro da planilha.</div>`

const hErp = (f, cr, rodando) => {
  const nome = f === 'bling' ? 'Bling' : 'Tiny'
  return `<div class="mini">${cr.conectado ? `autorizado${cr.company_id ? ` · empresa ${esc(cr.company_id)}` : ''}${cr.expira_em ? ` · token até ${esc(brHora(cr.expira_em))} (renova sozinho)` : ''}` : cr.reautorizar ? '<b class="cu-neg">autorização expirada ou revogada: gere um novo link</b>' : 'não autorizado'} · app ${cr.modo_app === 'global' ? 'público da Place2u' : 'do próprio cliente'}${cr.app_configurado === false ? ' — <b>app ainda não cadastrado</b>' : ''}</div>
    ${cr.escopos?.length ? `<div class="mini">escopos: ${esc(cr.escopos.join(' '))}</div>` : ''}${cr.erro ? `<div class="mini cu-neg">${esc(cr.erro)}</div>` : ''}
    <form class="cu-form" data-form="${esc(f)}" autocomplete="off">
      ${f === 'bling' ? `<label>Aplicativo <select name="modo_app"><option value="global"${cr.modo_app === 'proprio' ? '' : ' selected'}>público da Place2u</option><option value="proprio"${cr.modo_app === 'proprio' ? ' selected' : ''}>do próprio cliente (privado)</option></select></label>` : ''}
      <label>client_id <input name="client_id" type="password" autocomplete="off" spellcheck="false" maxlength="512"></label>
      <label>client_secret <input name="client_secret" type="password" autocomplete="new-password" spellcheck="false" maxlength="512"></label>
      <div><button class="btn-mini" type="submit">Salvar aplicativo</button> <span class="mini">${f === 'bling' ? 'client_id/secret só no app do próprio cliente; ' : ''}cifrados no servidor, nunca voltam para a tela</span></div>
    </form>
    <div class="cu-acoes"><button class="btn-mini" data-cacao="autorizar" data-fonte="${esc(f)}">${cr.conectado ? 'Reautorizar' : 'Autorizar'} no ${esc(nome)}</button>
      <button class="btn-mini" data-cacao="sincronizar" data-fonte="${esc(f)}"${rodando ? ' disabled' : ''}>${rodando ? 'Sincronizando…' : 'Sincronizar agora'}</button>
      ${cr.conectado || cr.reautorizar ? `<button class="btn-mini no" data-cacao="desconectar" data-fonte="${esc(f)}" data-armar="Confirmar: apagar os tokens do ${esc(nome)}">Desconectar</button>` : ''}</div>
    <div class="mini" id="cuJob-${esc(f)}" role="status"></div>`
}

const hFonte = (f, nome, x, rodando) => {
  const [rot, cls] = EST_CUSTO[x.estado] || [x.estado || 'desconectado', 's-neutro'], ct = x.contagens || {}
  return `<div class="card cu-fonte"><h3>${esc(nome)} <span><span class="selo ${esc(cls)}">${esc(rot)}</span>${x.velha ? ' <span class="selo s-pend">custo velho</span>' : ''}</span></h3>
    <div class="mini">última sincronização OK: ${esc(brHora(x.ultimo_sync_ok_em))}${x.ultimo_sync_ok_em && x.idade_dias != null ? ` (há ${fmtN(x.idade_dias)} dia(s))` : ''}</div>
    <div class="nums">${[['skus', 'SKUs com custo'], ['rejeitadas', 'rejeitadas'], ['quarentena', 'em quarentena'], ['nao_vistos', 'não vistos']].map(([k, r]) => `<div class="n"><b>${fmtN(ct[k])}</b><span>${esc(r)}</span></div>`).join('')}</div>
    ${x.ultimo_erro ? `<div class="mini cu-neg">${esc(x.ultimo_erro)}</div>` : ''}
    ${f === 'sheets' ? hPlanilha(x.webhook) : hErp(f, x.credenciais || {}, rodando)}</div>`
}

const hCorpo = (r, rodando = {}) => {
  const ef = r.efetivo || {}, pf = ef.por_fonte || {}, fontes = r.fontes || {}, pend = Array.isArray(r.pendencias) ? r.pendencias : []
  const ordem = Array.isArray(r.cfg?.ordem_fontes) ? r.cfg.ordem_fontes : ['manual', 'upload', 'bling', 'tiny', 'sheets']
  return `${pend.length ? `<div class="aviso"><b>Pendências de custo</b><ul>${pend.map(p => `<li><b>${esc(p.estado)}</b> ${esc(p.texto)}</li>`).join('')}</ul></div>` : ''}
  <div class="nums"><div class="n"><b>${fmtN(ef.skus_com_custo)}</b><span>SKUs com custo efetivo</span></div><div class="n"><b>${fmtPct(ef.cobertura_receita_pct)}</b><span>da receita coberta</span></div>
    <div class="n"><b>${fmtN(ef.anuncios_sem_custo)}</b><span>anúncios sem custo</span></div><div class="n"><b>${fmtN(ef.anuncios_sem_sku)}</b><span>anúncios sem SKU (de ${fmtN(ef.anuncios_total)})</span></div></div>
  <div class="mini">Vale a primeira fonte com custo válido nesta ordem: ${esc(ordem.join(' > '))} · por fonte: ${['manual', 'upload', 'bling', 'tiny', 'sheets'].map(f => `${esc(f)} ${fmtN(pf[f])}`).join(' · ')}</div>
  <div class="cu-fontes">${FONTES_CUSTO.map(([f, nome]) => hFonte(f, nome, fontes[f] || {}, !!rodando[f])).join('')}</div>
  <h3 class="cu-h">Quarentena (<span id="cuQuarN">…</span>)</h3><div id="cuQuar"><div class="sk-tabela"></div></div>
  <h3 class="cu-h">Reconciliação</h3>${r.reconciliacao_disponivel === false ? `<div class="aviso">${esc(r.reconciliacao_motivo || 'rode a coleta de promoções do cliente')}</div>` : ''}
  <div class="abas" role="tablist" aria-label="Listas de reconciliação">${LISTAS_REC.map(([k, rot]) => `<button class="btn-mini cu-tab" role="tab" aria-selected="false" aria-controls="cuRec" data-lista="${esc(k)}">${esc(rot)}</button>`).join('')}</div>
  <div id="cuRec" role="tabpanel"></div>
  <details class="mt-4"><summary class="mini">Aplicativo público da Place2u no Bling (um para todos os clientes no modo “público”)</summary>
    <form class="cu-form" data-form="app-global" autocomplete="off"><label>client_id <input name="client_id" type="password" autocomplete="off" spellcheck="false" maxlength="512"></label>
      <label>client_secret <input name="client_secret" type="password" autocomplete="new-password" spellcheck="false" maxlength="512"></label>
      <div><button class="btn-mini" type="submit">Salvar app público</button> <span class="mini">cifrado no servidor; não volta para a tela</span></div></form></details>`
}

const hQuar = itens => (!itens.length ? '<div class="vazio">Nada em quarentena: nenhum custo esperando a sua decisão.</div>'
  : `<div class="mini">O valor proposto NÃO vale até você aprovar: o vigente continua valendo. Recusar guarda o valor (o mesmo número não reabre).</div>
  <div class="cu-acoes"><button class="btn-mini" data-cacao="q-lote" data-decisao="aprovar">Aprovar selecionados</button><button class="btn-mini no" data-cacao="q-lote" data-decisao="recusar">Recusar selecionados</button></div>
  <div class="tabela"><table><thead><tr><th><input type="checkbox" data-q-todos aria-label="Selecionar todos"></th><th>SKU</th><th>Fonte</th><th>Motivo</th><th>Vigente</th><th>Proposto</th><th>Variação</th><th>Recebido</th><th></th></tr></thead><tbody>${itens.map(q => `<tr>
    <td><input type="checkbox" class="cu-qsel" data-sku="${esc(q.sku)}" data-fonte="${esc(q.fonte)}" aria-label="Selecionar ${esc(q.sku)} (${esc(q.fonte)})"></td>
    <td><b>${esc(q.sku)}</b></td><td>${esc(q.fonte)}</td><td>${esc(MOTIVO_Q[q.motivo] || q.motivo)}${q.campo ? `<div class="mini">${esc(q.campo)}</div>` : ''}</td>
    <td>${fmtR(q.custo_vigente)}</td><td><b>${fmtR(q.custo_proposto)}</b>${q.preco_ref != null ? `<div class="mini">preço cheio ${fmtR(q.preco_ref)}</div>` : ''}</td><td>${fmtPct(q.variacao_pct)}</td><td>${esc(brHora(q.recebido_em))}</td>
    <td><div class="cu-acoes"><button class="btn-mini" data-cacao="q-um" data-decisao="aprovar" data-sku="${esc(q.sku)}" data-fonte="${esc(q.fonte)}">Aprovar</button><button class="btn-mini no" data-cacao="q-um" data-decisao="recusar" data-sku="${esc(q.sku)}" data-fonte="${esc(q.fonte)}">Recusar</button></div></td></tr>`).join('')}</tbody></table></div>`)

// listas de reconciliação: colunas = campos que o servidor mandar (cada lista tem os seus); objeto vira JSON, tudo escapado
const celRec = v => (v == null || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v))
const hRec = r => {
  if (r.disponivel === false) return `<div class="aviso">${esc(r.motivo || 'lista indisponível para este cliente')}</div>`
  const itens = Array.isArray(r.itens) ? r.itens : [], cols = [...new Set(itens.slice(0, 50).flatMap(i => Object.keys(i || {})))].slice(0, 8)
  return !itens.length ? '<div class="vazio">Nada nesta lista.</div>'
    : `<div class="mini">${fmtN(r.total ?? itens.length)} item(ns)${Number(r.total) > itens.length ? ` · mostrando ${fmtN(itens.length)}` : ''}</div>
    <div class="tabela"><table><thead><tr>${cols.map(k => `<th>${esc(k.replace(/_/g, ' '))}</th>`).join('')}</tr></thead><tbody>${itens.map(i => `<tr>${cols.map(k => `<td>${esc(celRec(i?.[k]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
}
// </custos-puro>

const CU = { cliente: '', lista: 'sku_erp_sem_anuncio', rodando: {} }   // rodando = { cliente: { fonte: true } } enquanto o job de sync roda
const sleep = ms => new Promise(r => setTimeout(r, ms))
const quem = () => $('custosQuem').value.trim()
try { $('custosQuem').value = localStorage.getItem('promo_quem') || '' } catch { /* sem storage: segue */ }
$('custosQuem').addEventListener('change', () => { try { localStorage.setItem('promo_quem', quem()) } catch { /* sem storage: segue */ } })
const msg = (t, ruim = false) => { $(ruim ? 'custosErro' : 'custosMsg').textContent = t; $(ruim ? 'custosMsg' : 'custosErro').textContent = '' }
const exigirQuem = () => { if (quem()) return true; $('custosQuem').focus(); msg('Informe "Seu nome" no topo do cartão: a alteração fica registrada com o seu nome.', true); return false }
const copiar = (b, t) => navigator.clipboard.writeText(t).then(() => { const o = b.textContent; b.textContent = 'Copiado'; setTimeout(() => { b.textContent = o }, 1500) }, () => msg('O navegador não deixou copiar: selecione o texto e copie à mão.', true))
// ação destrutiva: o 1º clique troca o texto do botão pelo aviso e arma por 6 s; só o 2º clique executa
const armado = b => {
  if (b.dataset.armado) return true
  const o = b.textContent; b.dataset.armado = '1'; b.textContent = b.dataset.armar
  setTimeout(() => { delete b.dataset.armado; b.textContent = o }, 6000)
  return false
}

async function abrirCustos(cliente) {
  CU.cliente = cliente; msg('')
  $('custosPainel').hidden = false; $('custosTitulo').textContent = `Custos: fontes automáticas · ${cliente}`
  $('custosCorpo').innerHTML = '<div class="skeleton"></div>'
  $('custosPainel').scrollIntoView({ block: 'start' }); $('custosTitulo').focus({ preventScroll: true })
  await recarregarCustos()
}
// toda resposta é conferida contra o cliente aberto: trocar de cliente no meio descarta a resposta velha
async function recarregarCustos() {
  const cli = CU.cliente
  try {
    const r = await api(`/api/custos/resumo?cliente=${enc(cli)}`)
    if (cli !== CU.cliente) return
    $('custosCorpo').innerHTML = hCorpo(r, CU.rodando[cli])
    await Promise.all([carregarQuarentena(), carregarRec()])
  } catch (e) { if (cli === CU.cliente) $('custosCorpo').innerHTML = `<div class="aviso erro"><b>Não foi possível carregar</b> ${esc(e.message)}</div>` }
}
async function carregarQuarentena() {
  const cli = CU.cliente
  try {
    const { itens = [] } = await api(`/api/custos/quarentena?cliente=${enc(cli)}`)
    if (cli !== CU.cliente || !$('cuQuar')) return
    $('cuQuarN').textContent = itens.length; $('cuQuar').innerHTML = hQuar(itens)
  } catch (e) { if (cli === CU.cliente && $('cuQuar')) $('cuQuar').innerHTML = `<div class="aviso erro"><b>Não foi possível carregar</b> ${esc(e.message)}</div>` }
}
async function carregarRec() {
  const cli = CU.cliente, lista = CU.lista, vale = () => cli === CU.cliente && lista === CU.lista && $('cuRec')
  document.querySelectorAll('#custosCorpo [data-lista]').forEach(b => b.setAttribute('aria-selected', b.dataset.lista === lista ? 'true' : 'false'))
  if (!vale()) return
  $('cuRec').innerHTML = '<div class="sk-tabela"></div>'
  try {
    const r = await api(`/api/custos/reconciliacao?cliente=${enc(cli)}&lista=${enc(lista)}`)
    if (vale()) $('cuRec').innerHTML = hRec(r)
  } catch (e) { if (vale()) $('cuRec').innerHTML = `<div class="aviso erro"><b>Não foi possível carregar</b> ${esc(e.message)}</div>` }
}

async function webhookPlanilha(acao) {
  const r = await api('/api/custos/fontes/sheets/webhook', { cliente: CU.cliente, acao, por: quem() })
  $('dlgUrl').textContent = r.url || ''; $('dlgSeg').textContent = r.segredo || ''; $('dlgScript').value = r.script || ''
  $('dlgScript').hidden = $('dlgCopiarScript').hidden = !r.script
  $('dlgAviso').textContent = r.aviso || (acao === 'rotacionar' ? 'Segredo novo: cole o script novo na planilha. O segredo anterior ainda vale por 24 h.' : '')
  $('dlgSegredo').showModal()
  await recarregarCustos()
}
const decidir = async (itens, decisao) => {
  if (!itens.length) return msg('Marque ao menos uma linha da quarentena.', true)
  const r = await api('/api/custos/quarentena/decidir', { cliente: CU.cliente, itens, decisao, por: quem() })
  msg(`${fmtN(qtd(r.aprovados))} aprovado(s), ${fmtN(qtd(r.recusados))} recusado(s)${qtd(r.ignorados) ? `, ${fmtN(qtd(r.ignorados))} ignorado(s) (já não estavam pendentes)` : ''}.`)
  await recarregarCustos()
}
const ACOES = {
  'wh-gerar': () => webhookPlanilha('gerar'),
  'wh-rotacionar': () => webhookPlanilha('rotacionar'),
  'wh-desativar': async () => { await api('/api/custos/fontes/sheets/webhook', { cliente: CU.cliente, acao: 'desativar', por: quem() }); msg('Webhook da planilha desativado: os envios passam a ser recusados.'); await recarregarCustos() },
  autorizar: async (b, f) => {
    const { url } = await api('/api/custos/erp/autorizar', { cliente: CU.cliente, fonte: f, por: quem() })
    if (!AUTORIZA_OFICIAL.test(String(url))) throw new Error('o servidor devolveu um link de autorização fora do Bling/Tiny: não foi aberto')
    await navigator.clipboard.writeText(url).catch(() => {})
    window.open(url, '_blank', 'noopener,noreferrer')
    msg(`Link de autorização do ${f === 'bling' ? 'Bling' : 'Tiny'} aberto em outra aba e copiado (uso único): quem autoriza é o cliente, logado na conta dele.`)
  },
  // "Sincronizar agora": acompanha o job do cliente que pediu, mesmo se a tela já mostrar outro cliente
  sincronizar: async (b, f) => {
    const cli = CU.cliente, { job_id } = await api('/api/custos/fontes/sincronizar', { cliente: cli, fonte: f, por: quem() })
    ;(CU.rodando[cli] ||= {})[f] = true; b.textContent = 'Sincronizando…'
    msg(`Sincronização do ${f} iniciada (só leitura do ERP).`)
    try {
      for (;;) {
        await sleep(2000)
        const j = await api(`/api/custos/job/${enc(job_id)}?cliente=${enc(cli)}`), el = cli === CU.cliente && $('cuJob-' + f)
        if (el) el.textContent = j.estado === 'rodando' ? `sincronizando desde ${brHora(j.inicio)}…` : ''
        if (j.estado === 'rodando') continue
        if (cli === CU.cliente) msg(j.estado === 'erro' ? `Sincronização do ${f} falhou: ${j.erro || 'erro sem detalhe'}` : `Sincronização do ${f} concluída.`, j.estado === 'erro')
        return
      }
    } finally { delete CU.rodando[cli][f]; if (cli === CU.cliente) await recarregarCustos() }
  },
  desconectar: async (b, f) => { const r = await api('/api/custos/erp/desconectar', { cliente: CU.cliente, fonte: f, por: quem() }); msg(`Tokens apagados (os custos já recebidos continuam). ${r.aviso || ''}`); await recarregarCustos() },
  'q-um': b => decidir([{ sku: b.dataset.sku, fonte: b.dataset.fonte }], b.dataset.decisao),
  'q-lote': b => decidir([...document.querySelectorAll('#cuQuar .cu-qsel:checked')].map(c => ({ sku: c.dataset.sku, fonte: c.dataset.fonte })), b.dataset.decisao),
}
$('custosCorpo').addEventListener('click', async ev => {
  const b = ev.target.closest('button'); if (!b || b.disabled) return
  if (b.dataset.cuCopia) return copiar(b, b.dataset.cuCopia)
  if (b.dataset.lista) { CU.lista = b.dataset.lista; return carregarRec() }
  const acao = ACOES[b.dataset.cacao]; if (!acao) return
  if (!exigirQuem() || (b.dataset.armar && !armado(b))) return
  b.disabled = true; msg('')
  try { await acao(b, b.dataset.fonte) } catch (e) { msg(e.message, true) } finally { b.disabled = false }
})
$('custosCorpo').addEventListener('change', ev => { if (ev.target.matches('[data-q-todos]')) document.querySelectorAll('#cuQuar .cu-qsel').forEach(c => { c.checked = ev.target.checked }) })
// client_id/secret digitados aqui vão só no POST (o servidor cifra e nunca devolve); o formulário é limpo em seguida
$('custosCorpo').addEventListener('submit', async ev => {
  const fm = ev.target.closest('form[data-form]'); if (!fm) return
  ev.preventDefault(); if (!exigirQuem()) return
  const f = fm.dataset.form, v = Object.fromEntries(new FormData(fm)), chaves = { client_id: v.client_id, client_secret: v.client_secret }
  try {
    if (f === 'app-global') await api('/api/custos/erp/app-global', { fonte: 'bling', ...chaves, por: quem() })
    else await api('/api/custos/erp/credenciais', { cliente: CU.cliente, fonte: f, modo_app: v.modo_app || 'proprio', ...(v.modo_app === 'global' ? {} : chaves), por: quem() })
    fm.reset(); msg(f === 'app-global' ? 'Aplicativo público do Bling salvo (cifrado).' : `Aplicativo do ${f} salvo (cifrado). Agora use "Autorizar".`)
    await recarregarCustos()
  } catch (e) { msg(e.message, true) }
})
$('custosAtualizar').onclick = () => { if (CU.cliente) recarregarCustos() }
$('custosFechar').onclick = () => {
  const cli = CU.cliente; CU.cliente = ''; $('custosPainel').hidden = true; $('custosCorpo').innerHTML = ''; msg('')
  document.querySelector(`[data-custos="${CSS.escape(cli)}"]`)?.focus()
}
document.querySelectorAll('#dlgSegredo [data-copiar-de]').forEach(b => b.onclick = () => { const el = $(b.dataset.copiarDe); copiar(b, el.value ?? el.textContent) })
$('dlgSegredo').addEventListener('close', () => { $('dlgUrl').textContent = ''; $('dlgSeg').textContent = ''; $('dlgScript').value = '' })   // o segredo some da tela
// </custos>

// <s90> ── Assinantes Sprint 90 (autoatendimento; docs/contrato-sprint90-f1.md): lista, criação com prévia + confirmação, link de acesso
// (15 min, uso único, mostrado uma vez) e mudança de situação. Sem SPRINT90_PUBLIC_HOST a rota não existe (404): o bloco diz que está desligado. Todo dado passa por esc().
const S90_ESTADO = { pendente_pagamento: ['aguardando ativação', 's-pend'], ativo: ['ativa', 's-ok'], inadimplente: ['inadimplente', 's-erro'], pausado: ['pausada', 's-pend'], cancelado: ['cancelada', 's-neutro'], excluir_pendente: ['exclusão agendada', 's-erro'] }
const S90_CX = { conectada: ['conectado', 's-ok'], caida: ['conexão caída', 's-erro'], sem_conexao: ['sem conexão', 's-neutro'] }
const S90_MUDAR = { pendente_pagamento: [['ativo', 'Ativar (piloto sem Mercado Pago)']], ativo: [['pausado', 'Pausar']], pausado: [['ativo', 'Retomar']], inadimplente: [['ativo', 'Retomar'], ['pausado', 'Pausar']] }
const s90Quem = () => $('s90Quem').value.trim()
try { $('s90Quem').value = localStorage.getItem('promo_quem') || '' } catch { /* sem storage: segue */ }
$('s90Quem').addEventListener('change', () => { try { localStorage.setItem('promo_quem', s90Quem()) } catch { /* sem storage: segue */ } })
const s90Reais = c => (Number(c) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const hS90Linha = c => {
  const [est, cls] = S90_ESTADO[c.estado] || [c.estado, 's-neutro'], [cx, ccls] = S90_CX[c.conexao?.estado] || ['—', 's-neutro']
  const menu = (S90_MUDAR[c.estado] || []).map(([e, rot]) => `<button type="button" data-s90-estado="${esc(e)}" data-s90-id="${esc(c.id)}">${esc(rot)}</button>`).join('')
    + `<button type="button" data-s90-revogar="${esc(c.id)}">Derrubar acessos (sessões e links)</button>`
    + (c.estado !== 'cancelado' && c.estado !== 'excluir_pendente' ? `<hr><button type="button" class="menu-perigo" data-s90-estado="cancelado" data-s90-id="${esc(c.id)}">Cancelar a conta</button>` : '')
  return `<tr><td><div><b>${esc(c.loja)}</b>${c.piloto ? ' <span class="selo s-neutro">piloto</span>' : ''}<div class="mini">${esc(c.nome)} · ${esc(c.email)}</div></div></td>
    <td><div>${esc(c.plano === 'crescimento' ? 'Crescimento' : 'Fixo')}<div class="mini">${esc(s90Reais(c.preco_centavos))}${c.comissao_pct ? ` + ${esc(String(c.comissao_pct))}%` : ''}</div></div></td>
    <td><div><span class="selo ${esc(cls)}">${esc(est)}</span>${c.aceite_em ? '' : '<div class="mini">termos ainda não aceitos</div>'}</div></td>
    <td><div><span class="selo ${esc(ccls)}">${esc(cx)}</span>${c.conexao?.nickname ? `<div class="mini">${esc(c.conexao.nickname)}</div>` : ''}</div></td>
    <td><div>${c.inicio_em ? esc(c.inicio_em.split('-').reverse().join('/')) : '<span class="mini">—</span>'}</div></td>
    <td class="direita"><div><button class="btn btn-p" type="button" data-s90-link="${esc(c.id)}">Gerar link de acesso</button>${menu ? ` <details class="menu"><summary class="btn btn-p" aria-label="Mais ações">⋯</summary><div class="menu-lista">${menu}</div></details>` : ''}</div></td></tr>`
}
async function carregarS90() {
  const corpo = $('s90Corpo')
  corpo.setAttribute('aria-busy', 'true')
  try {
    const r = await fetch('/api/sprint90/contas')
    // 404 = sem SPRINT90_PUBLIC_HOST; 503 = env definida, mas config/sprint90.json inválido (o servidor diz o motivo real)
    if (r.status === 404 || r.status === 503) { const motivo = r.status === 503 ? (await r.json().catch(() => ({}))).erro : ''; corpo.innerHTML = `<div class="vazio"><b>Sprint 90 desligado neste servidor.</b>${esc(motivo || 'Falta SPRINT90_PUBLIC_HOST no .env (e reiniciar o servidor pelo fluxo combinado).')}</div>`; $('s90Nova').hidden = true; return }
    const d = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(d.erro || 'erro ' + r.status)
    $('subS90').textContent = `${plural(d.contas.length, 'conta', 'contas')} · turma fundadora: ${fmtInt(d.vagas.ocupadas)} de ${fmtInt(d.vagas.total)} vagas · termos ${d.termos.publicados ? 'publicados' : d.termos.rascunho ? 'em rascunho (só conta de piloto)' : 'ausentes (cadastro bloqueado)'} · painel em ${d.host}`
    corpo.innerHTML = d.contas.length
      ? `<div class="tabela-wrap"><table class="empilha"><thead><tr><th>Loja</th><th>Plano</th><th>Situação</th><th>Mercado Livre</th><th>Início</th><th>Ações</th></tr></thead><tbody>${d.contas.map(hS90Linha).join('')}</tbody></table></div>`
      : '<div class="vazio"><b>Nenhum assinante ainda.</b>Crie a primeira conta em “Nova conta Sprint 90”.</div>'
  } catch (e) { corpo.innerHTML = erroBloco(e.message) } finally { corpo.removeAttribute('aria-busy') }
}
const exigirQuemS90 = () => { if (s90Quem()) return true; $('s90Quem').focus(); toast('Informe "Seu nome" no bloco Sprint 90: a ação fica registrada com o seu nome.', 'erro'); return false }
$('s90Corpo').addEventListener('click', async ev => {
  const b = ev.target.closest('button'); if (!b || b.disabled) return
  if (b.dataset.s90Link) {
    if (!exigirQuemS90()) return
    b.disabled = true
    try {
      const r = await api(`/api/sprint90/contas/${encodeURIComponent(b.dataset.s90Link)}/acesso`, { por: s90Quem() })
      $('s90Link').textContent = r.url; $('s90LinkBox').hidden = false
      $('s90Msg').textContent = r.nota
      setTimeout(() => { $('s90Link').textContent = ''; $('s90LinkBox').hidden = true; $('s90Msg').textContent = '' }, 15 * 60e3)   // o link some da tela quando vence
    } catch (e) { toast(e.message, 'erro') } finally { b.disabled = false }
    return
  }
  if (b.dataset.s90Revogar) {
    b.closest('details')?.removeAttribute('open')
    if (!exigirQuemS90()) return
    if (!await confirmar({ titulo: 'Derrubar os acessos desta conta?', texto: 'Todas as sessões abertas e os links ainda não usados param de valer. O cliente só entra de novo com um link novo.', rotuloOk: 'Derrubar acessos', perigo: true })) return
    try { const r = await api(`/api/sprint90/contas/${encodeURIComponent(b.dataset.s90Revogar)}/revogar`, { por: s90Quem() }); toast(`Acessos derrubados: ${r.sessoes} sessão(ões), ${r.links} link(s).`) } catch (e) { toast(e.message, 'erro') }
    return
  }
  if (b.dataset.s90Estado) {
    b.closest('details')?.removeAttribute('open')
    if (!exigirQuemS90()) return
    const cancelar = b.dataset.s90Estado === 'cancelado'
    if (!await confirmar({ titulo: `${b.textContent}?`, texto: cancelar ? 'A conta fica só com leitura e exclusão pelo painel por 90 dias e depois é expurgada (exportação: o cliente pede à Place2u).' : 'A mudança fica registrada com o seu nome.', rotuloOk: b.textContent, perigo: cancelar })) return
    try { await api(`/api/sprint90/contas/${encodeURIComponent(b.dataset.s90Id)}/estado`, { estado: b.dataset.s90Estado, por: s90Quem(), motivo: `${b.textContent} (Integrações)` }); toast('Situação atualizada.'); carregarS90() } catch (e) { toast(e.message, 'erro') }
  }
})
$('s90Copiar').onclick = () => navigator.clipboard.writeText($('s90Link').textContent).then(() => toast('Link copiado.'), () => toast('O navegador não deixou copiar: selecione o texto e copie à mão.', 'erro'))
$('s90Form').addEventListener('submit', async ev => {
  ev.preventDefault(); if (!exigirQuemS90()) return
  const v = Object.fromEntries(new FormData($('s90Form'))), corpo = { nome: v.nome, loja: v.loja, email: v.email, telefone: v.telefone, faixa: v.faixa, plano: v.plano, piloto: v.piloto === 'on', por: s90Quem() }
  try {
    const { conta: p } = await api('/api/sprint90/contas', corpo)
    if (!p.termos_publicados && !p.piloto) return toast('Termos ainda não publicados: só dá para criar conta de piloto ou demonstração.', 'erro')
    if (!await confirmar({ titulo: `Criar a conta Sprint 90 de ${p.loja}?`, texto: `${p.nome} · ${p.email} · plano ${p.plano} (${s90Reais(p.preco_centavos)}${p.comissao_pct ? ` + ${p.comissao_pct}%` : ''})${p.piloto ? ' · piloto/demonstração' : ''} · ${p.vagas.restantes} vaga(s) na turma. A conta nasce aguardando ativação.`, rotuloOk: 'Criar conta' })) return
    await api('/api/sprint90/contas', { ...corpo, confirmar: true })
    $('s90Form').reset(); toast(`Conta de ${p.loja} criada. Ative e gere o link de acesso na lista.`); carregarS90()
  } catch (e) { toast(e.message, 'erro') }
})
carregarS90()
for (const id of ['custosQuem', 's90Quem']) { const c = $(id); if (c && !c.value) c.value = window.PS?.quem?.().nome || '' }   // padrão de «Seu nome» = «Quem sou» do topo (F2); o cargo é validado no servidor
// </s90>

// <saude-sistema> autogestão (docs/plano-autogestao.md A2): GET /api/saude, a cada 2 min; só leitura
const SAUDE_EST = { ok: ['ok', 's-ok'], atencao: ['atenção', 's-pend'], critico: ['crítico', 's-erro'], sem_dado: ['sem dado', 's-neutro'] }
const SIS_NOME = { trinity: 'Trinity', arquiteto: 'Arquiteto', oraculo: 'Oráculo', merovingio: 'Merovíngio', chaveiro: 'Chaveiro', morpheus: 'Morpheus', smith: 'Smith', neo: 'Neo' }
const dataHora = iso => iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''
async function carregarSaudeSistema() {
  try {
    const d = await api('/api/saude'), inc = new Map(d.incidentes.abertos.map(i => [i.sinal_id, i]))
    const ordem = { critico: 0, atencao: 1, sem_dado: 2, ok: 3 }
    $('saudeSistema').innerHTML = [...d.sinais].sort((a, b) => ordem[a.estado] - ordem[b.estado]).map(s => {
      const [rot, cls] = SAUDE_EST[s.estado] || SAUDE_EST.sem_dado, i = inc.get(s.id)
      return `<tr><td><span class="sis" data-sistema="${esc(s.sistema)}">${esc(SIS_NOME[s.sistema] || s.sistema)}</span></td><td>${esc(s.rotulo)}</td><td><span class="selo ${cls}">${rot}</span></td>
        <td>${s.valor == null ? '—' : esc(String(s.valor).replace('.', ','))}</td><td>${i ? `aberto ${esc(dataHora(i.aberto_em))} · prazo ${esc(dataHora(i.sla_ate))}` : '—'}</td><td>${i ? esc(i.dono) : '—'}</td></tr>`
    }).join('')
    const res = d.incidentes.resolvidos.length
    $('saudeSistemaNota').textContent = `Leitura ${dataHora(d.em)} · ${d.incidentes.abertos.length} incidente(s) aberto(s)${res ? ` · ${res} resolvido(s) recentemente` : ''} · WhatsApp do ${d.dono || 'Head de canais'} no crítico: ${d.whatsapp_critico_ligado ? 'ligado' : 'desligado'}`
  } catch (e) { $('saudeSistema').innerHTML = `<tr><td colspan="6">Saúde do sistema indisponível agora (${esc(e.message)}).</td></tr>` }
}
carregarSaudeSistema(); setInterval(carregarSaudeSistema, 120_000)
// </saude-sistema>

const escolherFiltro = f => { filtro = f; limite = 50; desenhar() }
for (const id of ['fq', 'fplano', 'fdesl']) $(id).addEventListener(id === 'fq' ? 'input' : 'change', () => { limite = 50; desenhar() })
document.querySelectorAll('.f-chip').forEach(b => b.onclick = () => escolherFiltro(b.dataset.f))
document.addEventListener('click', ev => { if (ev.target.closest('[data-tentar]')) carregar() })
carregar().then(() => { const c = new URLSearchParams(location.search).get('custos'); if (c) abrirCustos(c) })   // /integracoes?custos=<cliente> (link da aba Custos)
