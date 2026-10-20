// /comercial.js · funil de pré-venda: prospect → link de conexão → leitura da conta → relatório para apresentar.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const brData = iso => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—'
const fmtR = v => v == null ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
const fmtN = v => v == null ? '—' : Number(v).toLocaleString('pt-BR')
const api = async (url, body) => {
  const r = await fetch(url, body !== undefined ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.erro || 'erro ' + r.status)
  return j
}
const $ = id => document.getElementById(id)
const toast = m => window.PS?.toast?.(m)
const toastErro = m => window.PS?.toast ? window.PS.toast(m, 'erro') : alert(m)
const confirmar = o => (window.PS?.confirmar ?? (o => Promise.resolve(confirm(o.titulo))))(o)
const pl = (n, s, p = s + 's') => n === 1 ? s : p

const PAG = 50, PAINEL = 'comercial'
const CONEXAO = {   // estado da conexão (selo da coluna Etapa) → [rótulo, badge]
  pronto: ['Pronto para apresentar', 'selo bom'], sem_dados: ['Conectado, não lida', 'selo atencao'], sem_vendas: ['Lida, sem vendas no período', 'selo neutro'], coletando: ['Lendo a conta…', 'selo atencao'],
  aguardando: ['Aguardando conexão', 'selo neutro'], erro: ['Erro na conexão', 'selo ruim'],
}
const ROTULO = { contato: 'Pediram contato', pronto: 'Prontos para apresentar', sem_dados: 'Conectados sem dados', aguardando: 'Aguardando conexão' }
// KPI do funil → valores do campo "etapa" do filtro (painel comercial). Clicar no KPI aplica essa condição via PSFiltros.
const ETAPAS_KPI = { contato: ['pediu_contato'], pronto: ['pronto'], sem_dados: ['conectado'], aguardando: ['aguardando', 'erro'] }
// etapa do funil = a MESMA regra do servidor (etapaProspecto, exclusiva): pediu contato > pronto > conectado > erro > aguardando
const etapa = p => p.etapa || (p.quer_contato_em ? 'pediu_contato' : p.conectado ? (p.dados_lidos && !p.sem_vendas ? 'pronto' : 'conectado') : p.conexao_erro ? 'erro' : 'aguardando')
const ORDEM = { pediu_contato: 0, pronto: 1, conectado: 2, aguardando: 3, erro: 4 }
const conexao = p => p.conectado ? (p.coletando ? 'coletando' : p.sem_vendas ? 'sem_vendas' : p.dados_lidos ? 'pronto' : 'sem_dados') : p.conexao_erro ? 'erro' : 'aguardando'
const fone = p => (p.telefone || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '')

let dados = null, mostrar = PAG, fAtual = null, filtros = null, carregando = false

// ── filtros (PSFiltros, painel comercial): o componente lê ?f= da URL, desenha chips e avisa aoAplicar; a lista leva ?f= à API ──
const DEF_VAZIA = () => ({ painel: PAINEL, arvore: null, periodo: null })
function montarFiltros() {
  fAtual = new URLSearchParams(location.search).get('f') || null
  carregar()   // a lista carrega sozinha com o ?f= da URL (o servidor valida); não espera o componente
  const raiz = $('filtros')
  if (!window.PSFiltros || !raiz) return   // sem o componente a tela segue sem filtro
  // inicial sempre presente: o componente chama aoAplicar na montagem mesmo sem ?f= (se o ?f= for de outro painel ou ilegível, ele avisa f=null e a lista volta ao todo)
  filtros = PSFiltros.montar(raiz, { painel: PAINEL, inicial: DEF_VAZIA(), aoAplicar: (def, f) => { if (f === fAtual && (dados || carregando)) return marcarKpis(); fAtual = f; mostrar = PAG; carregar() } })
}
// aria-pressed do KPI cuja condição "etapa" está aplicada (o componente pode terminar de montar depois da lista: por isso é separado)
const marcarKpis = () => { const a = kpiAtivo(); $('kpis').querySelectorAll('[data-f]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.f === a))) }
// setar condição programaticamente: o componente não expõe isso, então escrevemos ?f= e remontamos (ele relê a URL e chama aoAplicar)
function aplicarDef(def) {
  const f = (def.arvore || def.periodo) ? PSFiltros.serializar(def) : null
  const u = new URL(location.href); if (f) u.searchParams.set('f', f); else u.searchParams.delete('f'); history.replaceState(history.state, '', u)
  montarFiltros()
}
const itensE = def => def?.arvore?.op === 'E' ? def.arvore.itens : def?.arvore ? [def.arvore] : []
const condEtapa = def => itensE(def).filter(c => !c.itens && c.campo === 'etapa' && ['igual', 'em'].includes(c.operador))
const kpiAtivo = () => {   // qual KPI corresponde à condição "etapa" aplicada (uma só, igual/é um de)
  const c = condEtapa(filtros?.definicao()); if (c.length !== 1) return null
  const v = [].concat(c[0].valor).sort().join(',')
  return Object.keys(ETAPAS_KPI).find(k => [...ETAPAS_KPI[k]].sort().join(',') === v) || null
}
function clicarKpi(k) {   // troca a condição "etapa" (mantém período e demais condições); clicar no ativo limpa só ela
  const def = filtros?.definicao() || DEF_VAZIA()
  const resto = itensE(def).filter(c => c.itens || c.campo !== 'etapa')
  if (kpiAtivo() !== k) { const v = ETAPAS_KPI[k]; resto.push(v.length > 1 ? { campo: 'etapa', operador: 'em', valor: v } : { campo: 'etapa', operador: 'igual', valor: v[0] }) }
  aplicarDef({ ...def, arvore: resto.length ? { op: 'E', itens: resto } : null })
}
const regua = o => window.PS?.regua?.('regua', o)

async function carregar() {
  const kpis = $('kpis'), lista = $('lista')
  $('veredito').innerHTML = '<span class="mudo">Lendo os prospects…</span>'
  kpis.innerHTML = '<div class="sk-kpi"></div>'.repeat(4); kpis.setAttribute('aria-busy', 'true')
  lista.innerHTML = '<div class="sk-tabela"></div>'; lista.setAttribute('aria-busy', 'true')
  const f = fAtual; carregando = true
  try { const r = await api('/api/comercial/prospectos' + (f ? '?f=' + encodeURIComponent(f) : '')); if (f !== fAtual) return; dados = r } catch (e) {   // resposta de um filtro já trocado é descartada
    if (f !== fAtual) return
    dados = null
    $('veredito').textContent = 'Não foi possível ler a lista de prospects.'
    regua({ valor: NaN })
    kpis.innerHTML = Object.values(ROTULO).map(r => `<div class="kpi"><span class="rotulo">${r}</span><span class="valor mudo">—</span></div>`).join('')
    $('listaSub').textContent = ''
    lista.innerHTML = `<div class="erro-bloco"><b>Não foi possível carregar</b>A lista de prospects não respondeu. <button class="btn" type="button" data-retry>Tentar de novo</button>
      <details><summary>Detalhe técnico</summary><pre>${esc(e.message)}</pre></details></div>`
    lista.querySelector('[data-retry]').onclick = carregar
    return
  } finally { if (f === fAtual) { carregando = false; kpis.removeAttribute('aria-busy'); lista.removeAttribute('aria-busy') } }
  $('infra').innerHTML = dados.infra_pronta ? '' : `<div class="aviso erro"><b>Conexão com o Mercado Livre ainda não configurada.</b> Os cadastros já funcionam; o link de conexão nasce sozinho quando a integração estiver pronta.
    <details><summary>Detalhe técnico</summary>MELI_CLIENT_ID e PUBLIC_BASE_URL no .env, mais o túnel público.</details></div>`
  desenhar()
}

// tudo aqui segue o filtro aplicado: a API já devolve só os prospects do recorte (veredito, régua, KPIs e lista saem do mesmo conjunto)
function desenhar() {
  const ps = [...dados.prospectos].sort((a, b) => ORDEM[etapa(a)] - ORDEM[etapa(b)] || String(b.criado_em).localeCompare(String(a.criado_em)))
  const n = {}; for (const p of ps) n[etapa(p)] = (n[etapa(p)] || 0) + 1
  const total = ps.length, contato = n.pediu_contato || 0, prontos = n.pronto || 0, semDados = n.conectado || 0, erro = n.erro || 0, aguardando = (n.aguardando || 0) + erro
  const filtrado = !!dados.filtro
  $('veredito').innerHTML = !total ? (filtrado ? 'Nenhum prospect neste filtro. Limpe o filtro para ver todos.' : 'Nenhum prospect ainda. Leads do site entram sozinhos; cadastre um prospect para gerar o link de conexão.')
    : `${prontos ? `<b>${prontos} ${pl(prontos, 'prospect')}</b> ${pl(prontos, 'pronto')} para apresentar` : 'Nenhum prospect pronto para apresentar'}; ${contato ? `<b>${contato}</b> ${contato === 1 ? 'pediu' : 'pediram'} contato` : 'ninguém pediu contato'}.`
  // régua: proporção real prontos ÷ prospects do recorte (sem prospect não há proporção: some)
  regua({ valor: total ? 100 * prontos / total : NaN, marco: null, rotulo: `${prontos} ${pl(prontos, 'pronto')} de ${total} ${pl(total, 'prospect')}`, rotuloMarco: '' })
  // KPIs do funil: clicar aplica a condição "etapa" no filtro (clicar de novo tira só ela)
  const kpis = [
    ['contato', contato, contato ? 'chamar no WhatsApp' : 'ninguém por enquanto', contato ? 'alerta' : ''],
    ['pronto', prontos, prontos ? 'relatório e PDF disponíveis' : 'nenhum ainda', prontos ? 'bom' : ''],
    ['sem_dados', semDados, semDados ? 'coletando ou falhou' : 'nenhum', semDados ? 'alerta' : ''],
    ['aguardando', aguardando, erro ? `${erro} com erro` : aguardando ? 'link enviado, sem resposta' : 'nenhum', erro ? 'risco' : ''],
  ]
  $('kpis').innerHTML = kpis.map(([f, v, d, tom]) => `<button class="kpi ${tom}" type="button" data-f="${f}" aria-pressed="false"><span class="rotulo">${ROTULO[f]}</span><span class="valor">${fmtN(v)}</span><span class="detalhe">${d}</span></button>`).join('')
  $('kpis').querySelectorAll('[data-f]').forEach(b => b.onclick = () => clicarKpi(b.dataset.f))
  marcarKpis()
  desenharLista(ps, filtrado)
}

function desenharLista(ps, filtrado) {
  const lista = $('lista'), pag = ps.slice(0, mostrar)
  const aviso = [].concat(dados.filtro?.aviso || []).filter(Boolean).map(esc).join(' ')   // o que a API não aplicou (honestidade: nunca em silêncio)
  $('listaSub').innerHTML = (!ps.length ? '' : filtrado ? `${ps.length} ${pl(ps.length, 'prospect')} neste filtro, por prioridade: pediu contato, pronto, sem dados, aguardando, erro.`
    : `${ps.length} ${pl(ps.length, 'prospect')}, por prioridade: pediu contato, pronto, sem dados, aguardando, erro.`) + (aviso ? `<span class="aviso info" role="status">${aviso}</span>` : '')
  if (!ps.length) lista.innerHTML = filtrado ? '<div class="vazio-box"><b>Nenhum prospect neste filtro.</b>Limpe o filtro para ver todos.<div><button class="btn" type="button" data-limpar>Limpar filtro</button></div></div>'
    : '<div class="vazio-box"><b>Nenhum prospect ainda.</b>Leads do site entram sozinhos. Para um prospect seu, cadastre e envie o link de conexão.<div><button class="btn" type="button" data-novo>Novo prospect</button></div></div>'
  else {
    const vezes = {}; for (const p of ps) if (p.email) vezes[p.email.toLowerCase()] = (vezes[p.email.toLowerCase()] || 0) + 1
    lista.innerHTML = `<div class="tabela-wrap"><table class="empilha">
      <thead><tr><th>Prospect</th><th>Etapa</th><th>Próximo passo</th><th><span class="sr">Mais ações</span></th></tr></thead>
      <tbody>${pag.map(p => linha(p, vezes)).join('')}</tbody></table>
      ${ps.length > pag.length ? `<div class="t-pag">1–${pag.length} de ${fmtN(ps.length)} · <button class="btn btn-fantasma btn-p" type="button" data-mais>Mostrar mais</button></div>` : ''}</div>`
  }
  ligar(lista)
}

// uma linha por prospect + a linha escondida do Resumo rápido (colspan = nº de colunas)
function linha(p, vezes) {
  const id = esc(p.id), et = conexao(p), [rotEt, clsEt] = CONEXAO[et], tel = fone(p), pronto = et === 'pronto'
  const utm = p.utm && Object.keys(p.utm).length ? Object.entries(p.utm).filter(([k]) => k.startsWith('utm_')).map(([k, v]) => `${k.slice(4)}=${v}`).join(' · ') : ''
  const motivo = et === 'erro' ? p.conexao_erro : (!p.conectado && !p.link) ? p.link_erro : et === 'sem_vendas' ? 'a conta foi lida (90 dias) e não tem pedidos pagos no período — não há desempenho para diagnosticar' : ''
  const passo = p.conectado
    ? (pronto ? `<a class="btn btn-p" href="/comercial/diagnostico?id=${encodeURIComponent(p.id)}" target="_blank" rel="noopener">Ver relatório</a>` : `<button class="btn btn-p" type="button" data-ler="${id}">Ler os dados da conta</button>`)
    : (p.link ? `<button class="btn btn-p" type="button" data-link="${esc(p.link)}">Copiar link</button>` : '<span class="mudo peq">Link indisponível</span>')
  const pdf = pronto ? `<a class="btn btn-fantasma btn-p" href="/comercial/diagnostico.pdf?id=${encodeURIComponent(p.id)}" target="_blank" rel="noopener">Baixar PDF</a>` : '<a class="btn btn-fantasma btn-p" aria-disabled="true">Baixar PDF</a>'
  const indisponivel = (rot, por) => `<a aria-disabled="true">${rot} <small>${por}</small></a>`
  return `<tr>
    <td><div><b>${esc(p.nome)}</b> <span class="badge">${p.origem === 'publico' ? 'site' : 'closer'}</span>${p.quer_contato_em ? ' <span class="badge contorno">Pediu contato</span>' : ''}${p.email && vezes[p.email.toLowerCase()] > 1 ? ' <span class="selo atencao">e-mail repetido</span>' : ''}
      <div class="mudo peq">${esc(p.empresa)}${p.email ? ' · ' + esc(p.email) : ''} · desde ${brData(p.criado_em)}${utm ? ` · <span title="origem da campanha (UTM)">${esc(utm)}</span>` : ''}</div>${formulario(p)}</div></td>
    <td data-rotulo="Etapa"><div><span class="${clsEt}">${rotEt}</span>${motivo ? `<div class="mudo peq">${esc(motivo)}</div>` : ''}<div class="mudo peq" data-prog="${id}"></div></div></td>
    <td data-rotulo="Próximo passo"><div class="linha">${passo} ${pdf}</div></td>
    <td><details class="menu"><summary class="btn btn-p" aria-label="Mais ações">⋯</summary><div class="menu-lista">
      ${pronto ? `<button type="button" data-ler="${id}">Atualizar dados</button>` : indisponivel('Atualizar dados', p.conectado ? 'leia os dados primeiro' : 'após conectar')}
      ${p.conectado ? `<button type="button" data-diag="${id}">Resumo rápido</button>` : indisponivel('Resumo rápido', 'após conectar')}
      ${tel.length >= 10 ? `<a href="https://wa.me/55${tel}" target="_blank" rel="noopener">WhatsApp</a>` : indisponivel('WhatsApp', 'sem telefone')}
      <hr><button type="button" class="menu-perigo" data-del="${id}">Remover</button>
    </div></details></td>
  </tr><tr id="dx-${id}" hidden><td colspan="4"><div class="diag" id="dxbox-${id}"></div></td></tr>`
}

// campos extras do formulário público (nicho, canais, funcionários, faturamento) — só aqui e no relatório interno
const formulario = p => { const f = p.formulario; if (!f) return ''
  return `<div class="mudo peq" title="formulário público">${[f.nicho, f.funcionarios && f.funcionarios + ' funcionários', f.faturamento && 'fatura ' + f.faturamento, f.canais?.length && 'vende em: ' + [].concat(f.canais).join(', ')].filter(Boolean).map(esc).join(' · ')}</div>` }

function ligar(lista) {
  const fecharMenu = el => el.closest('details.menu')?.removeAttribute('open')
  document.querySelectorAll('[data-limpar]').forEach(b => b.onclick = () => aplicarDef(DEF_VAZIA()))
  lista.querySelector('[data-mais]')?.addEventListener('click', () => { mostrar += PAG; desenhar() })
  lista.querySelector('[data-novo]')?.addEventListener('click', () => setTimeout(abrirNovo))   // o shell.js fecha todo details.menu aberto no bubble deste clique: abrir só depois dele
  lista.querySelectorAll('[data-link]').forEach(b => b.onclick = async () => {
    try { await navigator.clipboard.writeText(b.dataset.link); b.textContent = 'Copiado'; setTimeout(() => { b.textContent = 'Copiar link' }, 1500) }
    catch { mostrarLink(b.dataset.link) }
  })
  lista.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    fecharMenu(b)
    if (!await confirmar({ titulo: 'Remover este prospect?', texto: 'A conexão autorizada no Mercado Livre deixa de ser usada e o cadastro é apagado.', rotuloOk: 'Remover', perigo: true })) return
    try { await api('/api/comercial/remover', { id: b.dataset.del }); toast('Prospect removido'); carregar() } catch (e) { toastErro('Não foi possível remover: ' + e.message) }
  })
  lista.querySelectorAll('[data-ler]').forEach(b => b.onclick = async () => {
    fecharMenu(b)
    const rot = b.textContent, prog = lista.querySelector(`[data-prog="${b.dataset.ler}"]`); b.disabled = true
    try {
      const { job } = await api('/api/comercial/coletar', { id: b.dataset.ler })
      for (;;) {
        const j = await api('/api/planos/job/' + job)
        b.textContent = `Lendo… ${j.progresso.fase || ''} ${j.progresso.feitos || 0}/${j.progresso.total || '…'}`
        if (prog) prog.textContent = b.textContent   // o botão pode estar dentro do menu fechado: o progresso aparece na coluna Etapa
        if (j.estado !== 'rodando') { if (j.estado === 'erro') throw new Error(j.erro); break }
        await new Promise(r => setTimeout(r, 2000))
      }
      toast('Dados da conta lidos'); carregar()
    } catch (e) { toastErro('Não foi possível ler a conta: ' + e.message); b.disabled = false; b.textContent = rot; if (prog) prog.textContent = '' }
  })
  lista.querySelectorAll('[data-diag]').forEach(b => b.onclick = () => { fecharMenu(b); resumo(b.dataset.diag) })
}

// Resumo rápido: 6 números dos últimos 28 dias + leitura causal, na linha tr#dx-<id>
async function resumo(id) {
  const tr = $('dx-' + id), box = $('dxbox-' + id)
  tr.hidden = false; box.innerHTML = '<span class="mudo">Consultando a API do Mercado Livre…</span>'
  const fechar = '<div class="direita mt-2"><button class="btn btn-fantasma btn-p" type="button" data-fechar>Fechar</button></div>'
  try {
    const dx = await api('/api/comercial/diagnostico?id=' + encodeURIComponent(id))
    if (!dx.disponivel) box.innerHTML = `<span class="mudo">${esc(dx.motivo)}</span>${fechar}`
    else {
      const n = dx.numeros.atual, a = dx.numeros.anterior
      const delta = (x, y) => (x != null && y) ? ` <span class="${x >= y ? 'pos' : 'neg'}">${x >= y ? '+' : ''}${Math.round((x - y) / y * 100)}%</span>` : ''
      box.innerHTML = `<b>${esc(dx.prospecto.empresa)}</b> · últimos 28 dias completos (${brData(dx.janela_atual.de)} a ${brData(dx.janela_atual.ate)})${dx.numeros.parcial ? ' <span class="selo atencao">amostra parcial</span>' : ''}
        <div class="kv">
          <div><b>${fmtR(n.faturamento)}</b><span>faturamento${delta(n.faturamento, a?.faturamento)}</span></div>
          <div><b>${fmtN(n.vendas)}</b><span>pedidos${delta(n.vendas, a?.vendas)}</span></div>
          <div><b>${fmtN(n.visitas)}</b><span>visitas${delta(n.visitas, a?.visitas)}</span></div>
          <div><b>${n.conversao != null ? n.conversao + '%' : '—'}</b><span>conversão</span></div>
          <div><b>${fmtR(n.ticket)}</b><span>ticket médio</span></div>
          <div><b>${fmtN(n.vendas_canceladas)}</b><span>cancelamentos</span></div>
        </div>
        <div class="mt-2"><b>Leitura causal:</b> ${esc(dx.leitura)}</div>
        ${dx.causalidade?.investigar?.length ? `<div class="mudo peq mt-2"><b>Onde a consultoria ataca primeiro:</b> ${dx.causalidade.investigar.slice(0, 5).map(esc).join(' · ')}</div>` : ''}
        <div class="mudo peq mt-2">${esc(dx.nota)}</div>${fechar}`
    }
  } catch (e) { box.innerHTML = `<span class="mudo">${esc(e.message)}</span>${fechar}` }
  box.querySelector('[data-fechar]').onclick = () => { tr.hidden = true }
}

// fallback quando a área de transferência não está disponível: o link num diálogo, selecionado para copiar
function mostrarLink(link) {
  const d = document.createElement('dialog'); d.className = 'dlg'
  d.innerHTML = `<form method="dialog"><h2>Link de conexão</h2><p>Não foi possível copiar sozinho. Selecione e copie:</p>
    <div class="campo mt-2"><label for="lnkCopia">Link</label><input id="lnkCopia" readonly></div>
    <div class="dlg-rodape"><button class="btn">Fechar</button></div></form>`
  d.querySelector('input').value = link
  document.body.append(d); d.showModal(); d.querySelector('input').select()
  d.addEventListener('close', () => d.remove(), { once: true })
}

function abrirNovo() { const d = document.querySelector('details.novo'); d.open = true; $('pNome').focus() }

// ── link único universal (16/10/2026): https://<host público>/ → formulário → ML → resultado. Opcional: UTMs montam o link da campanha. /conectar = sem formulário ──
const hostPublico = () => dados?.host_publico || 'diagnosticomeli.place2u.com.br'
function abrirLinkPublico() {
  const base = `https://${hostPublico()}/`
  const d = document.createElement('dialog'); d.className = 'dlg'
  d.innerHTML = `<form method="dialog"><h2>Link do formulário público</h2><p>O link que a pessoa clica: preenche o formulário, conecta o Mercado Livre e vê o resultado.</p>
    <div class="campo mt-2"><label for="lpUrl">Link</label><input id="lpUrl" readonly></div>
    <div class="form-grade mt-2">
      <div class="campo"><label for="lpSource">utm_source</label><input id="lpSource" placeholder="instagram"></div>
      <div class="campo"><label for="lpMedium">utm_medium</label><input id="lpMedium" placeholder="social"></div>
      <div class="campo col2"><label for="lpCampaign">utm_campaign</label><input id="lpCampaign" placeholder="diagnostico-out"></div>
    </div>
    <p class="mudo peq mt-2">Link direto sem formulário: <code id="lpConectar"></code> <span class="mudo">(o cadastro nasce como «Visitante» e ganha o apelido da conta)</span></p>
    <div class="dlg-rodape"><button class="btn" type="button" data-copiar>Copiar link</button><button class="btn" value="fechar">Fechar</button></div></form>`
  const url = () => { const u = new URL(base); for (const [k, id] of [['utm_source', 'lpSource'], ['utm_medium', 'lpMedium'], ['utm_campaign', 'lpCampaign']]) { const v = d.querySelector('#' + id).value.trim(); if (v) u.searchParams.set(k, v) } return u.toString() }
  const atualizar = () => { d.querySelector('#lpUrl').value = url(); d.querySelector('#lpConectar').textContent = url().replace(`https://${hostPublico()}/`, `https://${hostPublico()}/conectar`) }
  d.querySelectorAll('input:not([readonly])').forEach(i => i.oninput = atualizar); atualizar()
  d.querySelector('[data-copiar]').onclick = async b => { try { await navigator.clipboard.writeText(url()); b.target.textContent = 'Copiado'; setTimeout(() => { b.target.textContent = 'Copiar link' }, 1500) } catch { d.querySelector('#lpUrl').select() } }
  document.body.append(d); d.showModal(); d.querySelector('#lpUrl').select()
  d.addEventListener('close', () => d.remove(), { once: true })
}
$('btLinkPublico').onclick = abrirLinkPublico

// ── apagar cadastros de teste: prévia (lista) → confirmar com o nome de quem apaga (líder/dono) ──
const lerPor = () => { try { return localStorage.getItem('ps_perfil_por') || '' } catch { return '' } }
async function apagarTestes() {
  const por = (lerPor() || prompt('Seu nome (líder ou dono da Place2u):') || '').trim()
  if (!por) return
  try { localStorage.setItem('ps_perfil_por', por) } catch { /* sem armazenamento */ }
  try {
    const prev = await api('/api/comercial/apagar-testes', { por })
    if (!prev.total) return toast('Nenhum cadastro de teste para apagar.')
    const lista = prev.cadastros.slice(0, 8).map(c => `${c.nome} · ${c.empresa} · ${c.email || 'sem e-mail'} (${c.motivo})`).join('\n') + (prev.total > 8 ? `\n… e mais ${prev.total - 8}` : '')
    if (!await confirmar({ titulo: `Apagar ${prev.total} cadastro(s) de teste?`, texto: `Só leads públicos SEM conexão com e-mail repetido 3× ou domínio/nome de teste. Os conectados ficam (remova pelo menu ⋯).\n\n${lista}`, rotuloOk: 'Apagar', perigo: true })) return
    const r = await api('/api/comercial/apagar-testes', { por, confirmar: true })
    toast(`${r.apagados} cadastro(s) de teste apagado(s)`); carregar()
  } catch (e) { toastErro('Não foi possível apagar: ' + e.message) }
}
$('btApagarTestes').onclick = apagarTestes

$('fNovo').onsubmit = async e => {
  e.preventDefault()
  const bt = e.target.querySelector('.bt'); bt.disabled = true
  try {
    await api('/api/comercial/prospectos', { nome: $('pNome').value, empresa: $('pEmpresa').value, email: $('pEmail').value, telefone: $('pFone').value })
    e.target.reset(); e.target.closest('details').open = false
    toast('Prospect cadastrado. Copie o link de conexão na lista.'); carregar()
  } catch (err) { toastErro('Não foi possível cadastrar: ' + err.message) } finally { bt.disabled = false }
}
montarFiltros()   // monta o filtro (lê ?f= da URL) e dispara a 1ª carga via aoAplicar
