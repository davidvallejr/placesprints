const $ = id => document.getElementById(id)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const brData = iso => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—'
const fmtCnpj = v => { const d = String(v || '').replace(/\D/g, ''); return d.length === 14 ? d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') : v }
const api = async (url, body) => {
  const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.erro || 'erro ' + r.status)
  return j
}
// toast e confirmação do shell, com fallback nativo quando o shell não carregou
const toast = (t, tipo) => window.PS?.toast ? PS.toast(t, tipo) : alert(t)
const confirmar = o => (window.PS?.confirmar ?? (x => Promise.resolve(confirm(x.titulo + (x.texto ? '\n\n' + x.texto : '')))))(o)
// estados por bloco (5.8): skeleton no formato, erro com "Tentar de novo"
const SK = (...cls) => `<div aria-busy="true">${cls.map(c => `<div class="${c}"></div>`).join('')}</div>`
const erroBloco = (alvo, e, denovo) => {
  alvo.innerHTML = `<div class="erro-bloco"><b>Não foi possível carregar</b><div>${esc(e.message)}</div><button class="btn btn-p" type="button" data-denovo>Tentar de novo</button><details><summary>Detalhe técnico</summary><pre>${esc(e.stack || e.message)}</pre></details></div>`
  alvo.querySelector('[data-denovo]').onclick = denovo
}

// ── busca com debounce (mín. 3 caracteres; o servidor devolve no máx. 12) ──
let timer = null, selIdx = -1, buscaSeq = 0
$('q').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(buscar, 220) })
$('btnBuscar').onclick = buscar
$('q').addEventListener('keydown', e => {
  if ($('resultados').hidden) return                       // lista oculta nunca responde a Enter/setas
  const itens = document.querySelectorAll('.res-item')
  if (e.key === 'ArrowDown') { selIdx = Math.min(selIdx + 1, itens.length - 1); marca(itens); e.preventDefault() }
  else if (e.key === 'ArrowUp') { selIdx = Math.max(selIdx - 1, 0); marca(itens); e.preventDefault() }
  else if (e.key === 'Enter') { if (itens[selIdx]) itens[selIdx].click(); else if (itens[0]) itens[0].click() }
  else if (e.key === 'Escape') { $('resultados').hidden = true; $('resultados').innerHTML = '' }
})
const marca = itens => itens.forEach((el, i) => el.classList.toggle('ativo', i === selIdx))
document.addEventListener('click', e => { if (!e.target.closest('.busca-wrap')) { $('resultados').hidden = true; $('resultados').innerHTML = '' } })

async function buscar() {
  const q = $('q').value.trim()
  const box = $('resultados')
  selIdx = -1
  if (q.replace(/\D/g, '').length < 3 && q.length < 3) { box.hidden = true; box.innerHTML = ''; return }
  const meuId = ++buscaSeq
  try {
    const { resultados } = await api('/api/clientes/busca?q=' + encodeURIComponent(q))
    if (meuId !== buscaSeq) return                          // resposta velha nunca sobrescreve a mais nova
    box.hidden = false
    box.innerHTML = resultados.length ? resultados.map(c => `
      <button class="res-item" type="button" data-c="${esc(c.cliente)}">
        <span><b>${esc(c.cliente)}</b>
          <span class="sub">${[c.cnpj ? 'CNPJ ' + esc(fmtCnpj(c.cnpj)) : '', c.consultor ? esc(c.consultor) : 'consultor a definir', c.canais.join(' · ')].filter(Boolean).join(' · ')}</span>
        </span>
        <span class="lado">${c.elegivel ? `<span class="pill-mini">${esc(c.tier || 'ativo')}</span>` : '<span class="pill-mini alerta">sem base de tarefas</span>'}</span>
      </button>`).join('')
      : '<div class="res-vazio"><b>Nenhum cliente com esse nome ou CNPJ.</b> Confira a grafia ou tente outro trecho.</div>'
    box.querySelectorAll('.res-item').forEach(b => b.onclick = () => abrirCliente(b.dataset.c))
  } catch (e) { box.hidden = false; box.innerHTML = `<div class="res-vazio">${esc(e.message)}</div>` }
}

// ── página do cliente ───────────────────────────────────────────────────────
const FILTROS = [
  { k: 'todas', rotulo: 'Todas', f: () => true },
  { k: 'alto', rotulo: 'Alto impacto', f: a => a.carac.alto_impacto },
  { k: 'curto', rotulo: 'Curto prazo', f: a => a.carac.curto_prazo },
  { k: 'longevo', rotulo: 'Longevo', f: a => a.carac.longevo },
  { k: 'p01', rotulo: 'P0 + P1', f: a => ['P0', 'P1'].includes(a.prioridade.p) },
  { k: 'fato', rotulo: 'Só fatos', f: a => a.carac.fato },
]
const NOME_CANAL = { ML: 'Mercado Livre', SHO: 'Shopee', TTK: 'TikTok Shop', AMZ: 'Amazon', MGL: 'Magalu', SHE: 'Shein' }
const ABAS = [['resumo', 'Resumo'], ['do-cliente', 'Pelo cliente'], ['plano', 'Plano'], ['executar', 'Execução no ML'], ['anuncios', 'Anúncios'], ['produtos', 'Produtos e estoque'], ['relatorios', 'Ciclos do negócio'], ['estrategia', 'Estratégia'], ['empresa', 'Empresa'], ['configurar', 'Configurar cliente']]
const VIVOS = ['ficha', 'perfil', 'catalogo', 'cad-corpo', 'vendas', 'planoConta', 'retro', 'acomp', 'folha', 'impacto', 'fltAnuncios', 'anuncios', 'produtos', 'executar', 'relatoriosCiclo', 'precos', 'ofertas', 'dependencias', 'doCliente', 'movidosEquipe', 'chaveiro', 'saude', 'relatorio', 'pendencias', 'faixaPendencias', 'alertasCliente', 'notion', 'gatilhos', 'avisos', 'custosUpload', 'custosEstado', 'alinhamentos', 'perfilInfo', 'dossie', 'risco', 'contrato']   // contêineres preservados entre redesenhos do mesmo cliente
const PAGINA = 50
let dados = null, ativos = new Set(['todas']), retro = null, planoVisao = 'cliente', limiteAcoes = PAGINA, nPlanoConta = null, nDep = null, acompN = null, folhaN = null, anN = null, doCli = null, planoQuem = 'equipe'
const abertos = a => a.filter(x => ['proposta', 'aprovada', 'distribuida'].includes(x.status))
const p0Abertas = a => a.filter(x => x.prioridade.p === 'P0' && !['descartada', 'obsoleta'].includes(x.status)).length
const brlAbrev = v => v == null ? '—' : Math.abs(v) >= 1e6 ? 'R$ ' + (v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mi' : Math.abs(v) >= 1e3 ? 'R$ ' + Math.round(v / 1e3).toLocaleString('pt-BR') + ' mil' : 'R$ ' + Math.round(v).toLocaleString('pt-BR')
const xTxt = v => '×' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pctTxt = v => v == null ? '—' : (v > 0 ? '+' : '') + Number(v).toLocaleString('pt-BR', { maximumFractionDigits: v >= 10 || v <= -10 ? 0 : 1 }) + '%'

let painelSeq = 0
async function abrirCliente(nome, empurrar = true) {
  const seq = ++painelSeq
  $('resultados').hidden = true
  $('telaBusca').hidden = true
  const main = $('telaCliente')
  main.hidden = false
  main.innerHTML = SK('sk-linha', 'sk-kpi', 'sk-tabela')
  if (empurrar) { const u = new URLSearchParams(location.search), q = new URLSearchParams({ cliente: nome }); for (const k of ['aba', 'sec', 'rc', 'visao']) if (u.get(k)) q.set(k, u.get(k)); history.pushState({ c: nome }, '', '/cliente?' + q) }   // aba, sec, rc e visao da URL seguem com o cliente novo (deep link do shell)
  try {
    const r = await api('/api/cliente/painel?cliente=' + encodeURIComponent(nome))
    if (seq !== painelSeq) return                       // chegou atrasada: outro cliente já foi aberto
    dados = r
  } catch (e) {
    if (seq !== painelSeq) return
    main.innerHTML = `<button class="volta btn-fantasma btn-p" type="button" onclick="voltar()">← Clientes</button>
      <div class="erro-bloco"><b>Não foi possível carregar</b><div>${esc(e.message)}</div><button class="btn btn-p" type="button" data-denovo>Tentar de novo</button></div>`
    main.querySelector('[data-denovo]').onclick = () => abrirCliente(nome, false)
    return
  }
  ativos = new Set(['todas']); limiteAcoes = PAGINA; planoVisao = 'cliente'; nPlanoConta = null; nDep = null; acompN = null; folhaN = null; anN = null; doCli = null; planoQuem = 'equipe'
  if (retro?.cliente !== nome) retro = null
  desenhar()
}
function voltar(empurrar = true) {
  $('telaCliente').hidden = true; $('telaBusca').hidden = false
  try { localStorage.removeItem('ps_cliente') } catch {}   // «trocar de cliente» esquece o último
  if (empurrar) history.pushState({}, '', '/cliente')
  $('q').focus()
}
window.voltar = voltar
window.addEventListener('popstate', () => {
  const c = new URLSearchParams(location.search).get('cliente')
  c ? abrirCliente(c, false) : voltar(false)
})
// resultado do cliente chega pela retroalimentação (acomp.js) e alimenta o veredito e o KPI
document.addEventListener('ps:retro', e => {
  if (e.detail.cliente !== dados?.cliente) return
  retro = e.detail
  desenharVeredito()
})
// contadores das abas: Resumo = quantas tarefas pioraram (ps:acomp, de acomp.js; só com piora); Anúncios = anúncios da conta (buscarAnuncios), como Plano = ações abertas
document.addEventListener('ps:acomp', e => {
  if (e.detail.cliente !== dados?.cliente) return
  acompN = e.detail
  desenharContadores()
})
function desenharContadores() {
  const dc = $('nDoCliente'); if (dc) dc.textContent = doCli ? intPt(doCli.resumo?.total ?? 0) : ''   // aba Do cliente = pontos abertos do cliente (GET /api/cliente/do-cliente)
  const p = $('nPiorou'), a = $('nAnuncios'), n = acompN?.piorou || 0
  if (p) { p.hidden = !n; p.textContent = n === 1 ? '1 piorou' : `${n} pioraram` }
  if (a) a.textContent = anN != null ? intPt(anN) : ''
}

// quando a janela curta (7d) e a longa (28d) divergem, a tela reconcilia em vez de parecer contradição
function reconcilia(d) {
  const t = d.execucao.tendencia, ca = d.execucao.causalidade
  if (!t || t.indice == null || !ca) return ''
  if (t.indice >= 1.05 && ca.ruptura) return 'recuperação recente (7d) dentro de uma janela de 28d ainda em queda'
  if (t.indice <= 0.95 && !ca.ruptura) return 'queda recente (7d) que a janela de 28d ainda não reflete'
  return ''
}
const seloTend = cls => ({ 'CRESCIMENTO FORTE': 'bom', CRESCIMENTO: 'bom', 'ESTÁVEL': 'neutro', QUEDA: 'atencao', 'QUEDA CRÍTICA': 'ruim' }[cls] || 'neutro')
const pontoTend = cls => ({ 'CRESCIMENTO FORTE': 'bom', CRESCIMENTO: 'bom', QUEDA: 'alerta', 'QUEDA CRÍTICA': 'ruim' }[cls] || '')

// ── veredito + KPIs (5.1/5.4): a frase reconcilia resultado (vendas) e execução (equipe) ──
function fraseVeredito(d) {
  const t = d.execucao.tendencia, idx = t?.indice
  const exec = idx == null ? 'sem base para ler o ritmo da execução'
    : idx <= 0.95 ? `a execução caiu para <b>${xTxt(idx)} do ritmo</b>`
    : idx >= 1.05 ? `a execução acelerou para <b>${xTxt(idx)} do ritmo</b>` : 'a execução segue <b>no ritmo</b>'
  const execRuim = idx != null && idx <= 0.95, execBoa = idx == null || idx > 0.95
  if (!d.vendas?.disponivel) return `Sem o Mercado Livre conectado só a execução é lida: ${exec}.`
  if (!retro) return `Lendo o faturamento do canal… Enquanto isso, ${exec}.`
  if (retro.erro || retro.estado == null) return `A leitura de vendas não respondeu; ${exec}.`
  const n = retro.janela_dias || 14, v = retro.delta
  const mes28 = retro.estado28 && retro.estado28 !== retro.estado ? ` (mês de 28 dias ${({ queda: 'em queda', estagnacao: 'estável', crescimento: 'em alta' })[retro.estado28] || retro.estado28})` : ''
  const res = retro.estado === 'sem_base' ? 'Sem base para ler o faturamento'
    : retro.estado === 'estagnacao' ? `Faturamento <b>estável em ${n} dias</b> (${pctTxt(v)})${mes28}`
    : `Faturamento <b>${pctTxt(v)} em ${n} dias</b>${mes28}`
  const vendeBem = retro.estado === 'crescimento', vendeMal = retro.estado === 'queda'
  const fecho = vendeBem && execRuim ? 'Proteger o ritmo antes de escalar.'
    : vendeMal && execRuim ? 'Destravar a execução é a prioridade.'
    : vendeMal && execBoa ? 'A execução não explica a queda: olhar as vendas.'
    : vendeBem && execBoa ? 'Manter o ritmo e escalar o que funciona.' : ''
  const liga = (vendeBem && execRuim) || (vendeMal && execBoa) ? ', mas ' : ' e '
  return `${res}${liga}${exec}. ${fecho}`.trim()
}
function kpiResultado(d) {
  const v = d.vendas
  if (!v?.disponivel) return `<div class="rotulo">Resultado do cliente</div><div class="valor sem">—</div><div class="detalhe"><a href="/integracoes">Conectar Mercado Livre</a></div>`
  if (!retro) return SK('sk-kpi')
  const fat = v.atual?.disponivel ? v.atual.faturamento : null, ant = v.anterior?.disponivel ? v.anterior.faturamento : null
  const d28 = fat != null && ant ? (fat / ant - 1) * 100 : null
  // o badge fica em linha própria (sem " · " solto quando quebra a 375px)
  const badge = retro.estado && retro.estado !== 'sem_base' ? `<div class="detalhe"><span class="ac-badge ac-${esc(retro.estado)}">${esc(retro.rotulo || retro.estado)}${retro.forca === 'forte' ? ' forte' : ''}</span></div>` : retro.erro ? '<div class="detalhe">leitura indisponível</div>' : ''
  return `<div class="rotulo">Resultado do cliente</div><div class="valor${fat == null ? ' sem' : ''}">${brlAbrev(fat)}</div>
    <div class="detalhe" title="faturamento dos últimos 28 dias no Mercado Livre; o estado vem da retroalimentação (14 dias)">${d28 != null ? `<span class="${d28 >= 0 ? 'pos' : 'neg'}">${pctTxt(d28)}</span> vs 28 dias anteriores` : 'faturamento de 28 dias'}</div>${badge}`
}
function desenharVeredito() {
  const d = dados, kr = $('kpiResultado'); if (!d || !kr) return
  $('veredito').innerHTML = fraseVeredito(d)
  kr.className = 'kpi ' + (!d.vendas?.disponivel || !retro ? '' : ({ crescimento: 'bom', estagnacao: 'alerta', queda: 'ruim' })[retro.estado] || '')
  kr.innerHTML = kpiResultado(d)
  desenharRegua(d)
}
// régua do veredito: execução da equipe × meta (entregas projetadas / meta do mês). Sem meta, a proporção real é o ritmo de 7 dias
// (m7 / m7 anterior) sem marco; sem dado, PS.regua esconde (valor não numérico). Chamada sempre que o veredito é recalculado.
function desenharRegua(d) {
  if (!window.PS?.regua) return
  const ex = d.execucao, idx = ex?.tendencia?.indice, proj = ex?.mes?.projecao, pm = d.probabilidade_meta
  const meta = pm?.tem_meta ? Number(pm.meta) : Number(pm?.metas?.entregas) || null
  const rotulo = Number.isFinite(proj) ? `${idx != null ? xTxt(idx) + ' do ritmo ' : ''}(${ex.mes.realizado} → ${Math.round(proj)} projetadas)` : ''
  if (meta > 0 && Number.isFinite(proj)) PS.regua('regua', { valor: Math.min(100, 100 * proj / meta), marco: 100, rotulo, rotuloMarco: `meta ${meta}` })
  else PS.regua('regua', { valor: idx != null ? Math.min(100, idx * 100) : NaN, rotulo })
}
function kpisHtml(d) {
  const ex = d.execucao, t = ex.tendencia, p0 = p0Abertas(d.acoes), pm = d.probabilidade_meta
  const renov = d.renovacao.alerta[0] || d.renovacao.itens.find(i => i.dias != null && i.dias >= 0) || d.renovacao.itens[0]
  const renovTxt = !renov ? 'sem vencimento registrado' : renov.dias == null ? `renovação com data inválida (${esc(renov.canal)})` : renov.dias < 0 ? `renovação vencida há ${-renov.dias} dias` : `renovação em ${renov.dias} dias`
  const risco = p0 ? 'risco' : renov && renov.dias != null && renov.dias < 0 ? 'ruim' : 'bom'
  return `
    <div class="kpi" id="kpiResultado"></div>
    <div class="kpi ${pontoTend(t.classe)}"><div class="rotulo">Execução da equipe</div><div class="valor num">${ex.mes.realizado} → ${Math.round(ex.mes.projecao)}</div>
      <div class="detalhe" title="${esc([`projeção = ${ex.mes.realizado} feitas + ${ex.mes.velocidade}/dia (30d 20%, 14d 30%, 7d 50%) × ${ex.mes.diasRestantes} dias`, reconcilia(d)].filter(Boolean).join(' · '))}">feitas e projetadas no mês${pm.tem_meta ? ` · meta ${pm.meta}` : ''} · ${t.indice != null ? `${xTxt(t.indice)} em 7 dias` : 'sem base de 7 dias'}</div></div>
    <div class="kpi ${risco}"><div class="rotulo">Risco</div><div class="valor num">${p0}</div><div class="detalhe">P0 abertas · ${renovTxt}</div></div>`
}

// ── abas da página: só escondem; a URL guarda ?aba= por replaceState (nunca pushState nem hash) ──
function mostrarAba(aba) {
  if (!ABAS.some(a => a[0] === aba)) aba = 'resumo'
  const u = new URLSearchParams(location.search), sec = u.get('sec'), painelSec = sec ? $(sec)?.closest('[data-painel]')?.dataset.painel : null
  // ?sec= de outro painel: vindo da URL vale o painel onde o bloco mora (links com aba= antiga quando um bloco muda de aba); ao trocar de aba na página o sec cai
  if (painelSec && painelSec !== aba) { if (aba === (u.get('aba') || 'resumo')) aba = painelSec; else u.delete('sec') }
  document.querySelectorAll('[data-aba-cli]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.abaCli === aba)))
  document.querySelectorAll('[data-painel]').forEach(s => { s.hidden = s.dataset.painel !== aba })
  if (aba === 'executar') carregarExecutar()                                   // aba Executar (Chaveiro F4+): console de execução, carregado só quando a aba abre
  if (aba === 'produtos') carregarProdutos()                                   // aba Produtos (V3 F2, sombra): carrega só quando aberta — chama o diagnóstico no servidor
  if (aba === 'relatorios') carregarRelatoriosCiclo()                          // aba Relatórios (V3 F9): os 8 relatórios, carregados só quando a aba abre
  if ((u.get('aba') !== aba || (sec && !u.has('sec'))) && dados) { u.set('cliente', dados.cliente); u.set('aba', aba); history.replaceState(history.state, '', '/cliente?' + u.toString()) }
}
function mostrarPlano(v) {
  planoVisao = v
  document.querySelectorAll('[data-plano]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.plano === v)))
  document.querySelectorAll('[data-subpainel]').forEach(s => { s.hidden = s.dataset.subpainel !== v })
}

// ── próximas ações: as 5 P0/P1 em proposta com maior nota; os mesmos data-st/data-id do plano ──
function desenharProximas() {
  const alvo = $('proximasAcoes'); if (!alvo || !dados) return
  const lista = dados.acoes.filter(a => a.status === 'proposta' && ['P0', 'P1'].includes(a.prioridade.p)).sort((x, y) => y.prioridade.nota - x.prioridade.nota).slice(0, 5)
  const total = abertos(dados.acoes).length
  alvo.innerHTML = (lista.length ? lista.map(a => `
    <div class="acao"><div class="acao-topo">
      <span class="p-badge p-${esc(a.prioridade.p)}">${esc(a.prioridade.p)}</span>
      <div class="acao-corpo"><b>${esc(a.titulo)}</b>${ehDoCliente(a) ? ` <a class="selo atencao" href="/cliente?cliente=${encodeURIComponent(dados.cliente)}&amp;aba=do-cliente" data-ir-aba="do-cliente" title="depende do cliente: acompanhe na aba Do cliente">do cliente</a>` : ''}<div class="acao-meta"><span>Prazo ${brData(a.prazo)}</span><span>${esc(a.responsavel || 'a definir')}</span><span>${esc(a.canal || 'Geral')}</span></div></div>
      <div class="acao-lado"><div class="acao-botoes"><button class="btn-mini ok" type="button" data-id="${esc(a.id)}" data-st="aprovada">Aprovar</button><button class="btn-mini no" type="button" data-id="${esc(a.id)}" data-st="descartada">Descartar</button></div></div>
    </div></div>`).join('')
    : `<div class="vazio-box"><b>Nenhuma ação P0 ou P1 aguardando decisão.</b>${total ? 'As demais ações estão na aba Plano.' : 'Gere o plano deste cliente na Distribuição.'}</div>`) +
    (total ? `<button class="btn btn-fantasma mt-2" type="button" data-ver-plano>Ver todas as ${total} ações</button>` : '')
  alvo.querySelector('[data-ver-plano]')?.addEventListener('click', () => { mostrarPlano('cliente'); mostrarAba('plano'); $('listaAcoes').scrollIntoView() })
  ligarDecisao(alvo)
}
function ligarDecisao(raiz) {
  raiz.querySelectorAll('[data-st]').forEach(b => b.onclick = async () => {
    b.disabled = true
    try {
      // descartar exige o motivo da lista e vira alinhamento com o cliente (diálogo em alinhamentos.js); reabrir encerra o alinhamento no servidor
      if (b.dataset.st === 'descartada') { if (!await window.PSAlinhamentos?.descartar({ ids: [b.dataset.id] })) { b.disabled = false; return } }
      else {
        // reabrir uma DESCARTADA encerra o alinhamento do descarte: o servidor exige quem decide (líder/consultor)
        const reabre = dados.acoes.find(x => x.id === b.dataset.id)?.status === 'descartada'
        const por = reabre ? await window.PSRelatorio?.ui?.pedirPor({ titulo: 'Reabrir ação descartada', texto: 'Reabrir encerra o alinhamento que o descarte registrou: a recomendação volta a valer.', rotuloOk: 'Reabrir' }) : ''
        if (reabre && !por) { b.disabled = false; return }
        await api('/api/planos/acoes/status', { ids: [b.dataset.id], status: b.dataset.st, ...(por ? { por } : {}) })
      }
      window.PSAlinhamentos?.montar($('alinhamentos'), dados.cliente)
      const a = dados.acoes.find(x => x.id === b.dataset.id)
      if (a) a.status = b.dataset.st
      desenhar()                                            // KPIs, veredito e contadores acompanham a decisão (sem refetch: contêineres reaproveitados)
    } catch (e) { toast(e.message, 'erro'); b.disabled = false }
  })
}

// ── registrar resultado: um diálogo com 3 campos no lugar dos 3 prompt() ──
function dialogoResultado() {
  let d = $('dlgResultado')
  if (d) return d
  d = document.createElement('dialog'); d.className = 'dlg'; d.id = 'dlgResultado'
  d.innerHTML = `<form method="dialog"><h2>Registrar resultado</h2><p class="mudo">Fica no histórico da ação, como antes e depois.</p>
    <label class="campo">Métrica antes da ação<input name="antes" required placeholder="ex.: conversão 0,8%"><span class="ajuda-campo">Obrigatório. Linha de base.</span></label>
    <label class="campo">Métrica depois<input name="depois" required placeholder="medida no mesmo período equivalente"><span class="ajuda-campo">Obrigatório.</span></label>
    <label class="campo">O que foi feito<input name="observacao" placeholder="opcional"></label>
    <div class="dlg-rodape"><button class="btn" type="button" value="nao" data-fecha>Cancelar</button><button class="btn" type="submit" value="sim">Registrar</button></div></form>`
  d.querySelector('[data-fecha]').onclick = () => d.close('nao')
  document.body.append(d)
  return d
}
function registrarResultado(id) {
  const d = dialogoResultado(), f = d.querySelector('form')
  f.reset(); d.showModal()
  d.addEventListener('close', async () => {
    if (d.returnValue !== 'sim') return
    const v = new FormData(f)
    try { await api('/api/planos/acoes/resultado', { id, antes: v.get('antes'), depois: v.get('depois'), observacao: v.get('observacao') || '' }); toast('Resultado registrado no histórico da ação.') }
    catch (x) { toast(x.message, 'erro') }
  }, { once: true })
}

// ── motor de decisão (3 cartões compactos; fórmulas e pesos em title) ──
function cartaoProbabilidade(d) {
  const p = d.probabilidade_meta
  const avisoGmv = p.gmv_aguardando_canal ? `<p class="mini">Meta de GMV R$ ${Number(p.metas.gmv).toLocaleString('pt-BR')} registrada; o realizado depende do canal conectado (<a href="/integracoes">Integrações</a>).</p>` : ''
  if (!p.tem_meta) return `<p><b>Aguardando a meta do mês.</b> ${esc(p.motivo)}</p>${avisoGmv}`
  return `
    <p title="Score 0–100 com ritmo ${p.pesos?.ritmo ?? '—'}% + tendência ${p.pesos?.tendencia ?? '—'}% + conversão ${p.pesos?.conversao ?? '—'}% + tráfego ${p.pesos?.trafego ?? '—'}% + estoque ${p.pesos?.estoque ?? '—'}% + Ads ${p.pesos?.ads ?? '—'}%; renormalizado pelo que existe (cobertura ${p.cobertura}%)"><b>${p.score}/100</b> <span class="selo ${p.score >= 70 ? 'bom' : p.score >= 50 ? 'atencao' : 'ruim'}">${esc(p.classe)}</span></p>
    <p>Meta de <b>${p.meta} entregas</b> no mês: ${p.realizado} feitas, faltam ${p.gap}. Precisa de <b>${p.necessidade_diaria}/dia</b>; ritmo atual ×${p.indice_ritmo ?? '—'} da necessidade.</p>
    ${p.faltantes?.length ? `<p class="mini">Entram com o canal conectado: ${esc(p.faltantes.join(', '))}.</p>` : ''}${avisoGmv}`
}
function motorHtml(d) {
  const ex = d.execucao, t = ex.tendencia
  return `<div class="motor">
    <div class="cartao"><h3><span class="num">1</span>Previsão</h3>
      <p>Se nada mudar, o mês fecha com <b>${Math.round(ex.mes.projecao)} entregas</b> <span class="mini" title="${ex.mes.realizado} feitas + ${ex.mes.velocidade}/dia × ${ex.mes.diasRestantes} dias">(${ex.mes.realizado} feitas, ${ex.mes.diasRestantes} dias restantes)</span>.</p>
      <p class="mini">Tendência ${t.indice != null ? xTxt(t.indice) : 'sem base'}, ${esc(t.classe.toLowerCase())}. ${d.vendas.disponivel ? 'Vendas reais do canal na aba Anúncios.' : 'Com o canal conectado, a mesma conta roda sobre o faturamento real.'}</p></div>
    <div class="cartao ${d.probabilidade_meta.tem_meta ? '' : 'inativo'}"><h3><span class="num">2</span>Probabilidade</h3>${cartaoProbabilidade(d)}</div>
    <div class="cartao"><h3><span class="num">3</span>Causalidade</h3>
      ${ex.causalidade ? `<p>${esc(ex.causalidade.leitura)}</p>${ex.causalidade.causas?.length ? `<ul>${ex.causalidade.causas.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}` : '<p class="mini">Gere o plano para ligar a leitura causal da operação.</p>'}
      ${d.vendas.disponivel && d.vendas.causalidade?.leitura ? `<p class="mt-2"><b>Vendas:</b> ${esc(d.vendas.causalidade.leitura)}</p>
        ${d.vendas.causalidade.causal ? `<p class="mini">Evidência causal ${d.vendas.causalidade.causal.score}/100, ${esc(d.vendas.causalidade.causal.classe)} (nunca comprovada sem teste controlado).</p>` : ''}
        ${d.vendas.causalidade.investigar?.length ? `<ul>${d.vendas.causalidade.investigar.slice(0, 5).map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}`
      : `<p class="mini mt-2"><b>Vendas:</b> ${esc(d.vendas.motivo || 'canal não conectado')}. <a href="/integracoes">Integrações</a></p>`}</div>
  </div>`
}

// ── leitura estratégica (Merovíngio): tese, cadeia, 3 jogadas, falsificador recolhido ──
const TIPO_ELO = { fato: 'fato', hipotese: 'hipótese', projecao: 'projeção' }
function cartaoMerovingio(m) {
  if (!m) return '<div class="vazio-box"><b>Sem leitura estratégica ainda.</b>Gere o plano deste cliente para ligá-la.</div>'
  if (m.sem_leitura) return `<div class="vazio-box">${esc(m.motivo)}</div>`
  const elo = e => `<span class="elo"><span class="elo-t ${esc(e.tipo)}">${TIPO_ELO[e.tipo] || esc(e.tipo)}</span>${esc(e.elo)}</span>`
  return `
  <div class="cartao">
    <div class="linha"><b>${esc(m.arquetipo.rotulo)}</b>
      <span class="pill-mini">${m.critica.evidencia.pct_fato}% da leitura em fatos (${m.critica.evidencia.baseadas_em_fato}/${m.critica.evidencia.acoes_abertas} ações)</span>
      ${m.critica.plano_gerado_em ? `<span class="pill-mini" title="o estado (cadência, bloqueios) é lido ao vivo do banco; as ações vêm desta geração">plano de ${esc(brData(m.critica.plano_gerado_em))}</span>` : ''}</div>
    <p class="mt-2">${esc(m.arquetipo.tese)}</p>
    ${m.renovacao_no_relogio ? `<div class="aviso">${esc(m.renovacao_no_relogio)}</div>` : ''}
    <div class="cadeia">${m.cadeia_causal.map(elo).join('<span class="seta">→</span>')}</div>
    ${m.critica.sinais_mistos.length ? `<div class="mini mt-2">${m.critica.sinais_mistos.map(a => esc(a)).join('<br>')}</div>` : ''}
    <details class="evid"><summary>O que derrubaria esta leitura</summary>
      <div class="box"><div>${esc(m.falsificador)}</div><div class="mt-2">${esc(m.critica.limite)}</div></div>
    </details>
  </div>
  <div class="jogadas mt-4">
    ${m.caminho.jogadas.map((j, i) => `
    <div class="cartao jogada">
      <h3><span class="num">${i + 1}</span>${esc(j.rotulo)}</h3>
      <p class="mini">${esc(j.porque_antes)}</p>
      ${j.acoes.map(a => `<div class="jog-acao"><span class="p-badge p-${esc(a.p)}">${esc(a.p)}</span><span>${esc(a.titulo)}</span><span class="mini">${brData(a.prazo)}</span></div>`).join('')}
      ${j.mais ? `<div class="mini mt-2">+ ${j.mais} ação(ões) neste estágio</div>` : ''}
    </div>`).join('')}
  </div>
  ${m.caminho.jogadas_futuras.length ? `<div class="mini mt-2">Depois: ${m.caminho.jogadas_futuras.map(j => `${esc(j.rotulo)} (${j.n})`).join(' → ')}</div>` : ''}
  <div class="mini mt-2">Regra de ouro: ${esc(m.caminho.regra_de_ouro)}</div>`
}

function desenhar() {
  const d = dados, main = $('telaCliente'), y = scrollY
  const reusa = main.dataset.cliente === d.cliente && VIVOS.every(id => $(id))   // abrirCliente põe skeleton → reusa=false
  const vivos = reusa ? VIVOS.map(id => $(id)) : []
  const q = encodeURIComponent(d.cliente), nAbertas = abertos(d.acoes).length
  const aDecidir = d.acoes.filter(a => a.status === 'proposta' && ['P0', 'P1'].includes(a.prioridade.p)).length   // o mesmo recorte de Próximas ações
  const meta = [d.tier && esc(d.tier), d.canais.length && esc(d.canais.map(c => NOME_CANAL[c] || c).join(', ')), d.consultor ? esc(d.consultor) : '<span class="a-definir">Consultor a definir</span>', d.squad && esc(d.squad)]
    .filter(Boolean).map(x => `<span>${x}</span>`).join('')
  main.innerHTML = `
  <div class="pg-cab">
    <div class="pg-titulo">
      <button class="volta btn-fantasma btn-p" type="button" onclick="voltar()">← Clientes</button>
      <p class="pg-sobre">Cliente</p>
      <h1>${esc(d.cliente)}</h1>
      <p class="pg-meta">${meta}</p>
    </div>
    <div class="pg-acoes">
      <details class="menu"><summary class="btn" aria-label="Mais ações">⋯</summary><div class="menu-lista">
        <button type="button" id="btnPlacePlan" title="Cria a página do plano (capa + 5W2H) na base Informações do cliente no Notion">Criar PlacePlan no Notion</button>
        <button type="button" id="btnRelatorioAgora" title="Gera o relatório curto dos últimos 7 dias e envia à base Informações do cliente no Notion, depois da prévia">Enviar relatório ao Notion agora</button>
      </div></details>
      <details class="menu"><summary class="btn">Documentos</summary><div class="menu-lista">
        <a href="/plano?cliente=${q}" target="_blank" rel="noopener">Documento do plano</a>
        <a href="/plano.pdf?cliente=${q}" target="_blank" rel="noopener">PDF do plano</a>
        <hr>
        <a href="/plano-conta?cliente=${q}" target="_blank" rel="noopener">Plano por anúncio</a>
        <a href="/plano-conta.pdf?cliente=${q}" target="_blank" rel="noopener">PDF do plano por anúncio</a>
        <a href="/api/plano-conta/acoes.csv?cliente=${q}">Planilha CSV do plano por anúncio</a>
        <hr>
        <a href="/semanal?cliente=${q}" target="_blank" rel="noopener">Semanal do cliente</a>
        <a href="/semanal?cliente=${q}&amp;interno=1" target="_blank" rel="noopener">Semanal interno</a>
      </div></details>
      <button class="btn btn-primario" type="button" id="btnRevisar">Revisar plano${aDecidir ? ` (${aDecidir} a decidir)` : ''}</button>
    </div>
  </div>
  ${d.elegivel ? '' : `<div class="aviso"><b>Cliente fora da geração de planos.</b> Motivo: ${esc(d.motivo_inelegivel || 'não identificado')}.</div>`}

  <section class="veredito" aria-label="Resumo">
    <p class="veredito-frase" id="veredito"></p>
    <div class="regua" id="regua" hidden></div>
    <div class="kpis" id="kpis">${kpisHtml(d)}</div>
  </section>

  <ol class="passos passos-estatico" id="progresso" aria-label="Progresso do processo: as 10 etapas da cadeia" aria-busy="true"></ol>

  <nav class="abas abas-fixas" aria-label="Seções do cliente">${ABAS.map(([k, r]) => `<button type="button" data-aba-cli="${k}" aria-pressed="false">${r}${k === 'plano' ? ` <span class="n">${nAbertas}</span>`
    : k === 'do-cliente' ? ' <span class="n" id="nDoCliente" title="pontos abertos que dependem do cliente"></span>'
    : k === 'resumo' ? ' <span class="estado e-piorou" id="nPiorou" title="tarefas que pioraram (ajustado pelo controle), em Resultado das tarefas" hidden></span>'
    : k === 'anuncios' ? ' <span class="n" id="nAnuncios" title="anúncios da conta no Mercado Livre (coletados)"></span>' : ''}</button>`).join('')}</nav>

  <section data-painel="resumo">
    <div id="faixaPendencias" hidden></div>
    <section class="bloco" id="secProximas"><div class="bloco-cab"><h2>Próximas ações</h2><span class="sis" data-sistema="arquiteto" title="Sistema de origem: Arquiteto">Arquiteto</span><small class="sis-papel">· algoritmo</small></div><p class="sub">As P0 e P1 que aguardam decisão, por nota. Aprovar manda para a fila do Notion.</p><div id="proximasAcoes"></div></section>
    <section class="bloco" id="secChaveiro"><div class="bloco-cab"><h2>Execução do plano</h2><span class="sis" data-sistema="chaveiro" title="Sistema de origem: Chaveiro">Chaveiro</span><small class="sis-papel">· execução</small></div><p class="sub">Qual caminho cada ação do plano tem hoje: automático (o sistema aplica com aprovação e conferência), assistido (o sistema prepara, a equipe aplica), do cliente (vira pendência cobrada) ou sem caminho. A execução fica na aba Execução no ML: «Executar pelo Chaveiro» abre o console já preenchido.</p><div id="chaveiro">${SK('sk-kpi', 'sk-tabela')}</div></section>
    <section class="bloco" id="secSaude"><div class="bloco-cab"><h2>Saúde da conta no ML</h2><span class="sis" data-sistema="trinity" title="Sistema de origem: Trinity">Trinity</span><small class="sis-papel">· coleta</small></div><p class="sub">Reputação, envios atrasados, reclamações abertas e perguntas sem resposta, gravados uma vez por dia pela coleta. Sinal que a API não respondeu aparece como pendente com o motivo, nunca como zero. Nada é respondido ou despachado por esta tela.</p><div id="saude">${SK('sk-kpi', 'sk-tabela')}</div></section>
    <section class="bloco" id="secAcomp"><div class="bloco-cab"><h2>Resultado das tarefas</h2><span class="sis" data-sistema="merovingio" title="Sistema de origem: Merovíngio">Merovíngio</span><small class="sis-papel">· medição</small></div><p class="sub">Cada tarefa concluída com o anúncio: vendeu? aumentou? reduziu? visitas? Antes × 24h · 48h · 72h · 1 semana · hoje, descontado o que os anúncios sem tarefa fizeram. Piorou vem primeiro.</p><div id="acomp">${SK('sk-kpi', 'sk-tabela')}</div></section>
    <section class="bloco" id="secDependeCliente"><div class="bloco-cab"><h2>O que só o cliente faz <span class="badge" id="nDependencias">${nDep ?? '—'}</span></h2><span class="sis" data-sistema="arquiteto" title="Sistema de origem: Arquiteto">Arquiteto</span><small class="sis-papel">· algoritmo</small></div><p class="sub">O que só o cliente pode fazer, desde quando, o que acontece se atrasar e o possível impacto (só onde o sistema mede ou prevê). Quem cobra é o consultor. Visão unificada com plano, compras e avisos: <a href="/cliente?cliente=${q}&amp;aba=do-cliente" data-ir-aba="do-cliente">aba Pelo cliente</a>.</p><div id="pendencias">${SK('sk-tabela')}</div><div id="alertasCliente"></div><h3 class="mt-4">Tarefas aguardando o cliente</h3><div id="dependencias">${SK('sk-tabela')}</div></section>
    <section class="bloco" id="secAlinhamentos"><div class="bloco-cab"><h2>Combinados com o cliente</h2><span class="sis" data-sistema="arquiteto" title="Sistema de origem: Arquiteto">Arquiteto</span><small class="sis-papel">· algoritmo</small><button class="btn-icone btn-ajuda" type="button" aria-label="Como fazer: Combinados com o cliente" data-ajuda="alinhamentos"></button></div><p class="sub">O que foi combinado com o cliente e por isso não vira ação, aviso nem cobrança: anúncio pausado de propósito, campanha de visibilidade, anúncio de atração, produto descontinuado queimando estoque, ponto já conversado com o seller. Descartar uma ação do plano registra aqui, com o motivo. Revisão padrão em 30 dias; vencido volta ao plano como observar.</p><div id="alinhamentos">${SK('sk-tabela')}</div></section>
  </section>

  <section data-painel="do-cliente" hidden>
    <section class="bloco" id="secDoCliente"><div class="bloco-cab"><h2>Do cliente</h2><span class="sis" data-sistema="arquiteto" title="Sistema de origem: Arquiteto">Arquiteto</span><small class="sis-papel">· algoritmo</small></div><p class="sub">Tudo o que depende do cliente num lugar só: pendências medidas ou registradas, ações do plano com caminho do cliente, produtos a repor (a mesma conta do micro de compras), tarefas do Notion aguardando o retorno dele e o último aviso e resposta de cada ponto. O mesmo produto ou assunto aparece uma vez. Mover para o consultor tira o ponto daqui e o põe no filtro Equipe do Plano; nada é enviado por esta tela.</p><div id="doCliente">${SK('sk-kpi', 'sk-tabela')}</div></section>
    <section class="bloco" id="secGatilhos"><div class="bloco-cab"><h2>Avisos ao cliente: fila e recibos</h2><span class="sis" data-sistema="morpheus" title="Sistema de origem: Morpheus">Morpheus</span><small class="sis-papel">· comunicação</small><button class="btn-icone btn-ajuda" type="button" aria-label="Como fazer: Canais do cliente, fila e recibos" data-ajuda="canais_cliente"></button></div><p class="sub">O que o sistema identificou que depende do cliente (estoque, saúde da conta, preço, promoções, pendências) e vira aviso a ele: fila, último lote enviado e recibos por canal. Nada sai sem liberação de um líder e a chave geral ligada; o texto é fixo do catálogo e auditado antes de sair.</p><div id="gatilhos">${SK('sk-kpi', 'sk-tabela')}</div></section>
  </section>

  <section data-painel="plano" hidden>
    <div class="seg"><button type="button" data-plano="cliente" aria-pressed="true">Por cliente (${nAbertas})</button><button type="button" data-plano="anuncio" aria-pressed="false">Por anúncio<span id="nPlanoConta">${nPlanoConta != null ? `\u00a0(${nPlanoConta})` : ''}</span></button></div>
    <div data-subpainel="cliente">
      <div class="seg mt-2" id="segQuem" aria-label="De quem é a ação">${[['equipe', 'Equipe'], ['cliente', 'Cliente'], ['tudo', 'Tudo']].map(([k, r]) => `<button type="button" data-quem="${k}" aria-pressed="${planoQuem === k}">${r}</button>`).join('')}</div>
      <div id="movidosEquipe" hidden></div>
      <div class="filtros" id="filtros">${FILTROS.map(f => `<button class="f-chip${ativos.has(f.k) ? ' on' : ''}" type="button" data-k="${f.k}" aria-pressed="${ativos.has(f.k)}">${f.rotulo}</button>`).join('')}</div>
      <div class="n-acoes" id="nAcoes"></div>
      <div id="listaAcoes"></div>
    </div>
    <div data-subpainel="anuncio" hidden>
      <section class="bloco" id="secPlanoConta"><div class="bloco-cab"><h2>Plano por anúncio</h2><span class="sis" data-sistema="arquiteto" title="Sistema de origem: Arquiteto">Arquiteto</span><small class="sis-papel">· algoritmo</small><a class="btn btn-fantasma btn-p" href="/metodologia">Como o algoritmo funciona</a></div><p class="sub">Diagnóstico da conta, ações por anúncio priorizadas e a previsão de faturamento por hipótese.</p><div id="planoConta">${SK('sk-kpi', 'sk-tabela')}</div></section>
    </div>
  </section>

  <section data-painel="executar" hidden>
    <section class="bloco" id="secExecutar"><div class="bloco-cab"><h2>Executar</h2><span class="sis" data-sistema="chaveiro" title="Sistema de origem: Chaveiro">Chaveiro</span><small class="sis-papel">· execução</small><button class="btn-icone btn-ajuda" type="button" aria-label="Como fazer: Execução no Mercado Livre" data-ajuda="executor_chaveiro"></button></div><p class="sub">Console de execução: escolha anúncios, uma estratégia ou uma operação avulsa, veja a prévia campo a campo com a previsão do Oráculo e o que o Merovíngio vai medir, prepare, aprove, execute e acompanhe (preparada, aprovada, enviada, conferida, divergente, falhou, revertida). Nada sai para o Mercado Livre sem a chave geral, a chave da operação, a liberação do líder com o cliente informado, a estreia em 1 anúncio, a confirmação e a releitura ao vivo.</p><div id="executar">${SK('sk-kpi', 'sk-tabela')}</div></section>
  </section>

  <section data-painel="anuncios" hidden>
    <section class="bloco" id="secOfertas"><div class="bloco-cab"><h2>Ofertas: produzir anúncios</h2><span class="sis" data-sistema="arquiteto" title="Sistema de origem: Arquiteto">Arquiteto</span><small class="sis-papel">· algoritmo</small></div><p class="sub">Criar oferta nova ou otimizar a existente: importar anúncio ou planilha, diagnóstico pelo algoritmo, proposta versionada, aprovação campo a campo e publicação no canal com conferência. Cada oferta é uma ação do plano, medida pelo Merovíngio.</p><div id="ofertas"><div class="skeleton sk-tabela"></div></div></section>
    <section class="bloco" id="secAnuncios"><div class="bloco-cab"><h2>Anúncios no período</h2><span class="sis" data-sistema="trinity" title="Sistema de origem: Trinity">Trinity</span><small class="sis-papel">· coleta</small></div><p class="sub">Vendas, visitas e Ads por anúncio na data da venda escolhida, comparados com o período anterior e com o ano passado. O filtro recorta o que se vê; o plano continua lendo a conta inteira. Promoções, Ads, Full e a leitura por anúncio ficam logo abaixo: <a href="/cliente?cliente=${q}&amp;aba=anuncios&amp;sec=secFolha" data-ir-folha>ver na Folha do anúncio</a>.</p><div id="fltAnuncios"></div><div id="anuncios" class="mt-2">${SK('sk-kpi', 'sk-tabela')}</div></section>
    <section class="bloco" id="secPrecos"><div class="bloco-cab"><h2>Cronologia de preços</h2><span class="sis" data-sistema="smith" title="Sistema de origem: Smith">Smith</span><small class="sis-papel">· financeiro</small></div><p class="sub">Cada mudança de preço dos anúncios nos últimos 90 dias, com a tarefa que coincide e as vendas por dia 7 dias antes e depois. As maiores quedas vêm primeiro.</p><div id="precos">${SK('sk-tabela')}</div></section>
    <section class="bloco" id="secVendas"><div class="bloco-cab"><h2>Mais vendidos, como o comprador vê</h2><span class="sis" data-sistema="trinity" title="Sistema de origem: Trinity">Trinity</span><small class="sis-papel">· coleta</small></div><p class="sub">Os 12 anúncios que mais faturaram em 28 dias: vendas, visitas, conversão, preço, estoque, nota e avaliações, e o que os dados apontam em cada um.</p><div id="vendas">${SK('sk-tabela')}</div></section>
    <section class="bloco" id="secFolha"><div class="bloco-cab"><h2>Folha do anúncio <span class="badge" id="nFolha">${folhaN != null ? intPt(folhaN) : '—'}</span></h2><span class="sis" data-sistema="trinity" title="Sistema de origem: Trinity">Trinity</span><small class="sis-papel">· coleta</small></div><p class="sub">Uma linha por anúncio com o que você marcar: ofertas e promoções, Ads, Full e métricas do período. Com os quatro marcados, cada anúncio ganha uma leitura que junta os quatro com o plano. O filtro recorta o que se vê; o plano continua lendo a conta inteira. Dado não coletado aparece como —, nunca como zero.</p><div id="folha">${SK('sk-kpi', 'sk-tabela')}</div></section>
    <details class="recolhido" id="secImpacto"><summary>Detalhe da medição (janelas e controle) <span class="sis" data-sistema="merovingio" title="Sistema de origem: Merovíngio">Merovíngio</span><small class="sis-papel">· medição</small></summary><p class="sub">O que cada tarefa concluída parece ter gerado, comparado com anúncios que ninguém tocou. <a href="/resultados">Como medimos</a></p><div id="impacto">${SK('sk-tabela')}</div></details>
    <details class="recolhido"><summary>Calculadora: impressão, clique ou conversão</summary>
      <p class="sub">Cole os números do painel do canal (antes e depois) e a árvore aponta onde mexer: impressão, clique ou conversão.</p>
      <form id="fAnuncio">
        <div class="form-grade">
          ${[['impressoes', 'Impressões'], ['cliques', 'Cliques'], ['pedidos', 'Pedidos']].map(([k, r]) => `
            <label class="campo"><span class="pf-rot">${r} antes</span><input type="number" min="0" step="any" id="a_${k}_antes"></label>
            <label class="campo"><span class="pf-rot">${r} depois</span><input type="number" min="0" step="any" id="a_${k}_depois"></label>`).join('')}
          <label class="campo"><span class="pf-rot">Seu preço "de" (R$)</span><input type="number" min="1" step="any" id="a_meu_de"></label>
          <label class="campo"><span class="pf-rot">Seu preço "por" (R$)</span><input type="number" min="1" step="any" id="a_meu_por"></label>
          <label class="campo"><span class="pf-rot">Concorrente "de" (R$)</span><input type="number" min="1" step="any" id="a_conc_de"></label>
          <label class="campo"><span class="pf-rot">Concorrente "por" (R$)</span><input type="number" min="1" step="any" id="a_conc_por"></label>
          <label class="campo"><span class="pf-rot">Frete grátis</span><select id="a_frete"><option value="">não sei</option><option value="sim">sim</option><option value="nao">não</option></select></label>
          <label class="campo"><span class="pf-rot">Imagens no carrossel</span><input type="number" min="0" id="a_carrossel"></label>
        </div>
        <button class="btn mt-4" type="submit">Diagnosticar</button>
      </form>
      <div id="resAnuncio" class="mt-4"></div>
    </details>
  </section>

  <section data-painel="produtos" hidden>
    <section class="bloco" id="secProdutos"><div class="bloco-cab"><h2>Estoque por produto</h2><button class="btn-icone btn-ajuda" type="button" aria-label="Como fazer: Produto por trás do anúncio" data-ajuda="produto"></button></div><p class="sub">Anúncios do mesmo produto vendem do mesmo estoque no Mercado Livre: aqui o estoque é contado uma vez por produto e as vendas dos anúncios somam. Ainda não decide nada — chave desligada, ver Estrutura › Estruturas. Dado não lido aparece como —, nunca como zero.</p><div id="produtos">${SK('sk-kpi', 'sk-tabela')}</div></section>
  </section>

  <section data-painel="relatorios" hidden>
    <section class="bloco" id="secRelatoriosCiclo"><div class="bloco-cab"><h2>Os 8 ciclos do negócio</h2><span class="sis" data-sistema="morpheus" title="Sistema de origem: Morpheus">Morpheus</span><small class="sis-papel">· comunicação</small><button class="btn-icone btn-ajuda" type="button" aria-label="Como fazer: Os 8 ciclos do negócio" data-ajuda="relatorios_ciclo"></button></div><p class="sub">Os 8 relatórios do negócio: ciclo financeiro, ciclo de compras, ciclo de estoque, previsibilidade logística, escalabilidade, lucro, geração de caixa e reinvestimento. Cada linha responde três perguntas: o que vai acontecer (previsão em faixa), com que chance (só quando calibrada) e o que já foi medido. Dado ausente aparece como — com o motivo, nunca como zero. Uso interno: ao cliente nada muda.</p><div id="relatoriosCiclo">${SK('sk-tabela')}</div></section>
  </section>

  <section data-painel="estrategia" hidden>
    <section class="bloco"><div class="bloco-cab"><h2>Leitura da conta</h2><span class="sis" data-sistema="merovingio" title="Sistema de origem: Merovíngio">Merovíngio</span><small class="sis-papel">· medição</small></div><p class="sub">Leitura do Merovíngio: o padrão do cliente, a cadeia de causa e efeito e o melhor caminho.</p>${cartaoMerovingio(d.merovingio)}</section>
    <section class="bloco" id="secRetro"><div class="bloco-cab"><h2>O que a conta aprendeu</h2><span class="sis" data-sistema="oraculo" title="Sistema de origem: Oráculo">Oráculo</span><small class="sis-papel">· previsão</small></div><p class="sub">Queda, estagnação ou crescimento, o que funciona nesta conta e o que volta ao plano como prioridade.</p><div id="retro">${SK('sk-kpi', 'sk-tabela')}</div></section>
    <section class="bloco" id="secPrevisao"><div class="bloco-cab"><h2>Previsão do mês</h2><span class="sis" data-sistema="oraculo" title="Sistema de origem: Oráculo">Oráculo</span><small class="sis-papel">· previsão</small></div><p class="sub">Previsão, probabilidade e causalidade só com dados reais; o que falta aparece como pendência. As metas do mês ficam em Configurar cliente › Metas do mês.</p>${motorHtml(d)}</section>
  </section>

  <section data-painel="empresa" hidden>
    <h3 class="grupo-cfg">Raio-X e contrato</h3>
    <section class="bloco" id="secFinanceiro"><div class="bloco-cab"><h2>Raio-X financeiro</h2><span class="sis" data-sistema="smith" title="Sistema de origem: Smith">Smith</span><small class="sis-papel">· financeiro</small></div><p class="sub">Raio-X financeiro do cliente: canais e contas, custo informado ou não (e há quantos dias), margem só com custo, mudanças de preço dos últimos 90 dias com quem decidiu e o efeito medido, caixa, combinados das reuniões, contrato e risco. Onde falta, aparece «não temos o dado». Só leitura; a pauta da reunião sai daqui.</p><div id="guardiao">${SK('sk-tabela')}</div></section>
    <section class="bloco" id="secContrato"><div class="bloco-cab"><h2>Contrato e pagamentos</h2><span class="sis" data-sistema="smith" title="Sistema de origem: Smith">Smith</span><small class="sis-papel">· financeiro</small><button class="btn-icone btn-ajuda" type="button" aria-label="Como fazer: Contrato e pagamentos" data-ajuda="contrato"></button></div><p class="sub">Vigência, entregáveis, obrigação de meio, cláusula de reembolso e o arquivo assinado; pagamentos com comprovante. É a prova que o dossiê de defesa exige: sem o contrato ele fica incompleto.</p><div id="contrato">${SK('sk-tabela')}</div></section>
    <section class="bloco" id="secRisco"><div class="bloco-cab"><h2>Cliente em risco</h2><button class="btn-icone btn-ajuda" type="button" aria-label="Como fazer: Cliente em risco" data-ajuda="risco"></button></div><p class="sub">Reclamação, pedido de reembolso, ameaça jurídica ou insatisfação declarada: a marcação é de quem atende (líder, consultor ou CS), com motivo; o sistema só sugere pelos sinais que mede. Risco aberto entra no dossiê mensal.</p><div id="risco">${SK('sk-tabela')}</div></section>
    <section class="bloco" id="secDossie"><div class="bloco-cab"><h2>Prestação de contas e dossiê</h2><span class="sis" data-sistema="morpheus" title="Sistema de origem: Morpheus">Morpheus</span><small class="sis-papel">· comunicação</small><button class="btn-icone btn-ajuda" type="button" aria-label="Como fazer: Prestação de contas e dossiê" data-ajuda="dossie"></button></div><p class="sub">Documento do período escolhido no padrão do relatório do Manoel: execução registrada, solicitações do cliente, anúncios trabalhados, indicadores mês a mês, Ads, rentabilidade e próximos passos, com a fonte de cada número. A prestação de contas vai ao cliente; o dossiê de defesa (obrigação de meio, as 9 perguntas, cronologia do livro, provas) é confidencial e nunca sai do sistema. PDF e Word guardados aqui.</p><div id="dossie">${SK('sk-tabela')}</div></section>
    <h3 class="grupo-cfg">Custos</h3>
    <section class="bloco" id="secCustosUpload"><div class="bloco-cab"><h2>Custos do cliente</h2><span class="sis" data-sistema="smith" title="Sistema de origem: Smith">Smith</span><small class="sis-papel">· financeiro</small><button class="btn-icone btn-ajuda" type="button" aria-label="Como fazer: Custos do cliente" data-ajuda="custos_erp"></button></div><p class="sub">Quatro portas, um custo por anúncio (precedência manual &gt; planilha subida &gt; Bling &gt; Tiny &gt; planilha Google). Três linhas de estado e, abaixo, os custos em % e a planilha. A planilha do cliente vira custo por anúncio: pelo MLB da linha, pelo SKU do anúncio ou da variação no Mercado Livre (igual ou sem espaço e hífen) e pelos anúncios do mesmo produto. Título parecido só sugere. Prévia antes de gravar; custo igual ou acima do preço vai para quarentena.</p><div id="custosEstado">${SK('sk-tabela')}</div><h3 class="mt-4">Custos: planilha do cliente</h3><div id="custosUpload">${SK('sk-tabela')}</div></section>
    <h3 class="grupo-cfg">Nota fiscal</h3>
    <section class="bloco" id="secNotaFiscal"><div class="bloco-cab"><h2>Nota fiscal: regras e certificado</h2><span class="sis" data-sistema="smith" title="Sistema de origem: Smith">Smith</span><small class="sis-papel">· financeiro</small><button class="btn-icone btn-ajuda" type="button" aria-label="Como fazer: Nota fiscal" data-ajuda="nf"></button></div><p class="sub">Regime, termo de responsabilidade e regras fiscais por SKU declaradas pelo contador do cliente (CSV). O sistema não decide imposto: produto sem regra não tem nota. O certificado A1 fica no provedor fiscal, nunca no banco.</p><div id="notaFiscal">${SK('sk-tabela')}</div></section>
    <section class="bloco" id="secNotas"><div class="bloco-cab"><h2>Notas emitidas (rascunho → emissão)</h2><span class="sis" data-sistema="chaveiro" title="Sistema de origem: Chaveiro">Chaveiro</span><small class="sis-papel">· execução</small><button class="btn-icone btn-ajuda" type="button" aria-label="Como fazer: Notas emitidas" data-ajuda="notas"></button></div><p class="sub">Uma nota por pacote de pedidos pagos: rascunho com os bloqueios nominais, aprovação de líder ou consultor, emissão em homologação até a produção ser liberada, anexo ao pacote no Mercado Livre. Comprador sempre mascarado.</p><div id="notas">${SK('sk-tabela')}</div></section>
  </section>

  <section data-painel="configurar" hidden>
    <p class="pronto-operar" id="prontoOperar">Pronto para operar: <b>—</b> de 8 <span class="mini">lendo o progresso…</span></p>
    <h3 class="grupo-cfg">Quem é e quem atende</h3>
    <section class="bloco" id="secFicha"><div class="bloco-cab"><h2>Equipe e contas do cliente</h2><button class="btn-icone btn-ajuda" type="button" aria-label="Como fazer: Equipe e contas do cliente" data-ajuda="ficha"></button></div><p class="sub">Quem atende este cliente por canal e papel, e os links das contas. A tarefa aprovada sai delegada no Notion a partir daqui.</p><div id="ficha">${SK('sk-tabela')}</div></section>
    <h3 class="grupo-cfg">O que o cliente recebe</h3>
    <section class="bloco" id="secRelatorio"><div class="bloco-cab"><h2>Relatório no Notion: frequência e envio</h2><span class="sis" data-sistema="morpheus" title="Sistema de origem: Morpheus">Morpheus</span><small class="sis-papel">· comunicação</small><button class="btn-icone btn-ajuda" type="button" aria-label="Como fazer: Relatório no Notion" data-ajuda="relatorio_notion"></button></div><p class="sub">Relatório curto (resultados, atividades, desenvolvimento e próximos passos dos últimos 7 dias), criado na base Informações do cliente com a categoria Relatório de Sprints Place2u. Semanal, quinzenal ou mensal.</p><div id="relatorio">${SK('sk-tabela')}</div></section>
    <section class="bloco" id="secPerfil"><div class="bloco-cab"><h2>Estilo do relatório PDF</h2><span class="sis" data-sistema="morpheus" title="Sistema de origem: Morpheus">Morpheus</span><small class="sis-papel">· comunicação</small><button class="btn-icone btn-ajuda" type="button" aria-label="Como fazer: Estilo do relatório PDF" data-ajuda="perfil_relatorio"></button></div><p class="sub">Define como o Relatório Semanal é escrito para este cliente: densidade, provas, tom e linguagem.</p><div id="perfil">${SK('sk-tabela')}</div></section>
    <section class="bloco" id="secPerfilCliente"><div class="bloco-cab"><h2>Temas que o cliente pediu</h2><span class="sis" data-sistema="morpheus" title="Sistema de origem: Morpheus">Morpheus</span><small class="sis-papel">· comunicação</small><button class="btn-icone btn-ajuda" type="button" aria-label="Como fazer: Temas que o cliente pediu" data-ajuda="temas_cliente"></button></div><p class="sub">Temas do relatório na ordem que o cliente pediu, nível (padrão, didático para quem está aprendendo, completo) e serviço. A base fixa vem para todos; os pedidos sobem para o topo. Sugestão pelas respostas no grupo só sugere até alguém salvar. Cada mudança entra no histórico e no livro de registro.</p><div id="perfilInfo">${SK('sk-tabela')}</div></section>
    <h3 class="grupo-cfg">Conta, Notion e metas</h3>
    <section class="bloco" id="secCatalogo"><div class="bloco-cab"><h2>Anúncios de catálogo</h2><span class="sis" data-sistema="trinity" title="Sistema de origem: Trinity">Trinity</span><small class="sis-papel">· coleta</small><button class="btn-icone btn-ajuda" type="button" aria-label="Como fazer: Anúncios de catálogo" data-ajuda="catalogo"></button></div><p class="sub">Foto, título, descrição e ficha do anúncio de catálogo são controlados pelo catálogo do Mercado Livre: de terceiros, o vendedor não altera; próprio, só por sugestão de correção, com revisão do Mercado Livre. O sistema não recomenda conteúdo nesses anúncios e mostra o selo de catálogo.</p><div id="catalogo">${SK('sk-tabela')}</div></section>
    <section class="bloco" id="cad-sec"><div class="bloco-cab"><h2>Cadastro do CS (health score)</h2><button class="btn-icone btn-ajuda" type="button" aria-label="Como fazer: Cadastro do CS" data-ajuda="cadastro_cs"></button></div><p class="sub">Identificação da central (vem do Notion, só leitura) e os campos do CS: responsável, health score com classificação, canais informados e observações. Squad: ${esc(d.squad || 'a definir')}.</p><div id="cad-corpo">${SK('sk-tabela')}</div></section>
    <details class="recolhido" id="secNotion"><summary>Notion do cliente <span class="n" id="nNotion"></span> <span class="sis" data-sistema="trinity" title="Sistema de origem: Trinity">Trinity</span><small class="sis-papel">· coleta</small></summary><p class="sub">A página do cliente no Notion, as bases e páginas dentro dela e a base Informações inteira, como a integração enxerga. Lido pelo sync; "Atualizar do Notion" relê agora.</p><div id="notion">${SK('sk-tabela')}</div></details>
    <section class="bloco" id="secMetas"><div class="bloco-cab"><h2>Metas do mês</h2></div><p class="sub">Meta de entregas e de GMV do mês: ligam a probabilidade da Previsão do mês (aba Estratégia).</p>
      <form id="formMetas" class="linha mt-2">
        <label class="sr" for="mEntregas">Meta de entregas no mês</label><input type="number" min="1" step="any" id="mEntregas" placeholder="Meta de entregas/mês" value="${esc(d.probabilidade_meta.metas?.entregas || '')}">
        <label class="sr" for="mGmv">Meta de GMV em reais</label><input type="number" min="1" step="any" id="mGmv" placeholder="Meta GMV (R$)" value="${esc(d.probabilidade_meta.metas?.gmv || '')}">
        <button class="btn-mini" type="submit">Salvar metas</button>
      </form></section>
    <h3 class="grupo-cfg">Canais do cliente</h3>
    <section class="bloco" id="secAvisos"><div class="bloco-cab"><h2>Canais do cliente (WhatsApp, e-mail, Notion)</h2><span class="sis" data-sistema="morpheus" title="Sistema de origem: Morpheus">Morpheus</span><small class="sis-papel">· comunicação</small><button class="btn-icone btn-ajuda" type="button" aria-label="Como fazer: Plano de terça no WhatsApp" data-ajuda="avisos_whatsapp"></button></div><p class="sub">Canais por onde o cliente recebe o plano semanal (terça 09h, com os urgentes): grupo de WhatsApp do Mercado Livre, e-mail ou página no Notion dele; nome do cliente na mensagem, silêncio e liberação por um líder. Discord é canal interno da equipe. Teste o canal antes de liberar; o número e o e-mail ficam só aqui.</p><div id="avisos">${SK('sk-tabela')}</div></section>
  </section>`
  main.dataset.cliente = d.cliente
  vivos.forEach(n => $(n.id).replaceWith(n))                                        // conteúdo e listeners preservados
  desenharContadores()

  // ligações
  document.querySelectorAll('[data-aba-cli]').forEach(b => b.onclick = () => mostrarAba(b.dataset.abaCli))
  document.querySelectorAll('[data-plano]').forEach(b => b.onclick = () => mostrarPlano(b.dataset.plano))
  document.querySelectorAll('[data-quem]').forEach(b => b.onclick = () => { planoQuem = b.dataset.quem; document.querySelectorAll('[data-quem]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); limiteAcoes = PAGINA; desenharAcoes() })
  $('btnRevisar').onclick = () => { ativos = new Set(['p01']); limiteAcoes = PAGINA; desenharFiltros(); desenharAcoes(); mostrarPlano('cliente'); mostrarAba('plano'); const l = $('listaAcoes'); l.tabIndex = -1; l.focus(); l.scrollIntoView() }
  // progresso do processo (F4 dos 5 menus): stepper no cabeçalho; #btnRevisar vira o botão da 1ª etapa atrasada (senão da 1ª pendente) — único primário —
  // e Configurar mostra «Pronto para operar: N de 8». Etapa 6 (Aprovado) é o Revisar plano de sempre (P0/P1 a decidir).
  window.PSProgresso?.montar($('progresso'), { cliente: d.cliente }).then(p => {
    if (!p || main.dataset.cliente !== p.cliente) return
    const po = $('prontoOperar'); if (po) po.innerHTML = `Pronto para operar: <b>${p.pronto.n}</b> de ${p.pronto.de} <span class="mini">${p.pronto.itens.filter(i => !i.ok).map(i => 'falta ' + esc(i.texto)).join(' · ') || 'tudo pronto (etapas 1–4 do progresso)'}</span>`
    const alvo = p.etapas.find(e => e.estado === 'atrasado') || p.etapas.find(e => e.estado === 'pendente'), b = $('btnRevisar')
    if (!alvo || alvo.n === 6 || !b || !alvo.ir) return
    b.textContent = alvo.acao || alvo.nome; b.title = `Etapa ${alvo.n} · ${alvo.nome}: ${alvo.motivo || alvo.numero}`
    b.onclick = () => {
      const u = new URL(alvo.ir, location.origin), aba = u.searchParams.get('aba'), sec = u.searchParams.get('sec')
      if (u.pathname !== '/cliente' || !aba) { location.href = alvo.ir; return }
      mostrarAba(aba); const s = sec && $(sec); if (s) { s.tabIndex = -1; s.focus(); s.scrollIntoView() }
    }
  })
  // "ver na Folha do anúncio" (Anúncios no período → Folha, mesma aba desde a F6): só troca a aba e leva o foco ao bloco; o href é o fallback sem JS (nunca hash nem pushState)
  document.querySelector('[data-ir-folha]')?.addEventListener('click', e => { e.preventDefault(); mostrarAba('anuncios'); const s = $('secFolha'); if (s) { s.tabIndex = -1; s.focus(); s.scrollIntoView() } })
  const fa = $('fAnuncio')
  if (fa) fa.onsubmit = async e => {
    e.preventDefault()
    const v = id => { const x = $(id).value; return x === '' ? null : Number(x) }
    const par = k => ({ antes: v(`a_${k}_antes`), depois: v(`a_${k}_depois`) })
    const corpo = { impressoes: par('impressoes'), cliques: par('cliques'), pedidos: par('pedidos'),
      meu: (v('a_meu_de') != null || v('a_meu_por') != null) ? { de: v('a_meu_de'), por: v('a_meu_por') } : null,
      concorrente: (v('a_conc_de') != null || v('a_conc_por') != null) ? { de: v('a_conc_de'), por: v('a_conc_por') } : null,
      frete_gratis: { sim: true, nao: false, '': null }[$('a_frete').value],
      imagens_carrossel: v('a_carrossel') }
    const box = $('resAnuncio')
    box.innerHTML = SK('sk-linha', 'sk-linha')
    try {
      const r = await api('/api/anuncio/diagnostico', corpo)
      const TOM = { alta: 'erro', media: '', info: 'info', ok: 'ok' }
      box.innerHTML = r.achados.map(a => `
        <div class="aviso ${TOM[a.gravidade] ?? 'info'}"><b>${esc(a.veredito)}</b>
          ${a.mexa_em.length ? `<div class="mt-2"><b>Mexa em:</b><ul>${a.mexa_em.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
          <div class="mini mt-2">${esc(a.evidencia)}</div>
        </div>`).join('') +
        (r.faltando.length ? `<div class="mini mt-2">Para completar o diagnóstico: ${r.faltando.map(esc).join(' · ')}</div>` : '')
    } catch (err) { erroBloco(box, err, () => fa.requestSubmit()) }
  }
  const bpp = $('btnPlacePlan')
  if (bpp) bpp.onclick = async () => {
    bpp.closest('details').open = false
    bpp.disabled = true; bpp.textContent = 'Pré-visualizando…'
    try {
      const prev = await api('/api/placeplan/publicar', { cliente: dados.cliente })          // dry-run
      const novas = prev.paginas || []
      const texto = (novas.length ? 'Criar na base Informações, com capa e tabela 5W2H: ' + novas.map(p => `${p.titulo} (${p.linhas} linha(s), analista ${p.analista || 'a definir'})`).join(' · ') : 'Nada novo a criar.') +
        (prev.ja_existiam?.length ? ` Já existem: ${prev.ja_existiam.map(x => x.titulo).join(', ')}.` : '')
      if (!novas.length) toast(texto)
      else if (await confirmar({ titulo: `Criar o PlacePlan de ${dados.cliente} no Notion?`, texto, rotuloOk: 'Criar no Notion' })) {
        bpp.textContent = 'Criando…'
        const r = await api('/api/placeplan/publicar', { cliente: dados.cliente, confirmar: true })
        toast(`${(r.paginas || []).length} página(s) criadas no Notion.` + (r.erros?.length ? ` ${r.erros.length} erro(s).` : '') + ' As tarefas detalhadas saem pela Distribuição (escopo Seleção).', r.erros?.length ? 'erro' : 'ok')
      }
    } catch (e) { toast(e.message, 'erro') }
    bpp.disabled = false; bpp.textContent = 'Criar PlacePlan no Notion'
  }
  const bra = $('btnRelatorioAgora')
  if (bra) bra.onclick = () => { bra.closest('details').open = false; PSRelatorio.enviarAgora(dados.cliente, { aoConcluir: () => PSRelatorio.montarConfig($('relatorio'), dados.cliente) }) }
  const fm = $('formMetas')
  if (fm) fm.onsubmit = async e => {
    e.preventDefault()
    try {
      // merge: o endpoint SUBSTITUI o JSON de metas — reenviar as já registradas preserva roas/margem etc.
      await api('/api/cliente/metas', { cliente: d.cliente, metas: { ...d.probabilidade_meta.metas, entregas: Number($('mEntregas').value) || 0, gmv: Number($('mGmv').value) || 0 } })
      abrirCliente(d.cliente, false)                       // recarrega o painel com o score ligado
    } catch (x) { toast(x.message, 'erro') }
  }
  document.querySelectorAll('#filtros .f-chip').forEach(b => b.onclick = () => {
    const k = b.dataset.k
    if (k === 'todas') ativos = new Set(['todas'])
    else { ativos.delete('todas'); ativos.has(k) ? ativos.delete(k) : ativos.add(k); if (!ativos.size) ativos = new Set(['todas']) }
    limiteAcoes = PAGINA
    desenharFiltros(); desenharAcoes()
  })
  desenharVeredito(); desenharProximas(); desenharAcoes()
  mostrarPlano(planoVisao)
  mostrarAba(new URLSearchParams(location.search).get('aba') || 'resumo')
  // deep link do shell (?sec=<id>): abre o details (e os de fora) e rola até o bloco; só na 1ª pintura do cliente (o redesenho devolve o scroll)
  const sec = new URLSearchParams(location.search).get('sec'), alvoSec = !reusa && sec ? $(sec) : null
  if (alvoSec) {
    for (let d = alvoSec.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true
    alvoSec.scrollIntoView({ block: 'start' })
    // os blocos acima ainda carregam e empurram o alvo (o scroll anchoring do navegador não segura): enquanto o main crescer, rola de novo —
    // até 6 s ou até o primeiro gesto do usuário (roda, toque, tecla, clique)
    const ro = new ResizeObserver(() => { if ($(sec) === alvoSec) alvoSec.scrollIntoView({ block: 'start' }) })
    const parar = () => ro.disconnect()
    for (const ev of ['wheel', 'touchstart', 'keydown', 'pointerdown']) addEventListener(ev, parar, { once: true, passive: true })
    ro.observe(main); setTimeout(parar, 6000)
  }
  if (reusa) scrollTo(0, y)
  else { carregarVendas(d.cliente); carregarAnuncios(d.cliente); carregarImpacto(d.cliente); carregarPlanoConta(d.cliente); carregarPerfil(d.cliente); carregarCatalogo(d.cliente); carregarCadastro(d.cliente); window.PSRelatorio?.montarConfig($('relatorio'), d.cliente); carregarFicha(d.cliente); carregarOfertas(d.cliente); carregarRetro(d.cliente); carregarAcomp(d.cliente); carregarFolha(d.cliente); carregarPrecos(d.cliente); carregarDependencias(d.cliente); carregarDoCliente(d.cliente); carregarChaveiro(d.cliente); carregarSaude(d.cliente); carregarNotion(d.cliente); window.PSPendencias?.montar($('pendencias'), d.cliente, { faixa: $('faixaPendencias')}); window.PSAlertas?.montarResumo($('alertasCliente'), d.cliente); window.PSGatilhos?.montarResumo($('gatilhos'), d.cliente); window.PSGatilhos?.montarConfig($('avisos'), d.cliente); window.PSAlinhamentos?.montar($('alinhamentos'), d.cliente); window.PSGuardiao?.montar($('guardiao'), d.cliente); window.PSDossie?.montarCliente({ dossie: $('dossie'), risco: $('risco'), contrato: $('contrato') }, d.cliente); window.PSPerfilInfo?.montarCliente($('perfilInfo'), d.cliente); window.PSNota?.montarCliente({ config: $('notaFiscal'), notas: $('notas') }, d.cliente); window.PSCustosUpload?.montar($('custosUpload'), d.cliente); carregarCustosEstado(d.cliente) }
}
// ── aba Do cliente (GET /api/cliente/do-cliente): contador, lista do filtro Equipe | Cliente do Plano e os movidos para a equipe ──
const ehDoCliente = a => !!doCli?.acoes_cliente?.includes(a.id)
function carregarDoCliente(cliente) {
  window.PSDoCliente?.montar($('doCliente'), cliente, { aoCarregar: r => { if (dados?.cliente !== cliente) return; doCli = r; desenharContadores(); desenharAcoes(); desenharProximas(); window.PSDoCliente.movidos($('movidosEquipe'), r) } })
}
// links «aba Do cliente» (faixa de alerta, Próximas ações, Depende do cliente): só trocam a aba; o href é o fallback sem JS
document.addEventListener('click', e => { const l = e.target.closest('[data-ir-aba]'); if (!l || !dados) return; e.preventDefault(); mostrarAba(l.dataset.irAba); scrollTo(0, 0) })
function carregarRelatoriosCiclo() { const a = $('relatoriosCiclo'); if (a && dados && a.dataset.cliente !== dados.cliente) { a.dataset.cliente = dados.cliente; window.PSRelatoriosCiclo?.montar(a, dados.cliente) } }
// preset = ação do plano (botão «Executar pelo Chaveiro» no Resumo): remonta o console já preenchido
function carregarExecutar(preset = null) { const a = $('executar'); if (a && dados && (preset || a.dataset.cliente !== dados.cliente)) { a.dataset.cliente = dados.cliente; window.PSExecutar?.montar(a, dados.cliente, preset) } }
function carregarProdutos() { const a = $('produtos'); if (a && dados && a.dataset.cliente !== dados.cliente) { a.dataset.cliente = dados.cliente; window.PSProdutos?.montar(a, dados.cliente) } }
function desenharFiltros() {
  document.querySelectorAll('#filtros .f-chip').forEach(b => { const on = ativos.has(b.dataset.k); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)) })
}
function desenharAcoes() {
  const fs = FILTROS.filter(f => ativos.has(f.k))
  const lista = dados.acoes
    .filter(a => a.status !== 'obsoleta')
    .filter(a => fs.every(f => f.f(a)))
    .filter(a => planoQuem === 'tudo' || (planoQuem === 'cliente') === ehDoCliente(a))   // Equipe (padrão) | Cliente | Tudo: a lista do cliente vem do servidor (um predicado só)
    .sort((x, y) => y.prioridade.nota - x.prioridade.nota)
  $('nAcoes').textContent = `${lista.length} ação(ões)` + (lista.some(a => a.status === 'descartada') ? ' (descartadas aparecem riscadas)' : '')
  const ROT_ST = { proposta: 'proposta', aprovada: 'aprovada', distribuida: 'no Notion', descartada: 'descartada' }
  $('listaAcoes').innerHTML = lista.length ? lista.slice(0, limiteAcoes).map(a => `
  <div class="acao">
    <div class="acao-topo">
      <span class="p-badge p-${esc(a.prioridade.p || 'P3')}" title="Prioridade = impacto estimado 40% + urgência 20% + evidência (fato/hipótese) 25% + facilidade 15%">${esc(a.prioridade.p || '—')}</span>
      <div class="acao-corpo">
        <b class="${a.status === 'descartada' ? 'st-descartada' : ''}">${esc(a.titulo)}</b>
        <div class="acao-meta">
          <span>Prazo ${brData(a.prazo)}</span>
          <span>${esc(a.responsavel || 'a definir')}</span>
          <span>${esc(a.canal || 'Geral')}</span>
          <span class="st-rotulo st-${esc(a.status)}">${ROT_ST[a.status] || esc(a.status)}</span>${a.notion_url ? `<a href="${esc(a.notion_url)}" target="_blank" rel="noopener">abrir no Notion</a>` : ''}
        </div>
        <div class="acao-tags">
          ${a.carac.alto_impacto ? '<span class="tagzinha impacto">alto impacto</span>' : ''}
          ${a.carac.curto_prazo ? '<span class="tagzinha">curto prazo</span>' : ''}
          ${a.carac.longevo ? '<span class="tagzinha">longevo</span>' : ''}
          <span class="tagzinha ${a.carac.fato ? 'fato' : ''}">${esc(a.tipo)}</span>
          ${a.historico ? `<span class="tagzinha" title="aprendizado da base própria">${esc(a.historico)}</span>` : ''}
        </div>
        <details class="evid"><summary>Evidência, meta e critério de aceite</summary>
          <div class="box">
            <div><b>O que encontramos:</b> ${esc(a.evidencia)}</div>
            <div><b>Por que importa:</b> ${esc(a.problema)}</div>
            <div><b>O que faremos:</b> ${esc(a.acao)}</div>
            <div><b>Como saberemos:</b> ${esc(a.indicador)}; meta: ${esc(a.meta)}</div>
            <div><b>Aceite:</b> ${esc(a.aceite)}</div>
            <div><b>Prioridade ${esc(a.prioridade.p || '—')}:</b> ${a.prioridade.nota ?? '—'}/100 (impacto 40% + urgência 20% + evidência 25% + facilidade 15%)</div>
            <div><b>Score de distribuição:</b> ${esc(a.logica)}</div>
          </div>
        </details>
      </div>
      <div class="acao-lado">
        ${['proposta', 'aprovada', 'descartada'].includes(a.status) ? `
        <div class="acao-botoes">
          ${a.status !== 'aprovada' ? `<button class="btn-mini ok" type="button" data-id="${esc(a.id)}" data-st="aprovada">Aprovar</button>` : ''}
          ${a.status !== 'descartada' ? `<button class="btn-mini no" type="button" data-id="${esc(a.id)}" data-st="descartada">Descartar</button>` : `<button class="btn-mini" type="button" data-id="${esc(a.id)}" data-st="proposta">Reabrir</button>`}
        </div>` : ''}
        ${a.status === 'distribuida' ? `<button class="btn-mini" type="button" data-res="${esc(a.id)}">Registrar resultado</button>` : ''}
      </div>
    </div>
  </div>`).join('') + (lista.length > limiteAcoes ? `<div class="t-pag">1–${limiteAcoes} de ${lista.length.toLocaleString('pt-BR')} <button class="btn btn-p" type="button" data-mais>Mostrar mais</button></div>` : '')
    : '<div class="vazio-box"><b>Nenhuma ação com essas características.</b>Ajuste os filtros ou gere o plano na Distribuição.<button class="btn" type="button" data-limpar>Limpar filtros</button></div>'
  $('listaAcoes').querySelector('[data-mais]')?.addEventListener('click', () => { limiteAcoes += PAGINA; desenharAcoes() })
  $('listaAcoes').querySelector('[data-limpar]')?.addEventListener('click', () => { ativos = new Set(['todas']); desenharFiltros(); desenharAcoes() })
  document.querySelectorAll('#listaAcoes [data-res]').forEach(b => b.onclick = () => registrarResultado(b.dataset.res))
  ligarDecisao($('listaAcoes'))
}

// deep-link: /cliente?cliente=Nome
const inicial = new URLSearchParams(location.search).get('cliente')
// sem ?cliente=: reabre o último cliente (Consultor e Empresa do cliente levam ao MESMO cliente, cada um na sua aba); sem lembrança, a busca diz para onde vai
let lembrado = ''; try { lembrado = localStorage.getItem('ps_cliente') || '' } catch {}
if (inicial) abrirCliente(inicial, false)
else if (lembrado) abrirCliente(lembrado, true)
else { const dest = document.querySelector('.ps-abas a[aria-current="page"]')?.textContent, g = document.querySelector('.ps-grupos a[aria-current]')?.textContent; if (dest && g) $('telaBusca').querySelector('.pg-pergunta').textContent = `Para abrir ${g} › ${dest} · nome ou CNPJ · atalho / em qualquer tela` }


// ── mais vendidos (visão do comprador) e resultado das tarefas ──────────────
const brl = v => v == null ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 })
const sg = v => v == null ? '—' : (v >= 0 ? '+' : '') + v.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%'
async function atualizarDadosML(cliente, btn) {
  btn.disabled = true; btn.setAttribute('aria-busy', 'true'); const rot = btn.textContent; let res = {}
  try {
    const { job } = await api('/api/cliente/coletar', { cliente })
    for (;;) {
      const j = await api('/api/planos/job/' + job)
      btn.textContent = `Coletando… ${j.progresso.fase || ''} ${j.progresso.feitos || 0}/${j.progresso.total || '…'}`
      if (j.estado !== 'rodando') { if (j.estado === 'erro') throw new Error(j.erro); res = j.resultado || {}; break }
      await new Promise(r => setTimeout(r, 2000))
    }
    if (dados?.cliente !== cliente) return                          // o usuário já abriu outro cliente: não recarrega o antigo na tela do novo
    carregarVendas(cliente); carregarImpacto(cliente); carregarPlanoConta(cliente); carregarRetro(cliente); carregarAcomp(cliente); carregarPrecos(cliente); carregarFolha(cliente); carregarCatalogo(cliente)
    if (res.falhas_pedidos) toast(`Coleta concluída com ${res.falhas_pedidos} dia(s) de pedidos que falharam; o GMV desses dias fica como lacuna, não como zero. Rode a coleta de novo.`, 'erro')
    else toast('Dados do Mercado Livre atualizados.')
  } catch (e) { toast(e.message, 'erro') } finally { btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = rot }
}
const NAO_CONECTADO = (cliente, r = {}) => r.conectado
  ? `<div class="vazio-box"><b>Conta do Mercado Livre conectada, dados ainda não coletados.</b>A coleta leva alguns minutos e roda em segundo plano.<button class="btn" type="button" data-coletar="${esc(cliente)}">Coletar dados agora</button></div>`
  : `<div class="vazio-box"><b>Mercado Livre não conectado.</b>Sem a conta conectada, vendas e resultado das tarefas não aparecem.<a class="btn" href="/integracoes">Gerar o link de conexão</a></div>`
const ligarColetar = alvo => alvo.querySelectorAll('[data-coletar]').forEach(b => { b.onclick = () => atualizarDadosML(b.dataset.coletar, b) })
async function carregarVendas(cliente) {
  const alvo = $('vendas'); if (!alvo) return
  try {
    const r = await api('/api/cliente/vendas?cliente=' + encodeURIComponent(cliente))
    if (dados?.cliente !== cliente) return
    if (!r.disponivel) { alvo.innerHTML = NAO_CONECTADO(cliente, r); ligarColetar(alvo); return }
    const fim = r.cobertura?.ate ? brData(r.cobertura.ate) : '—'
    const MOSTRA = 12
    alvo.innerHTML = `<div class="bloco-cab mt-2"><span class="mini">Dados do Mercado Livre até ${fim}</span><button class="btn-mini" id="btnColeta" type="button">Reler o Mercado Livre</button></div>` + (r.itens.length ? r.itens.map((i, ix) => `
      <div class="item-card"${ix >= MOSTRA ? ' hidden data-extra' : ''}>
        ${imgAnuncio(i.thumb, '')}
        <div class="item-corpo">
          ${urlOk(i.permalink) ? `<a href="${esc(urlOk(i.permalink))}" target="_blank" rel="noopener">${esc(i.titulo)} ↗</a>` : `<b>${esc(i.titulo)}</b>`} ${seloCatalogo(i.catalogo_origem)}
          <div class="item-num">
            <span><b>${i.unidades}</b> un · <b>${brl(i.receita)}</b> em ${r.dias} dias${i.unidades_anterior ? ` <span class="${i.unidades >= i.unidades_anterior ? 'pos' : 'neg'}">(${sg((i.unidades / i.unidades_anterior - 1) * 100)})</span>` : ''}</span>
            <span>${i.visitas == null ? 'visitas —' : `<b>${i.visitas}</b> visitas`}${i.conversao != null ? ` · conversão <b>${i.conversao.toLocaleString('pt-BR')}%</b>` : ''}</span>
            <span>preço <b>${brl(i.preco)}</b> · estoque <b>${i.estoque ?? '—'}</b></span>
            ${i.avaliacoes?.total ? `<span>${i.avaliacoes.nota != null ? `★ <b>${nPt(i.avaliacoes.nota, 1)}</b> · ` : ''}${intPt(i.avaliacoes.total)} avaliações</span>` : ''}
          </div>
          ${i.flags.map(f => `<span class="flag ${esc(f.tom || '')}">${esc(f.texto)}</span>`).join(' ') || '<span class="flag bom">sem alertas nos dados disponíveis</span>'}
        </div>
      </div>`).join('') + (r.itens.length > MOSTRA ? `<button class="btn btn-fantasma" type="button" data-ver-mais>Ver mais ${r.itens.length - MOSTRA} anúncios</button>` : '') : '<div class="vazio-box"><b>Nenhuma venda no período.</b>Atualize os dados do Mercado Livre ou confira a conexão em Integrações.</div>')
    $('btnColeta').onclick = e => atualizarDadosML(cliente, e.currentTarget)
    alvo.querySelector('[data-ver-mais]')?.addEventListener('click', e => { alvo.querySelectorAll('[data-extra]').forEach(x => { x.hidden = false }); e.currentTarget.remove() })
  } catch (e) { erroBloco(alvo, e, () => carregarVendas(cliente)) }
}
// ── anúncios no período: PSFiltros (painel cliente) → /api/cliente/anuncios?cliente=&f= ──────────
// O componente lê ?f= da URL sozinho e chama aoAplicar; cada aplicação refaz período, totais, tabela e CSV com a lista filtrada.
const ROT_ST_AN = { active: 'ativo', paused: 'pausado', closed: 'encerrado', under_review: 'em revisão', inactive: 'inativo' }
const brl2 = v => v == null ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const intPt = v => v == null ? '—' : Number(v).toLocaleString('pt-BR')
// miniatura do anúncio (Anúncios, Folha, Cronologia de preços): maior, nítida e com a galeria no hover (galeria-anuncio.js); sem o script, a de sempre
const miniAn = (thumb, titulo, id) => window.PSGaleria ? PSGaleria.miniatura(thumb, titulo, id) : imgAnuncio(thumb, titulo, 'an-thumb')
let anSeq = 0, anLimite = PAGINA, anDados = null
function carregarAnuncios(cliente) {
  const flt = $('fltAnuncios'), alvo = $('anuncios'); if (!flt || !alvo) return
  anLimite = PAGINA; anDados = null
  let aplicou = false
  const buscar = f => { aplicou = true; buscarAnuncios(cliente, f) }
  if (window.PSFiltros) PSFiltros.montar(flt, { painel: 'cliente', periodoPadrao: 'ultimos_90_dias', rotuloAbrir: 'Filtrar anúncios', aoAplicar: (_def, f) => buscar(f) })
  // ponytail: se a definição dos filtros não vier (componente ausente ou API fora), o bloco ainda carrega com o período padrão da API
  setTimeout(() => { if (!aplicou && dados?.cliente === cliente) buscar(null) }, 4000)
}
async function buscarAnuncios(cliente, f) {
  const alvo = $('anuncios'), flt = $('fltAnuncios'); if (!alvo) return
  const seq = ++anSeq
  alvo.innerHTML = SK('sk-kpi', 'sk-tabela')
  try {
    const r = await api('/api/cliente/anuncios?cliente=' + encodeURIComponent(cliente) + (f ? '&f=' + encodeURIComponent(f) : ''))
    if (seq !== anSeq || dados?.cliente !== cliente) return
    if (!r.disponivel) { if (flt) flt.hidden = true; alvo.innerHTML = NAO_CONECTADO(cliente, r); ligarColetar(alvo); return }
    if (flt) flt.hidden = false
    anDados = r; anLimite = PAGINA
    anN = r.total_sem_filtro ?? r.totais?.anuncios ?? null; desenharContadores()   // o contador da aba é a conta inteira, não o recorte do filtro
    desenharAnuncios(alvo, cliente)
  } catch (e) { if (seq === anSeq) erroBloco(alvo, e, () => buscarAnuncios(cliente, f)) }
}
// comparação por extenso: só o que a API devolveu; delta nulo = sem dado (nunca zero), cobertura parcial declarada
function linhaComparacao(c) {
  const dl = v => v == null ? 'sem dado' : `<b class="${v >= 0 ? 'pos' : 'neg'}">${pctTxt(v)}</b>`
  if (c.delta_faturamento_pct == null && c.delta_unidades_pct == null) return `<li>${esc(c.rotulo)}: <b>sem venda coletada nesse intervalo</b>, comparação indisponível.</li>`
  return `<li>${esc(c.rotulo)}: faturamento ${dl(c.delta_faturamento_pct)} (${brlAbrev(c.faturamento)}) · unidades ${dl(c.delta_unidades_pct)} (${intPt(c.vendas_unidades)})${c.coberto ? '' : ' · <span class="mudo">coleta cobre só parte desse intervalo</span>'}</li>`
}
function desenharAnuncios(alvo, cliente) {
  const r = anDados, itens = r.itens || [], t = r.totais, cmp = r.comparacoes || {}
  const temSku = itens.some(i => i.sku), temAds = itens.some(i => i.ads_custo > 0)
  // conversão e visitas só dos anúncios com cobertura de visitas (os outros aparecem com "—"); quando não são todos, o KPI declara quantos
  const conv = t.conversao != null ? Number(t.conversao).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + '%' : '—'
  const cobVis = t.anuncios_com_visitas != null && t.anuncios_com_visitas < t.anuncios ? ` · ${intPt(t.anuncios_com_visitas)} de ${intPt(t.anuncios)} anúncios com visitas coletadas` : ''
  const filtrado = r.total_sem_filtro != null && r.total_sem_filtro !== t.anuncios
  const linha = i => `<tr>
      <td class="foto">${miniAn(i.thumb, i.titulo, i.anuncio_id)}</td>
      <td class="tit">${urlOk(i.permalink) ? `<a href="${esc(urlOk(i.permalink))}" target="_blank" rel="noopener">${esc(i.titulo || i.anuncio_id)}</a>` : esc(i.titulo || i.anuncio_id)} ${seloCatalogo(i.catalogo_origem)}</td>
      <td class="mono">${esc(i.anuncio_id)} <a href="#" class="mini" data-como-era="${esc(i.anuncio_id)}">Como era</a></td>${temSku ? `<td>${esc(i.sku || '—')}</td>` : ''}
      <td><span class="curva c${esc(i.curva)}">${esc(i.curva)}</span></td>
      <td>${esc(ROT_ST_AN[i.status_anuncio] || i.status_anuncio || '—')}</td>
      <td class="n">${brl2(i.preco)}</td><td class="n">${intPt(i.estoque)}</td>
      <td class="n">${intPt(i.vendas_unidades)}</td><td class="n">${brl2(i.faturamento)}</td><td class="n">${intPt(i.visitas)}</td>
      <td class="n">${i.conversao == null ? '—' : Number(i.conversao).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + '%'}</td>
      <td class="n">${temAds ? brl2(i.ads_custo) : '—'}</td>
    </tr>`
  alvo.innerHTML = `
    <p class="an-periodo"><b>${esc(r.periodo?.rotulo_data || 'Data da venda')}</b> · ${esc(r.periodo?.rotulo || '')}</p>
    <ul class="an-comp">${['anterior', 'ano_anterior'].filter(k => cmp[k]).map(k => linhaComparacao(cmp[k])).join('')}</ul>
    ${r.aviso ? `<div class="aviso">${esc(r.aviso)}</div>` : ''}
    <div class="kpis">
      <div class="kpi"><div class="rotulo">Anúncios</div><div class="valor">${intPt(t.anuncios)}</div><div class="detalhe">${filtrado ? `de ${intPt(r.total_sem_filtro)} da conta` : 'toda a conta'}</div></div>
      <div class="kpi"><div class="rotulo">Unidades</div><div class="valor">${intPt(t.vendas_unidades)}</div><div class="detalhe">${cmp.anterior?.delta_unidades_pct != null ? `<span class="${cmp.anterior.delta_unidades_pct >= 0 ? 'pos' : 'neg'}">${pctTxt(cmp.anterior.delta_unidades_pct)}</span> vs período anterior` : 'sem comparação'}</div></div>
      <div class="kpi"><div class="rotulo">Faturamento</div><div class="valor">${brlAbrev(t.faturamento)}</div><div class="detalhe">${cmp.anterior?.delta_faturamento_pct != null ? `<span class="${cmp.anterior.delta_faturamento_pct >= 0 ? 'pos' : 'neg'}">${pctTxt(cmp.anterior.delta_faturamento_pct)}</span> vs período anterior` : 'sem comparação'}</div></div>
      <div class="kpi"><div class="rotulo">Visitas</div><div class="valor">${t.anuncios_com_visitas ? intPt(t.visitas) : '—'}</div><div class="detalhe">conversão ${conv}${cobVis}${temAds ? ` · Ads ${brlAbrev(t.ads_custo)}` : ''}</div></div>
    </div>
    ${itens.length ? `
    <div class="an-barra"><span class="mini">${intPt(itens.length)} anúncio(s), por faturamento no período${itens.length >= 500 ? ' · lista limitada a 500' : ''}</span><button class="btn btn-p" type="button" data-csv>Baixar CSV</button></div>
    <div class="tabela-wrap fixa"><table class="t an-tab"><thead><tr><th></th><th>Anúncio</th><th>MLB</th>${temSku ? '<th>SKU</th>' : ''}<th>Curva</th><th>Status</th><th class="n">Preço</th><th class="n">Estoque</th><th class="n">Unidades</th><th class="n">Faturamento</th><th class="n">Visitas</th><th class="n">Conversão</th><th class="n">Ads</th></tr></thead>
      <tbody>${itens.slice(0, anLimite).map(linha).join('')}</tbody></table></div>
    ${itens.length > anLimite ? `<div class="t-pag">1–${anLimite} de ${intPt(itens.length)} <button class="btn btn-p" type="button" data-mais>Mostrar mais</button></div>` : ''}`
    : '<div class="vazio-box"><b>Nenhum anúncio com esses filtros no período.</b>Ajuste as condições ou o período em Filtrar anúncios.</div>'}`
  alvo.querySelector('[data-mais]')?.addEventListener('click', () => { anLimite += PAGINA; desenharAnuncios(alvo, cliente) })
  alvo.querySelectorAll('[data-como-era]').forEach(a => a.onclick = e => { e.preventDefault(); window.PSHistorico?.abrir(cliente, a.dataset.comoEra) })   // "Como era" do anúncio (fotografias + diff + veredito do Merovíngio)
  alvo.querySelector('[data-csv]')?.addEventListener('click', () => baixarCsvAnuncios(cliente))
}
// CSV gerado no navegador a partir da lista filtrada inteira (não só as 50 da tela); ; como separador e vírgula decimal, como o do servidor
function baixarCsvAnuncios(cliente) {
  const r = anDados; if (!r?.itens?.length) return
  const cel = v => { let s = String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' '); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s}"` }
  const num = v => v == null ? '' : String(v).replace('.', ',')
  const cols = ['Anúncio (MLB)', 'Título', 'Link', 'SKU', 'Curva', 'Status', 'Logística', 'Preço', 'Estoque', 'Unidades', 'Faturamento', 'Visitas', 'Conversão %', 'Ads custo', 'Unidades período anterior', 'Faturamento período anterior', 'Unidades ano anterior', 'Faturamento ano anterior', 'Criado em']
  const linhas = r.itens.map(i => [i.anuncio_id, i.titulo, i.permalink, i.sku, i.curva, ROT_ST_AN[i.status_anuncio] || i.status_anuncio, i.logistica, num(i.preco), i.estoque, i.vendas_unidades, num(i.faturamento), i.visitas, num(i.conversao), num(i.ads_custo), i.anterior?.vendas_unidades, num(i.anterior?.faturamento), i.ano_anterior?.vendas_unidades, num(i.ano_anterior?.faturamento), i.criado_em])
  const cab = [`"Cliente: ${cliente.replace(/"/g, '""')}"`, `"${String(r.periodo?.rotulo || '').replace(/"/g, '""')}"`, r.aviso ? `"${r.aviso.replace(/"/g, '""')}"` : ''].filter(Boolean).join(';')
  const csv = '﻿' + [cab, cols.map(cel).join(';'), ...linhas.map(l => l.map(cel).join(';'))].join('\r\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  a.download = `anuncios-${cliente.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}-${r.periodo?.de || ''}-${r.periodo?.ate || ''}.csv`
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

// ── folha do anúncio (Resumo): GET /api/cliente/folha?cliente=&blocos=&ff=&ordem=&pagina= — uma linha por anúncio com os tópicos marcados ──
// As caixas são lembradas por cliente (localStorage ps_folha:<cliente>, try/catch) e espelhadas em ?folha=; o filtro do painel 'folha' vai em ?ff=
// (o ?f= da mesma tela é o de "Anúncios no período"). A resposta fica em cache: desmarcar uma caixa só esconde a coluna (projeção, sem nova busca);
// marcar uma que o cache não tem, mudar ordem, filtro ou página busca de novo. Leitura cruzada só com os 4. Dado não coletado é "—", nunca 0.
// Os controles (caixas, filtro, ordem, CSV) são montados uma vez por cliente; só #folhaCorpo é redesenhado — o foco fica onde a pessoa estava.
const FOLHA_BLOCOS = [['anuncios', 'Anúncios — ofertas e promoções'], ['ads', 'Ads'], ['full', 'Full'], ['metricas', 'Métricas']]
const FOLHA_COL = { anuncios: 'Ofertas e promoções', ads: 'Ads · 28 dias', full: 'Full', metricas: 'Métricas · período' }
const FOLHA_ORDENS = [['faturamento', 'Maior faturamento', null], ['variacao', 'Piores variações', 'metricas'], ['conversao', 'Maior conversão', 'metricas'], ['desconto', 'Maior desconto', 'anuncios'], ['ads_custo', 'Maior gasto em Ads', 'ads'], ['roas', 'Menor ROAS (com gasto)', 'ads'], ['cobertura', 'Menos dias de estoque', 'full']]
const chaveFolha = c => 'ps_folha:' + c
const lerFolha = c => { try { return localStorage.getItem(chaveFolha(c)) } catch { return null } }          // null = nunca abriu neste navegador
const gravarFolha = (c, v) => { try { localStorage.setItem(chaveFolha(c), v) } catch { /* sem armazenamento: só não lembra */ } }
const marcadosDe = s => new Set(String(s ?? '').split(',').filter(b => FOLHA_BLOCOS.some(x => x[0] === b)))   // lista fechada: chave estranha é descartada
const blocosMarcados = () => FOLHA_BLOCOS.map(b => b[0]).filter(b => F.marcados.has(b))
let folhaSeq = 0
const F = { cliente: '', marcados: new Set(), ordem: 'faturamento', ff: null, cache: null, itens: [], cont: {}, abertos: new Set(), timers: [] }
const pararApresentacao = () => { F.timers.forEach(clearTimeout); F.timers = [] }
const precisaBuscar = () => !F.cache || F.cache.cliente !== F.cliente || [...F.marcados].some(b => !F.cache.blocos.includes(b))
function carregarFolha(cliente) {
  const alvo = $('folha'); if (!alvo) return
  pararApresentacao()
  Object.assign(F, { cliente, ordem: 'faturamento', ff: null, cache: null, itens: [], cont: {}, abertos: new Set() })
  const daUrl = new URLSearchParams(location.search).get('folha'), salvo = lerFolha(cliente)
  const primeira = daUrl == null && salvo == null
  F.marcados = daUrl != null ? marcadosDe(daUrl) : salvo != null ? marcadosDe(salvo) : new Set(FOLHA_BLOCOS.map(b => b[0]))
  alvo.innerHTML = `
    <fieldset class="folha-caixas" id="folhaCaixas"><legend>Marque os tópicos que quer ver na folha</legend>
      ${FOLHA_BLOCOS.map(([k, r]) => `<label><input type="checkbox" data-topico="${k}"${F.marcados.has(k) ? ' checked' : ''}> ${r} <span class="n" data-n="${k}"></span></label>`).join('')}
      <button class="btn btn-p" type="button" id="btnFolhaTudo" hidden>Marcar tudo e ver a leitura</button>
    </fieldset>
    <div id="fltFolha"></div>
    <div class="an-barra mt-2"><label class="folha-ordem">Ordenar por <select id="folhaOrdem">${FOLHA_ORDENS.map(([k, r]) => `<option value="${k}">${r}</option>`).join('')}</select></label>
      <a class="btn btn-p" id="btnFolhaCsv" href="#">Baixar a folha (com filtros e tópicos marcados)</a></div>
    <p class="mini" id="folhaResumo" aria-live="polite"></p>
    <div id="folhaCorpo">${SK('sk-kpi', 'sk-tabela')}</div>`
  const caixas = $('folhaCaixas')
  caixas.querySelectorAll('[data-topico]').forEach(cb => cb.onchange = () => { pararApresentacao(); cb.checked ? F.marcados.add(cb.dataset.topico) : F.marcados.delete(cb.dataset.topico); mudouMarcados(cliente) })
  $('btnFolhaTudo').onclick = () => { pararApresentacao(); caixas.querySelectorAll('[data-topico]').forEach(cb => { cb.checked = true; F.marcados.add(cb.dataset.topico) }); mudouMarcados(cliente); caixas.querySelector('[data-topico]').focus() }   // o botão some com as 4: o foco vai à 1ª caixa
  $('folhaOrdem').onchange = e => { F.ordem = e.target.value; F.cache = null; atualizarControlesFolha(); buscarFolha(cliente) }
  let aplicou = false
  const aplicar = f => { aplicou = true; F.ff = f; F.cache = null; F.cont = {}; atualizarControlesFolha(); F.marcados.size ? buscarFolha(cliente) : desenharFolha() }   // contadores são do recorte: filtro novo zera até a resposta
  if (window.PSFiltros) PSFiltros.montar($('fltFolha'), { painel: 'folha', parametro: 'ff', periodoPadrao: 'ultimos_90_dias', rotuloAbrir: 'Filtrar a folha', aoAplicar: (_def, f) => aplicar(f) })
  // ponytail: se a definição dos filtros não vier (componente ausente ou API fora), a folha ainda carrega com o período padrão da API
  setTimeout(() => { if (!aplicou && dados?.cliente === cliente) aplicar(null) }, 4000)
  atualizarControlesFolha()
  if (!F.marcados.size) desenharFolha()
  if (primeira) apresentacaoFolha(cliente, caixas)
}
// 1ª abertura por cliente e navegador: abre com as 4 marcadas e desmarca Anúncios → Ads → Full, ~1,5 s cada, até sobrar Métricas — a pessoa vê que as
// opções existem. Com prefers-reduced-motion desmarca as três de uma vez. Sem nova busca: a resposta das 4 fica em cache e as colunas só se escondem.
// Qualquer clique ou tecla da pessoa no bloco (caixas, ordem, filtro, "Ver tudo", links da tabela) interrompe: cada passo redesenha a tabela e levaria o foco embora.
function apresentacaoFolha(cliente, caixas) {
  for (const ev of ['pointerdown', 'keydown']) $('folha').addEventListener(ev, pararApresentacao, { capture: true, once: true })
  const desmarcar = ks => { if (dados?.cliente !== cliente) return; for (const k of ks) { const cb = caixas.querySelector(`[data-topico="${k}"]`); if (cb) cb.checked = false; F.marcados.delete(k) } mudouMarcados(cliente) }
  const ordem = ['anuncios', 'ads', 'full']
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) F.timers.push(setTimeout(() => desmarcar(ordem), 1500))
  else ordem.forEach((k, i) => F.timers.push(setTimeout(() => desmarcar([k]), 1500 * (i + 1))))
}
function mudouMarcados(cliente) {
  const lista = blocosMarcados().join(',')
  gravarFolha(cliente, lista)
  const u = new URL(location.href); if (lista) u.searchParams.set('folha', lista); else u.searchParams.delete('folha'); history.replaceState(history.state, '', u)
  const ord = FOLHA_ORDENS.find(o => o[0] === F.ordem)
  if (ord?.[2] && !F.marcados.has(ord[2])) { F.ordem = 'faturamento'; F.cache = null }   // a ordem exige o bloco dela: volta ao padrão (e busca de novo)
  atualizarControlesFolha()
  if (!F.marcados.size) return desenharFolha()
  precisaBuscar() ? buscarFolha(cliente) : desenharFolha()
}
// contador de cada caixa: o último número conhecido do tópico (vem com a resposta que o incluiu, sobre o recorte filtrado); desconhecido fica vazio
function contadorFolha(b, r) {
  const t = r.totais?.[b] || {}, h = r.honestidade?.[b] || {}
  if (b === 'metricas') return `(${intPt(r.total)} anúncios)`
  if (!h.disponivel) return { anuncios: '(promoções não coletadas)', ads: '(Ads não coletado)', full: '(logística não coletada)' }[b]
  return { anuncios: `(${intPt(t.em_promocao)} em promoção)`, ads: `(${intPt(t.anunciando)} anunciando)`, full: `(${intPt(t.no_full)} no Full)` }[b]
}
function atualizarControlesFolha() {
  const n = F.marcados.size, bt = $('btnFolhaTudo'), sel = $('folhaOrdem'), csv = $('btnFolhaCsv')
  if (bt) bt.hidden = n === FOLHA_BLOCOS.length
  if (sel) { sel.value = F.ordem; sel.querySelectorAll('option').forEach(o => { const b = FOLHA_ORDENS.find(x => x[0] === o.value)?.[2]; o.disabled = !!b && !F.marcados.has(b) }) }
  if (csv) {
    const q = new URLSearchParams({ cliente: F.cliente, blocos: blocosMarcados().join(','), ordem: F.ordem }); if (F.ff) q.set('ff', F.ff)
    if (n) { csv.href = '/api/cliente/folha.csv?' + q; csv.removeAttribute('aria-disabled') } else { csv.removeAttribute('href'); csv.setAttribute('aria-disabled', 'true') }
  }
  document.querySelectorAll('#folhaCaixas [data-n]').forEach(s => { s.textContent = F.cont[s.dataset.n] || '' })
}
async function buscarFolha(cliente, pagina = 1) {
  const corpo = $('folhaCorpo'); if (!corpo || !F.marcados.size) return
  const seq = ++folhaSeq
  if (pagina === 1) corpo.innerHTML = SK('sk-kpi', 'sk-tabela')
  const blocos = pagina === 1 ? blocosMarcados() : F.cache.blocos                      // páginas seguintes com os blocos do cache: as linhas têm a mesma forma
  const q = new URLSearchParams({ cliente, blocos: blocos.join(','), ordem: F.ordem, pagina: String(pagina) }); if (F.ff) q.set('ff', F.ff)
  try {
    const r = await api('/api/cliente/folha?' + q)
    if (seq !== folhaSeq || dados?.cliente !== cliente) return
    if (!r.disponivel) { pararApresentacao(); const alvo = $('folha'); alvo.innerHTML = NAO_CONECTADO(cliente, r); ligarColetar(alvo); return }
    F.cache = r; F.itens = pagina === 1 ? r.itens : F.itens.concat(r.itens)
    folhaN = r.total; const nb = $('nFolha'); if (nb) nb.textContent = intPt(r.total)
    for (const b of r.blocos) F.cont[b] = contadorFolha(b, r)
    atualizarControlesFolha()
    if (precisaBuscar()) return buscarFolha(cliente)                                   // marcou um tópico enquanto a resposta vinha
    desenharFolha()
    // a tabela foi redesenhada: o foco vai ao novo "Mostrar mais" (ou ao 1º link das linhas novas), não volta ao topo da página
    if (pagina > 1) (corpo.querySelector('[data-mais]') || corpo.querySelectorAll('tbody tr:not(.det)')[(pagina - 1) * PAGINA]?.querySelector('a, button'))?.focus()
  } catch (e) {
    if (seq !== folhaSeq) return
    if (pagina > 1) { toast(e.message, 'erro'); const b = corpo.querySelector('[data-mais]'); if (b) b.disabled = false } else erroBloco(corpo, e, () => buscarFolha(cliente, pagina))
  }
}
const foL = (...ls) => ls.filter(Boolean).map(l => `<span class="fo-l">${l}</span>`).join('') || '—'   // célula de 2–3 linhas; sem nada = "—"
const pct0 = v => v == null ? '—' : nPt(v, 0) + '%'
const pct2 = v => v == null ? '—' : nPt(v, 2) + '%'
const desdeTxt = d => d ? brData(d) : '— (sem mudança registrada em 30 dias)'
const FO_CEL = {
  anuncios: a => { const p = a.promocao
    return foL(p.estado == null ? '<span class="mudo">promoções —</span>' : p.estado === 'started' ? `<b>Em promoção</b> ${esc(p.tipo || '')}${p.desconto_pct > 0 ? ` −${Math.round(p.desconto_pct)}%` : ''}` : 'Sem promoção',
      p.estado === 'started' ? `${brl2(p.preco)}${p.preco_original ? ` <span class="mudo">de ${brl2(p.preco_original)}</span>` : ''}${p.fim ? ` · até ${brData(p.fim)}` : ''}` : p.estado != null && a.candidatas > 0 ? `${intPt(a.candidatas)} campanha(s) candidata(s)` : '',
      a.oferta ? `Ofertas: ${esc(a.oferta.estado_rotulo)}` : a.mudancas_preco_28d ? `preço mudou ${intPt(a.mudancas_preco_28d)}× em 28 dias` : a.custo ? `custo ${brl2(a.custo.custo)}` : '') },
  ads: a => !a ? '<span class="mudo">Ads —</span>' : a.status === 'sem_anuncio' ? foL('Sem anúncio de Ads')
    : foL(`<b>${esc(a.status_rotulo)}</b>`, `${brl2(a.custo)} · ROAS ${a.roas == null ? '—' : nPt(a.roas, 2)}`, `ACOS ${pct0(a.acos)} · ${intPt(a.unidades)} un por Ads`),
  full: f => f.no_full == null ? '<span class="mudo">logística —</span>'
    : foL(f.no_full ? '<b>No Full</b>' : `Fora do Full · ${esc(f.logistica_rotulo || '—')}`, f.cobertura_dias == null ? 'dias de estoque —' : `${nPt(f.cobertura_dias, 0)} dias de estoque`, f.risco_ruptura ? '<span class="selo ruim">risco de ruptura</span>' : f.sugestao ? `enviar ${intPt(f.sugestao.base)} un (cenário base)` : ''),
  metricas: m => foL(`<b>${brl2(m.faturamento)}</b>${m.delta_faturamento_pct != null ? ` <span class="${m.delta_faturamento_pct >= 0 ? 'pos' : 'neg'}">${pctTxt(m.delta_faturamento_pct)}</span>` : ''}`, `${intPt(m.unidades)} un · ${m.visitas == null ? 'visitas —' : intPt(m.visitas) + ' visitas'}`, `conversão ${pct2(m.conversao)}`),
  leitura: l => foL(`<span class="elo-t fato">fato</span> ${esc(l.fatos[0] || '')}`, l.hipoteses.length ? `<span class="elo-t hipotese">hipótese</span> ${esc(l.hipoteses[0])}` : '<span class="mudo">sem hipótese registrada</span>', l.acoes.length ? `${l.acoes.length} ação(ões) do plano` : '<span class="mudo">nenhuma ação do plano</span>'),
}
// KPI por tópico marcado (no máximo 4; o valor nunca é colorido, o tom só no ponto do rótulo)
function kpiFolha(b, r) {
  const t = r.totais?.[b] || {}, h = r.honestidade?.[b] || {}
  const kp = (rot, v, det, cls = '') => `<div class="kpi ${cls}"><div class="rotulo">${rot}</div><div class="valor${v === '—' ? ' sem' : ''}">${v}</div><div class="detalhe">${det}</div></div>`
  if (b === 'anuncios') return kp('Em promoção agora', intPt(t.em_promocao), h.disponivel ? `de ${intPt(r.total)} · desconto mediano ${pct0(t.desconto_mediano_pct)} · ${intPt(t.com_oferta_ativa)} com oferta estratégica` : 'promoções não coletadas')
  if (b === 'ads') return kp('Ads em 28 dias', t.custo == null ? '—' : brlAbrev(t.custo), h.disponivel ? `ROAS ${t.roas == null ? '—' : nPt(t.roas, 2)} · receita ${brlAbrev(t.receita)} · ${intPt(t.anunciando)} anunciando` : 'Ads não coletado nesta conta')
  if (b === 'full') return kp('No Full', intPt(t.no_full), h.disponivel ? `${pct0(t.share_receita_pct)} da receita · ${intPt(t.risco_ruptura)} com risco de ruptura` : 'logística não coletada', t.risco_ruptura ? 'alerta' : '')
  return kp('Faturamento no período', brlAbrev(t.faturamento), `${t.delta_faturamento_pct != null ? `<span class="${t.delta_faturamento_pct >= 0 ? 'pos' : 'neg'}">${pctTxt(t.delta_faturamento_pct)}</span> vs período anterior` : 'sem comparação'} · conversão ${pct2(t.conversao)}`)
}
// ressalva honesta por tópico (data da coleta e o que não cobre); tópico não coletado ganha o selo e, nas promoções, o caminho para ligar a coleta
function ressalvaFolha(b, r) {
  const h = r.honestidade?.[b]; if (!h) return ''
  const extra = b === 'anuncios' && !h.disponivel ? ` <a href="/promocoes?cliente=${encodeURIComponent(r.cliente)}">Promoções</a> · <button class="btn-mini" type="button" data-ir-configurar>Configurar</button>` : ''
  return `<li>${h.disponivel ? '' : '<span class="selo atencao">não coletado</span> '}<b>${esc(FOLHA_BLOCOS.find(x => x[0] === b)[1])}:</b> ${esc(h.ressalva)}${h.aviso_cobertura ? ' ' + esc(h.aviso_cobertura) : ''}${extra}</li>`
}
// "Ver tudo": os detalhes de cada tópico marcado e, com os 4, a leitura, as ações do plano (link para a aba Plano) e o que mudou em 30 dias
function detFolha(it, marc, leitura) {
  const li = (k, v) => `<li><span class="mudo">${k}:</span> ${v}</li>`, g = (tit, itens) => `<div class="fo-grupo"><h4>${tit}</h4><ul>${itens.join('')}</ul></div>`
  const grupos = []
  if (marc.includes('anuncios')) { const a = it.anuncios, p = a.promocao; grupos.push(g('Ofertas e promoções', [
    li('Promoção', p.estado == null ? '— (não coletada)' : p.estado === 'started' ? `em promoção${p.tipo ? ' ' + esc(p.tipo) : ''}${p.nome ? ` (${esc(p.nome)})` : ''}` : 'sem promoção'),
    li('Desconto', p.desconto_pct == null ? '—' : `−${Math.round(p.desconto_pct)}%`), li('Preço na promoção', `${brl2(p.preco)}${p.preco_original ? ` (de ${brl2(p.preco_original)})` : ''}`), li('Fim', brData(p.fim)), li('Em promoção desde', p.estado == null ? '—' : desdeTxt(p.desde)),
    li('Campanhas candidatas', intPt(a.candidatas)), li('Ofertas Estratégicas', a.oferta ? `${esc(a.oferta.estado_rotulo)}${a.oferta.publicado_em ? ` · publicada em ${brData(a.oferta.publicado_em)}` : a.oferta.otimizado_em ? ` · ${brData(a.oferta.otimizado_em)}` : ''}` : 'não otimizado'),
    li('Preço', `${brl2(a.preco)}${a.preco_original ? ` · riscado ${brl2(a.preco_original)}` : ''}`), li('Mudanças de preço em 28 dias', intPt(a.mudancas_preco_28d)), li('Custo', a.custo ? `${brl2(a.custo.custo)} (${esc(a.custo.origem)})` : '—')])) }
  if (marc.includes('ads')) { const a = it.ads; grupos.push(g('Ads · 28 dias', !a ? [li('Ads', '— (não coletado nesta conta)')] : [
    li('Status', esc(a.status_rotulo)), li('Custo', brl2(a.custo)), li('Receita', brl2(a.receita)), li('ROAS', a.roas == null ? '—' : nPt(a.roas, 2)), li('ACOS', pct0(a.acos)), li('CTR', pct2(a.ctr)), li('Unidades por Ads', intPt(a.unidades)),
    li('Variação do custo vs 28 dias anteriores', pctTxt(a.custo_var_pct)), li('Ads ligado ou desligado desde', desdeTxt(a.desde))])) }
  if (marc.includes('full')) { const f = it.full; grupos.push(g('Full', [
    li('No Full', f.no_full == null ? '— (logística não coletada)' : f.no_full ? 'sim' : 'não'), li('Logística', esc(f.logistica_rotulo || '—')), li('Estoque', intPt(f.estoque)), li('Dias de estoque', f.cobertura_dias == null ? '—' : nPt(f.cobertura_dias, 0)),
    li('Risco de ruptura', f.risco_ruptura == null ? '—' : f.risco_ruptura ? 'sim (menos de 10 dias)' : 'não'),
    li('Sugestão de envio', f.sugestao ? `${intPt(f.sugestao.conservador)} · ${intPt(f.sugestao.base)} · ${intPt(f.sugestao.crescimento)} un (conservador · base · crescimento) — ${esc(f.sugestao.premissa)}; sugere, nunca movimenta estoque` : '—'), li('No Full desde', f.no_full == null ? '—' : desdeTxt(f.desde))])) }
  if (marc.includes('metricas')) { const m = it.metricas; grupos.push(g('Métricas · período', [
    li('Unidades', intPt(m.unidades)), li('Faturamento', brl2(m.faturamento)), li('Variação vs período anterior', pctTxt(m.delta_faturamento_pct)), li('Visitas', m.visitas == null ? '— (fora da cobertura de visitas)' : intPt(m.visitas)),
    li('Conversão', pct2(m.conversao)), li('Preço realizado', brl2(m.preco_realizado)), li('Curva', esc(m.curva))])) }
  if (leitura && it.leitura) { const l = it.leitura
    grupos.push(g('Leitura do anúncio', [...l.fatos.map(t => `<li><span class="elo-t fato">fato</span> ${esc(t)}</li>`), ...l.hipoteses.map(t => `<li><span class="elo-t hipotese">hipótese</span> ${esc(t)}</li>`)]))
    grupos.push(g('Ações do plano', l.acoes.length ? l.acoes.map(a => `<li>${a.p ? `<span class="p-badge p-${esc(a.p)}">${esc(a.p)}</span> ` : ''}${esc(a.titulo)} <span class="mudo">(${esc(a.status)})</span> <button class="btn-mini" type="button" data-ver-plano-anuncio>Ver no plano</button></li>`) : ['<li class="mudo">Nenhuma ação do plano para este anúncio.</li>']))
    grupos.push(g('O que mudou em 30 dias', l.eventos.length ? l.eventos.map(e => `<li>${brData(e.dia)} · ${esc(e.texto)}</li>`) : ['<li class="mudo">Nenhuma mudança registrada (preço, promoção, Ads, Full, estoque, status).</li>'])) }
  else grupos.push(g('Leitura, ações do plano e o que mudou em 30 dias', ['<li class="mudo">Aparecem com os 4 tópicos marcados.</li>']))
  return `<div class="fo-det grade">${grupos.join('')}</div>`
}
function desenharFolha() {
  const corpo = $('folhaCorpo'); if (!corpo) return
  const marc = blocosMarcados(), r = F.cache, res = $('folhaResumo')
  if (!marc.length) { if (res) res.textContent = ''; corpo.innerHTML = '<div class="vazio-box"><b>Marque pelo menos um tópico para montar a folha.</b>Cada caixa põe os números daquele tópico numa coluna, uma linha por anúncio.</div>'; return }
  if (!r) return                                                                          // a busca está a caminho (skeleton)
  const leitura = marc.length === FOLHA_BLOCOS.length && r.leitura_cruzada, ncol = 1 + marc.length + (leitura ? 1 : 0)
  if (res) res.textContent = `${intPt(r.total)} anúncio(s) · ${marc.length} tópico(s)${leitura ? ' · leitura cruzada' : ''}${r.total_sem_filtro !== r.total ? ` · filtro ativo: ${intPt(r.total_sem_filtro)} na conta` : ''}`
  const linha = it => { const id = esc(it.anuncio_id), aberto = F.abertos.has(it.anuncio_id), det = `fdet-${id}`
    return `<tr>
      <td data-rotulo="Anúncio"><div class="fo-an">${miniAn(it.thumb, '', it.anuncio_id)}<div>${urlOk(it.permalink) ? `<a class="fo-tit" href="${esc(urlOk(it.permalink))}" target="_blank" rel="noopener">${esc((it.titulo || it.anuncio_id).slice(0, 80))} ↗</a>` : `<b>${esc((it.titulo || it.anuncio_id).slice(0, 80))}</b>`}
        <div class="mini">${seloCatalogo(it.catalogo_origem)} ${id} · ${esc(ROT_ST_AN[it.status_anuncio] || it.status_anuncio || '—')} · ${brl2(it.preco)} · estoque ${intPt(it.estoque)} · <span class="curva c${esc(it.curva)}">${esc(it.curva)}</span>${it.sku ? ` · SKU ${esc(it.sku)}` : ''}</div>
        <button class="btn-mini" type="button" data-det="${id}" aria-expanded="${aberto}" aria-controls="${det}">${aberto ? 'Fechar' : 'Ver tudo'}</button></div></td>
      ${marc.map(b => `<td class="fo-cel" data-rotulo="${FOLHA_COL[b]}"><div>${FO_CEL[b](it[b])}</div></td>`).join('')}${leitura ? `<td class="fo-cel" data-rotulo="Leitura"><div>${FO_CEL.leitura(it.leitura)}</div></td>` : ''}
    </tr><tr class="det" id="${det}"${aberto ? '' : ' hidden'}><td colspan="${ncol}">${detFolha(it, marc, leitura)}</td></tr>` }
  corpo.innerHTML = `
    <p class="an-periodo"><b>Data da venda</b> · ${esc(r.periodo?.rotulo || '')} · Ads e dias de estoque dos últimos 28 dias (${brData(r.janela_28d?.de)}–${brData(r.janela_28d?.ate)})</p>
    <div class="kpis">${marc.map(b => kpiFolha(b, r)).join('')}</div>
    <ul class="an-comp">${marc.map(b => ressalvaFolha(b, r)).join('')}</ul>
    ${F.itens.length ? `<div class="tabela-wrap fixa"><table class="t empilha folha"><caption class="sr">Folha do anúncio de ${esc(r.cliente)}</caption><thead><tr><th scope="col">Anúncio</th>${marc.map(b => `<th scope="col">${FOLHA_COL[b]}</th>`).join('')}${leitura ? '<th scope="col">Leitura</th>' : ''}</tr></thead>
      <tbody>${F.itens.map(linha).join('')}</tbody></table></div>
    ${r.pagina < r.paginas ? `<div class="t-pag">1–${intPt(F.itens.length)} de ${intPt(r.total)} <button class="btn btn-p" type="button" data-mais>Mostrar mais</button></div>` : ''}`
    : '<div class="vazio-box"><b>Nenhum anúncio com esses filtros no período.</b>Ajuste as condições ou o período em Filtrar a folha.</div>'}`
  corpo.querySelector('[data-mais]')?.addEventListener('click', e => { e.currentTarget.disabled = true; buscarFolha(F.cliente, r.pagina + 1) })
  corpo.querySelectorAll('[data-det]').forEach(b => b.onclick = () => { const d = $(b.getAttribute('aria-controls')); if (!d) return; d.hidden = !d.hidden; d.hidden ? F.abertos.delete(b.dataset.det) : F.abertos.add(b.dataset.det); b.setAttribute('aria-expanded', String(!d.hidden)); b.textContent = d.hidden ? 'Ver tudo' : 'Fechar' })
  corpo.querySelectorAll('[data-ver-plano-anuncio]').forEach(b => b.onclick = () => { mostrarPlano('anuncio'); mostrarAba('plano'); $('secPlanoConta')?.scrollIntoView() })
  corpo.querySelector('[data-ir-configurar]')?.addEventListener('click', () => { mostrarAba('configurar'); const s = $('pfPromocoes'); if (s) { s.focus(); s.scrollIntoView() } })
}

// ── cronologia de preços: GET /api/cliente/precos (50 por página no servidor; "Mostrar mais" traz a próxima e acrescenta) ──
// Cada mudança com a tarefa que coincide (etiqueta do servidor) e vendas/dia 7d antes → depois: variação observada, sem controle.
const SELO_ETIQUETA = { 'a própria tarefa': 'azul', 'pode ter interferido': 'atencao' }
let precosSeq = 0
async function carregarPrecos(cliente, pagina = 1, anteriores = []) {
  const alvo = $('precos'); if (!alvo) return
  const seq = ++precosSeq
  if (pagina === 1) alvo.innerHTML = SK('sk-tabela')
  try {
    const r = await api(`/api/cliente/precos?cliente=${encodeURIComponent(cliente)}&dias=90&pagina=${pagina}`)
    if (seq !== precosSeq || dados?.cliente !== cliente) return
    if (r.disponivel === false) { alvo.innerHTML = NAO_CONECTADO(cliente, r); ligarColetar(alvo); return }
    desenharPrecos(alvo, cliente, r, anteriores.concat(r.eventos))
    // a tabela foi redesenhada: o foco vai ao novo "Mostrar mais" (ou ao 1º link das linhas novas), não volta ao topo da página
    if (pagina > 1) (alvo.querySelector('[data-mais]') || alvo.querySelectorAll('tbody tr')[anteriores.length]?.querySelector('a'))?.focus()
  } catch (e) {
    if (seq !== precosSeq) return
    // falha da página 2+: as linhas já carregadas ficam; o erro e o "Tentar de novo" (a MESMA página) vão só no rodapé
    const pag = pagina > 1 && alvo.querySelector('.t-pag')
    if (!pag) return erroBloco(alvo, e, () => carregarPrecos(cliente))
    pag.innerHTML = `<span class="mudo">A próxima página não veio do servidor (${esc(e.message)}).</span> <button class="btn btn-p" type="button" data-mais>Tentar de novo</button>`
    pag.querySelector('[data-mais]').onclick = ev => { ev.currentTarget.disabled = true; carregarPrecos(cliente, pagina, anteriores) }
    pag.querySelector('[data-mais]').focus()
  }
}
function desenharPrecos(alvo, cliente, r, evs) {
  const diaMesAno = e => e.incerteza ? esc(e.incerteza) : brData(e.dia)
  // mudança de centavos (abaixo de 0,1%) aparece em reais: "+0%" esconderia que o preço mudou
  const variacao = e => e.variacao_pct != null && Math.abs(e.variacao_pct) >= 0.1 ? pctTxt(e.variacao_pct) : e.de != null && e.para != null ? `${e.para > e.de ? '+' : '−'}${brl2(Math.abs(e.para - e.de))}` : '—'
  const vendas = v => v.antes == null && v.depois == null ? '<span class="mudo">sem coleta</span>'
    : `<span>${nPt(v.antes, 1)} → ${nPt(v.depois, 1)}${v.variacao_pct != null ? ` <b class="${v.variacao_pct >= 0 ? 'pos' : 'neg'}">${pctTxt(v.variacao_pct)}</b>` : ''}${v.dias_depois && v.dias_depois < 7 ? ` <span class="mudo">(${v.dias_depois} dia(s) depois)</span>` : ''}</span>`
  const tarefa = t => !t ? '' : `<div class="mini"><span class="selo ${SELO_ETIQUETA[t.etiqueta] || 'neutro'}">${esc(t.etiqueta)}</span> ${urlOk(t.url) ? `<a href="${esc(urlOk(t.url))}" target="_blank" rel="noopener">${esc((t.titulo || 'tarefa').slice(0, 70))} ↗</a>` : esc((t.titulo || 'tarefa').slice(0, 70))}</div>`
  const linha = e => `<tr>
      <td data-rotulo="Anúncio"><div class="pc-an">${miniAn(e.thumb, '', e.item_id)}<div>${urlOk(e.permalink) ? `<a href="${esc(urlOk(e.permalink))}" target="_blank" rel="noopener">${esc((e.titulo || e.item_id).slice(0, 80))} ↗</a>` : esc((e.titulo || e.item_id).slice(0, 80))}<div class="mini">${esc(e.item_id)} ${seloCatalogo(e.catalogo_origem)}</div>${tarefa(e.tarefa)}</div></div></td>
      <td data-rotulo="Dia">${diaMesAno(e)}</td>
      <td class="n" data-rotulo="De → Para">${brl2(e.de)} → ${brl2(e.para)}</td>
      <td class="n" data-rotulo="Variação">${variacao(e)}</td>
      <td data-rotulo="Origem">${esc(e.origem)}</td>
      <td class="n" data-rotulo="Vendas/dia 7d antes → depois">${vendas(e.vendas_dia || {})}</td>
    </tr>`
  alvo.innerHTML = `<p class="mini">${esc(r.aviso)}</p>` + (evs.length ? `
    <div class="tabela-wrap mt-2"><table class="empilha"><thead><tr><th>Anúncio</th><th>Dia</th><th class="n">De → Para</th><th class="n">Variação</th><th>Origem</th><th class="n">Vendas/dia 7d antes → depois</th></tr></thead>
      <tbody>${evs.map(linha).join('')}</tbody></table></div>
    ${r.pagina < r.paginas ? `<div class="t-pag">1–${evs.length} de ${intPt(r.total)} <button class="btn btn-p" type="button" data-mais>Mostrar mais</button></div>` : ''}`
    : `<div class="vazio-box mt-2"><b>Nenhuma mudança de preço registrada nos últimos ${r.dias} dias.</b>Sem registro não quer dizer preço parado: só entra o que a coleta diária, as promoções e as fotografias das tarefas viram.</div>`)
  alvo.querySelector('[data-mais]')?.addEventListener('click', e => { e.currentTarget.disabled = true; carregarPrecos(cliente, r.pagina + 1, evs) })
}

const ROT_ESTADO = { melhorou: 'Melhorou', piorou: 'Piorou', sem_efeito: 'Sem efeito distinguível', lancamento: 'Lançamento', em_maturacao: 'Em maturação', sem_base: 'Sem base', sem_controle: 'Sem controle', variacao_conta: 'Conta inteira' }
async function carregarImpacto(cliente) {
  const alvo = $('impacto'); if (!alvo) return
  try {
    const r = await api('/api/cliente/impacto?cliente=' + encodeURIComponent(cliente))
    if (dados?.cliente !== cliente) return
    if (!r.disponivel) { alvo.innerHTML = NAO_CONECTADO(cliente, r); ligarColetar(alvo); return }
    const s = r.resumo, nao = r.nao_mensuraveis
    const medidas = r.medidas.filter(m => ['melhorou', 'piorou', 'lancamento', 'sem_efeito'].includes(m.estado))
    alvo.innerHTML = `
      <div class="kpis">
        <div class="kpi ${s.melhorou ? 'bom' : ''}"><div class="rotulo">Melhoraram</div><div class="valor">${s.melhorou}</div><div class="detalhe">${brl(s.ganho_associado)} associados</div></div>
        <div class="kpi ${s.piorou ? 'ruim' : ''}"><div class="rotulo">Pioraram</div><div class="valor">${s.piorou}</div><div class="detalhe">${brl(s.perda_associada)} associados</div></div>
        <div class="kpi"><div class="rotulo">Lançamentos</div><div class="valor">${s.lancamento}</div><div class="detalhe">${s.lancamentos_que_venderam} venderam · ${brl(s.receita_lancamentos)}</div></div>
        <div class="kpi"><div class="rotulo">Sem atribuição</div><div class="valor">${s.variacao_conta + s.sem_base + s.sem_controle + s.em_maturacao}</div><div class="detalhe">${s.variacao_conta} de conta inteira · ${s.sem_base} sem base · ${s.em_maturacao} maturando</div></div>
      </div>
      <div class="aviso info mt-4">Não medidas por falta de conexão do canal: ${Object.entries(nao.por_canal).map(([c, n]) => `${n} de ${esc(c)}`).join(', ') || 'nenhuma'}. Tarefas de conta inteira (sem anúncio citado) não são atribuídas porque não dá para separá-las do mercado. Cite o ID do anúncio (MLB…) no card para a tarefa ser medida.</div>
      ${medidas.length ? medidas.slice(0, PAGINA).map(m => `
      <div class="acao"><div class="acao-topo"><div class="acao-corpo">
        <b>${esc(m.titulo)}</b>
        <div class="acao-meta"><span>${esc(m.tipo)}</span><span>${esc(m.analista || 'sem responsável')}</span><span>concluída em ${brData(m.data)}${m.data_estimada ? ' (estimada)' : ''}</span>${m.itens.length ? `<span>${m.itens.length} anúncio(s) citado(s)</span>` : ''}</div>
        <div class="acao-tags"><span class="estado e-${esc(m.estado)}">${ROT_ESTADO[m.estado]}</span>
          ${m.estado === 'lancamento' ? `<span class="tagzinha">${m.subtipo === 'novo' ? 'anúncio novo' : 'anúncio reativado'}</span><span class="tagzinha ${m.lancamento.vendeu ? 'fato' : ''}">${m.lancamento.vendeu ? `vendeu ${m.lancamento.unidades} un · ${brl(m.lancamento.receita)}` : 'sem venda ainda'}</span>` : `<span class="tagzinha ${m.efeito_pct >= 0 ? 'fato' : ''}">efeito em ${esc(m.metrica_primaria)}: ${sg(m.efeito_pct)}</span>`}
          ${m.confianca ? `<span class="tagzinha">confiança ${m.confianca.score} · ${esc(m.confianca.classe)}</span>` : ''}${m.reversao_provavel ? '<span class="tagzinha">possível reversão à média</span>' : ''}${['melhorou', 'piorou'].includes(m.estado) && m.receita_estimavel === false ? '<span class="tagzinha">sem estimativa de R$</span>' : ''}</div>
        <details class="evid"><summary>Como foi medido</summary><div class="box">
          <div><b>Janelas:</b> antes ${m.janelas.pre.map(brData).join(' a ')} · depois ${m.janelas.pos.map(brData).join(' a ')} (defasagem de ${m.lag} dia(s))</div>
          ${m.metricas?.unidades ? `<div><b>Unidades/dia:</b> ${m.metricas.unidades.antes} → ${m.metricas.unidades.depois}${m.metricas.visitas ? ` · <b>visitas/dia:</b> ${m.metricas.visitas.antes} → ${m.metricas.visitas.depois}` : ''}${m.metricas.conversao ? ` · <b>conversão:</b> ${m.metricas.conversao.antes}% → ${m.metricas.conversao.depois}%` : ''}</div>` : ''}
          ${m.controle ? `<div><b>Controle:</b> anúncios não tocados variaram ×${m.controle.razao} no mesmo período; o efeito é o do anúncio dividido por isso</div>` : ''}
          ${m.pct_ruido != null ? `<div><b>Ruído:</b> maior que ${m.pct_ruido}% das oscilações normais (${m.n_placebos} janelas de comparação)</div>` : ''}
          ${m.concorrentes ? `<div><b>Outras tarefas no mesmo alvo e período:</b> ${m.concorrentes}</div>` : ''}${m.eventos?.length ? `<div><b>Data comercial na janela:</b> ${esc(m.eventos.join(', '))}</div>` : ''}
          ${m.confianca ? Object.entries(m.confianca.criterios).map(([k, c]) => `<div><b>${esc(k.replace('_', ' '))}:</b> ${c.nota == null ? 'sem dado' : c.nota + '/' + c.de}; ${esc(c.base)}</div>`).join('') + `<div class="mudo">${esc(m.confianca.nota)}</div>` : ''}
          ${m.receita_alocada ? `<div><b>R$ associado:</b> ${brl(m.receita_alocada)} <span class="mudo">(estimativa${m.metrica_primaria === 'visitas' ? ' via visitas × conversão × preço do próprio anúncio' : ''}; tarefas sobrepostas no mesmo anúncio dividem o valor)</span></div>` : ''}${m.reversao_provavel ? `<div><b>Atenção:</b> a janela anterior estava ${Math.abs(m.nivel_pre_vs_base_pct)}% ${m.nivel_pre_vs_base_pct < 0 ? 'abaixo' : 'acima'} do nível habitual do anúncio; parte da variação pode ser retorno ao normal, não efeito da tarefa.</div>` : ''}
        </div></details>
      </div></div></div>`).join('') + (medidas.length > PAGINA ? `<div class="t-pag">1–${PAGINA} de ${medidas.length} · o restante está em O que funciona</div>` : '') : '<div class="vazio-box"><b>Nenhuma tarefa com efeito medido ainda.</b>A medição fecha 14 dias depois da conclusão da tarefa.</div>'}`
  } catch (e) { erroBloco(alvo, e, () => carregarImpacto(cliente)) }
}


// ── plano da conta por anúncio: gerar, ler, baixar, distribuir ──────────────
const PCT = v => v == null ? '—' : (v >= 0 ? '+' : '') + v.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%'
async function carregarPlanoConta(cliente) {
  const alvo = $('planoConta'); if (!alvo) return
  try {
    const r = await api('/api/plano-conta?cliente=' + encodeURIComponent(cliente))
    if (dados?.cliente !== cliente) return
    if (!r.disponivel) { alvo.innerHTML = NAO_CONECTADO(cliente, r); ligarColetar(alvo); return }
    const p = r.previsao
    const ativas = r.acoes.filter(a => !['descartada', 'obsoleta'].includes(a.status))
    const semana = ativas.filter(a => a.fila === 'esta_semana')
    nPlanoConta = r.gerado ? ativas.length : null
    const n = $('nPlanoConta'); if (n) n.textContent = nPlanoConta != null ? `\u00a0(${nPlanoConta})` : ''
    alvo.innerHTML = `
      <div class="linha">
        <button class="btn" id="btnGerarPlano" type="button">${r.gerado ? 'Atualizar o plano' : 'Gerar o plano da conta'}</button>
        ${r.gerado ? `<button class="btn" id="btnDistrib" type="button">Distribuir no Notion</button><span class="mini">PDF, documento e CSV estão em Documentos, no topo.</span>` : ''}
      </div>
      <div id="msgPlano" class="mt-2"></div>
      ${p ? `<div class="kpis mt-4">
        <div class="kpi"><div class="rotulo">Sem mudar nada (28 dias)</div><div class="valor">${brlAbrev(p.baseline)}</div><div class="detalhe">velocidade atual × 28 dias</div></div>
        <div class="kpi bom"><div class="rotulo">Com o plano, cenário base</div><div class="valor">${brlAbrev(p.cenarios.base.faturamento)}</div><div class="detalhe"><span class="pos">${PCT(p.cenarios.base.uplift_pct)}</span> · hipótese</div></div>
        <div class="kpi"><div class="rotulo">Faixa estimada</div><div class="valor">${brlAbrev(p.cenarios.conservador.faturamento)} a ${brlAbrev(p.cenarios.otimista.faturamento)}</div><div class="detalhe">conservador a otimista</div></div>
        <div class="kpi"><div class="rotulo">Receita em risco evitada</div><div class="valor">${brlAbrev(p.receita_em_risco_evitada)}</div><div class="detalhe">reposição e Ads sem retorno (à parte)</div></div>
      </div>
      <p class="mini mt-2">Previsão por hipótese, com premissas declaradas em cada ação; não é promessa. ${esc(p.baseline_regra)}.</p>` : ''}
      ${!r.custos_informados ? `<p class="mini mt-2">Custos em % (CMV, imposto, comissão) não informados: sem eles não existe ROAS alvo nem desconto máximo, e Ads e promoção ficam em cenário. <a href="/cliente?cliente=${encodeURIComponent(cliente)}&amp;aba=empresa&amp;sec=secCustosUpload" data-ir-custos>Informar em Empresa › Custos</a></p>`
        : `<p class="mini mt-2">Custos informados · ROAS de equilíbrio ${r.economia?.roas_breakeven ?? '—'} · ROAS alvo ${r.economia?.roas_alvo ?? 'inviável'}</p>`}
      ${r.gerado ? `<h3 class="mt-4">Foco da semana (${semana.length}) e fila (${ativas.length - semana.length})</h3>` + ativas.slice(0, 12).map(a => `
        <div class="acao"><div class="acao-topo"><span class="p-badge p-${esc(a.prioridade || 'P3')}">${esc(a.prioridade || '—')}</span><div class="acao-corpo">
          <b>${esc(a.titulo)}</b> ${seloCatalogo(a.catalogo_origem)}${a.catalogo_origem && a.catalogo_origem !== 'nao' && a.catalogo_texto ? `<div class="mini">${esc(a.catalogo_texto)}</div>` : ''}
          <div class="acao-meta"><span>${a.fila === 'esta_semana' ? 'esta semana' : 'na fila'}</span><span>Prazo ${brData(a.prazo)}</span><span>${esc(a.responsavel || 'a definir')}</span>
            ${a.previsao && a.previsao.tipo !== 'pendencia' ? `<span>${a.previsao.tipo === 'risco_evitado' ? 'risco evitado' : 'ganho'}: <b>${brl(a.previsao.cenarios.base.receita)}</b> (prob. ${Math.round(a.previsao.p_sucesso * 100)}%)</span>` : ''}
            ${a.permalink ? `<a href="${esc(a.permalink)}" target="_blank" rel="noopener">abrir anúncio</a>` : ''}${a.notion_url ? `<a href="${esc(a.notion_url)}" target="_blank" rel="noopener">tarefa no Notion</a>` : ''}</div>
          <div class="acao-tags"><span class="tagzinha ${a.evidencia_tipo === 'fato' ? 'fato' : ''}">${esc(a.evidencia_tipo)}</span><span class="tagzinha">${esc(a.regra.replace('_', ' '))}</span></div>
        </div></div></div>`).join('') + (ativas.length > 12 ? `<p class="mini">+ ${ativas.length - 12} ação(ões) no documento e na planilha (menu Documentos).</p>` : '') : '<div class="vazio-box"><b>O plano por anúncio ainda não foi gerado.</b>Gere para criar o diagnóstico da conta e as ações por anúncio.</div>'}`
    $('btnGerarPlano').onclick = async e => {
      const b = e.currentTarget; b.disabled = true; b.setAttribute('aria-busy', 'true'); b.textContent = 'Gerando…'
      try { const g = await api('/api/plano-conta/gerar', { cliente }); await carregarPlanoConta(cliente); $('msgPlano').innerHTML = `<div class="aviso ok">Plano gerado: ${g.n_acoes} ação(ões), ${g.esta_semana} para esta semana (${g.salvo.novas} nova(s), ${g.salvo.mantidas} mantida(s)${g.salvo.obsoletas ? `, ${g.salvo.obsoletas} saíram do plano (${g.salvo.obsoletas_aprovadas || 0} já aprovada(s): decisão registrada, ação encerrada)` : ''}; decisões anteriores preservadas).</div>` }
      catch (x) { toast(x.message, 'erro'); carregarPlanoConta(cliente) }
    }
    alvo.querySelector('[data-ir-custos]')?.addEventListener('click', e => { e.preventDefault(); mostrarAba('empresa'); const s = $('secCustosUpload'); if (s) { s.tabIndex = -1; s.focus(); s.scrollIntoView() } })
    const bd = $('btnDistrib')
    if (bd) bd.onclick = () => distribuirAnuncios(cliente, bd)
  } catch (e) { erroBloco(alvo, e, () => carregarPlanoConta(cliente)) }
}
// ── Custos do cliente (F6, aba Empresa): 3 linhas de estado (planilha subida · fonte automática · vínculo custo ↔ anúncio) + #formCustos (% do preço).
// Leitura de GET /api/custos/resumo (custos-db.resumoCustos: cobertura = faturamento 30 d dos anúncios com custo ÷ total, promo_anuncio.fat30) e GET /api/cliente/custos.
const CUSTOS_PCT = [['cmv_pct', 'CMV'], ['imposto_pct', 'Impostos'], ['comissao_pct', 'Comissão ML'], ['frete_pct', 'Frete'], ['embalagem_pct', 'Embalagem'], ['outros_pct', 'Outros'], ['margem_desejada_pct', 'Margem desejada']]
const FONTE_AUTO = { bling: 'Bling', tiny: 'Tiny', sheets: 'planilha Google' }
async function carregarCustosEstado(cliente) {
  const alvo = $('custosEstado'); if (!alvo) return
  try {
    const q = encodeURIComponent(cliente), [r, pc] = await Promise.all([api('/api/custos/resumo?cliente=' + q), api('/api/cliente/custos?cliente=' + q)])
    if (dados?.cliente !== cliente) return
    const e = r.efetivo || {}, pf = e.por_fonte || {}, fontes = r.fontes || {}
    const ligadas = Object.entries(FONTE_AUTO).filter(([f]) => fontes[f] && fontes[f].estado !== 'desconectado')
    const auto = ligadas.length ? ligadas.map(([f, n]) => `${esc(n)}: ${esc(fontes[f].estado)} · ${intPt(pf[f] || 0)} SKU(s)${fontes[f].ultimo_sync_ok_em ? ` · último sync ${esc(brData(fontes[f].ultimo_sync_ok_em))}` : ''}`).join('; ') : 'nenhuma fonte conectada'
    const vinc = e.cobertura_receita_pct == null ? `— <span class="mini">${esc(r.reconciliacao_motivo || 'sem faturamento em 30 d nos anúncios coletados')}</span>`
      : `custo informado para ${esc(String(e.cobertura_receita_pct).replace('.', ','))} % da receita de 30 d <span class="mini">${intPt(e.anuncios_sem_custo || 0)} anúncio(s) com SKU sem custo · ${intPt(e.anuncios_sem_sku || 0)} sem SKU</span>`
    const c = pc.custos || {}
    alvo.innerHTML = `<div class="tabela-wrap"><table class="t" id="custosLinhas"><caption class="sr">Estado dos custos de ${esc(cliente)}</caption><thead><tr><th scope="col">Porta</th><th scope="col">Estado</th><th scope="col">Onde</th></tr></thead><tbody>
      <tr><th scope="row">Planilha subida</th><td>${pf.upload ? `${intPt(pf.upload)} SKU(s) com custo da planilha` : 'nenhuma planilha aplicada'}</td><td><a href="/cliente?cliente=${q}&amp;aba=empresa&amp;sec=secCustosUpload" data-ir-sec="custosUpload">Subir abaixo</a></td></tr>
      <tr><th scope="row">Fonte automática (ERP/planilha)</th><td>${auto}</td><td><a href="/integracoes?custos=${q}">Custos: fontes automáticas</a></td></tr>
      <tr><th scope="row">Vínculo custo ↔ anúncio</th><td>${vinc}</td><td><a href="/promocoes?cliente=${q}&amp;aba=custos">Custo ligado ao anúncio</a></td></tr>
    </tbody></table></div>
    <details class="evid mt-2"${pc.informados ? '' : ' open'}><summary>Custos em % (CMV, imposto, comissão): ${pc.informados ? `informados · ROAS de equilíbrio ${esc(pc.economia?.roas_breakeven ?? '—')}` : 'não informados — informar (% do preço de venda)'}</summary><div class="box"><div>Sem eles não existe ROAS alvo nem desconto máximo, e Ads e promoção ficam em cenário.</div>
      <form id="formCustos" class="linha mt-2">${CUSTOS_PCT.map(([k, n]) => `<label class="campo"><span class="pf-rot">${n} %</span><input type="number" min="0" max="100" step="0.1" name="${k}" value="${esc(c[k] ?? '')}"></label>`).join('')}<button class="btn-mini" type="submit">Salvar custos</button></form></div></details>`
    alvo.querySelector('[data-ir-sec]').onclick = ev => { ev.preventDefault(); const s = $('custosUpload'); if (s) { s.tabIndex = -1; s.focus(); s.scrollIntoView() } }
    const fc = $('formCustos')
    fc.onsubmit = async ev => { ev.preventDefault(); const v = {}; new FormData(fc).forEach((x, k) => { if (x !== '') v[k] = Number(x) }); try { await api('/api/cliente/custos', { cliente, custos: v }); toast('Custos salvos.'); carregarCustosEstado(cliente); carregarPlanoConta(cliente) } catch (x) { toast(x.message, 'erro') } }
  } catch (e) { erroBloco(alvo, e, () => carregarCustosEstado(cliente)) }
}
async function esperarJob(id, rot) {
  for (;;) {
    const j = await api('/api/planos/job/' + id)
    if (j.estado !== 'rodando') { if (j.estado === 'erro') throw new Error(j.erro); return j.resultado }
    $('msgPlano').innerHTML = `<div class="aviso info">${rot}: ${j.progresso.feitos || 0}/${j.progresso.total || '…'}</div>`
    await new Promise(r => setTimeout(r, 1500))
  }
}
async function distribuirAnuncios(cliente, btn) {
  btn.disabled = true
  const esc0 = { tipo: 'selecao', clientes: [cliente] }
  try {
    const { job } = await api('/api/planos/distribuir', { escopo: esc0, somenteAnuncios: true, scoreMin: 0, confirmar: false })
    const r = await esperarJob(job, 'Pré-visualizando (nada é criado)')
    if (!r.a_criar.length) { $('msgPlano').innerHTML = `<div class="aviso info">Nada novo para distribuir: ${r.ja_existiam.length} já existem no Notion${r.erros.length ? ` · ${r.erros.length} erro(s): ${esc(r.erros[0].erro)}` : ''}.</div>`; return }
    $('msgPlano').innerHTML = `<div class="aviso"><b>Pré-visualização, nada foi criado.</b> ${r.a_criar.length} tarefa(s) seriam criadas no quadro do cliente (as mais prioritárias, no máximo 5 por vez): ${r.a_criar.map(a => `<div>· ${esc(a.titulo)}: ${esc(a.responsavel)}, prazo ${brData(a.prazo)}</div>`).join('')}
      ${r.sem_usuario_notion ? `<div>${r.sem_usuario_notion} sem usuário do Notion identificado (responsável citado na descrição).</div>` : ''}
      <button class="btn mt-2" id="btnConfirmaDistrib" type="button">Confirmar e criar no Notion</button></div>`
    $('btnConfirmaDistrib').onclick = async e => {
      const b = e.currentTarget
      if (!await confirmar({ titulo: `Criar ${r.a_criar.length} tarefa(s) no Notion?`, texto: `Cliente ${cliente}. Quem estiver como responsável será notificado pelo Notion. Dá para desfazer pelo painel de Distribuição.`, rotuloOk: 'Criar no Notion' })) return
      b.disabled = true
      try {
        const { job: j2 } = await api('/api/planos/distribuir', { escopo: esc0, somenteAnuncios: true, ids: r.a_criar.map(a => a.id), confirmar: true })
        const fim = await esperarJob(j2, 'Criando tarefas no Notion')
        $('msgPlano').innerHTML = `<div class="aviso ok"><b>${fim.criadas.length} tarefa(s) criadas no Notion.</b>${fim.erros.length ? ` ${fim.erros.length} erro(s): ${esc(fim.erros[0].erro)}` : ''} Cada uma cita o anúncio; em 14 dias o sistema mede o resultado.</div>`
        carregarPlanoConta(cliente)
      } catch (x) { toast(x.message, 'erro') }
    }
  } catch (e) { toast(e.message, 'erro') } finally { btn.disabled = false }
}


// ── perfil do cliente: como o Relatório Semanal é escrito (rótulos, descrições e regras vêm da API/config) ──
const lerNome = () => { try { return window.PS?.quem?.().nome || localStorage.getItem('ps_perfil_por') || '' } catch { return '' } }   // padrão = «Quem sou» do topo (F2)
const gravarNome = v => { try { localStorage.setItem('ps_perfil_por', v) } catch { /* sem armazenamento: só não lembra o nome */ } }
function carregarOfertas(cliente) { const alvo = document.getElementById('ofertas'); if (alvo && window.PSOfertas) PSOfertas.montar(alvo, cliente) }
function carregarFicha(cliente) { const alvo = $('ficha'); if (alvo && window.PSFicha) PSFicha.montar(alvo, cliente) }
// ── depende do cliente: tarefas em dependencia_cliente com motivo, desde quando e a faixa da régua (GET /api/tarefas/dependencia-cliente?cliente=) ──
const SELO_FAIXA = { aguardando: 'neutro', cobrar: 'atencao', revisar: 'ruim' }
async function carregarDependencias(cliente) {
  const alvo = $('dependencias'); if (!alvo) return
  try {
    const r = await api('/api/tarefas/dependencia-cliente?cliente=' + encodeURIComponent(cliente))
    if (dados?.cliente !== cliente) return
    nDep = r.itens.length
    const n = $('nDependencias'); if (n) n.textContent = nDep
    alvo.innerHTML = r.itens.length ? r.itens.map(i => `
      <div class="acao"><div class="acao-topo"><div class="acao-corpo">
        <b><a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.titulo)}</a></b> ${i.tipo_rotulo ? `<span class="selo atencao">${esc(i.tipo_rotulo)}</span> — ` : ''}<span class="${i.tipo ? '' : 'mudo'}">${esc(i.detalhe)}</span>
        <div class="acao-meta"><span>desde ${brData(i.desde)} (${i.dias} dias)</span><span class="selo ${SELO_FAIXA[i.faixa] || 'neutro'}">${esc(i.faixa_rotulo)}</span>${i.por ? `<span>por ${esc(i.por)}</span>` : ''}${i.evidencia ? `<a href="${esc(i.evidencia)}" target="_blank" rel="noopener">evidência</a>` : ''}</div>
      </div></div></div>`).join('')
      : '<div class="vazio-box"><b>Nada depende do cliente agora.</b></div>'
  } catch (e) { erroBloco(alvo, e, () => carregarDependencias(cliente)) }
}
// ── execução do plano (Chaveiro F1, só leitura): caminho de cada ação e a cobertura (GET /api/cliente/execucao?cliente=) ──
const CHV_ROTULO = { automatico: 'automático', assistido: 'assistido', cliente: 'do cliente', sem_caminho: 'sem caminho' }
const CHV_SELO = { automatico: 'bom', assistido: 'azul', cliente: 'atencao', sem_caminho: 'neutro' }   // cor só pelo selo já existente no ui.css
const CHV_STATUS = { proposta: 'proposta', aprovada: 'aprovada', distribuida: 'no Notion' }
async function carregarChaveiro(cliente) {
  const alvo = $('chaveiro'); if (!alvo) return
  try {
    const r = await api('/api/cliente/execucao?cliente=' + encodeURIComponent(cliente))
    if (dados?.cliente !== cliente) return
    const c = r.cobertura || {}, p = c.por_caminho || {}, n = v => intPt(v ?? 0)
    const kp = (rot, v, det) => `<div class="kpi"><div class="rotulo">${rot}</div><div class="valor">${v}</div><div class="detalhe">${det}</div></div>`
    alvo.innerHTML = !r.acoes.length ? '<div class="vazio-box"><b>Sem ações abertas no plano.</b> Gere o plano na aba Plano para ver os caminhos.</div>' : `
      <p class="veredito-frase" id="chvVeredito"><b>${n(c.com_caminho)} de ${n(c.total)}</b> ações têm caminho · ${n(p.automatico)} automáticas · ${n(p.assistido)} assistidas · ${n(p.cliente)} do cliente · ${n(p.sem_caminho)} sem caminho</p>
      <div class="kpis">${kp('Com caminho', n(c.com_caminho), `${c.pct_com_caminho == null ? '—' : Math.round(c.pct_com_caminho) + '%'} de ${n(c.total)}`)}${kp('Automáticas', n(p.automatico), 'o sistema aplica, com aprovação e conferência')}${kp('Assistidas', n(p.assistido), 'o sistema prepara, a equipe aplica')}${kp('Sem caminho', n(p.sem_caminho), 'ainda sem adaptador ou sem dado')}</div>
      <div class="tabela-wrap mt-2"><table class="t empilha" id="chvTabela"><caption class="sr">Execução do plano de ${esc(cliente)}</caption><thead><tr><th scope="col">Ação</th><th scope="col">Caminho</th><th scope="col">Adaptador</th><th scope="col">Estado</th><th scope="col">Prazo</th><th scope="col">Motivo</th></tr></thead><tbody>${r.acoes.map(a => `<tr>
        <td><b>${esc(a.titulo)}</b><div class="mini">${esc(a.regra || '')}</div>${a.caminho === 'automatico' ? `<button class="btn btn-fantasma btn-p" type="button" data-exec-acao="${esc(a.id)}">Executar pelo Chaveiro</button>` : ''}</td>
        <td><span class="selo ${CHV_SELO[a.caminho] || 'neutro'}">${esc(CHV_ROTULO[a.caminho] || 'sem caminho')}</span></td>
        <td>${a.adaptador ? `${esc(a.adaptador)}${a.operacao ? `<div class="mini">${esc(a.operacao)}</div>` : ''}` : '<span class="mudo">—</span>'}</td>
        <td><span class="tag p-${esc(a.status)}">${esc(CHV_STATUS[a.status] || a.status)}</span></td>
        <td>${brData(a.prazo)}</td>
        <td>${esc(a.motivo || '')}${a.pendencias.length ? `<div class="mini">pendente: ${esc(a.pendencias.join(' · '))}</div>` : ''}</td></tr>`).join('')}</tbody></table></div>`
    alvo.querySelectorAll('[data-exec-acao]').forEach(b => { b.onclick = async () => {
      try { const pr = await api(`/api/chaveiro/exec/preset?cliente=${encodeURIComponent(cliente)}&acao=${encodeURIComponent(b.dataset.execAcao)}`); const ex = $('executar'); if (ex && dados) ex.dataset.cliente = dados.cliente; mostrarAba('executar'); carregarExecutar(pr) } catch (e) { toast(e.message, 'erro') }   // dataset antes: a aba não monta sem o preset
    } })
  } catch (e) { erroBloco(alvo, e, () => carregarChaveiro(cliente)) }
}
// ── saúde da conta (gravada 1×/dia; GET /api/cliente/saude?cliente=; "Atualizar agora" → POST /api/cliente/saude/atualizar, só leitura no ML) ──
const SAU_SINAL = [['reputacao', 'Reputação', '/users/{id} (reputação)'], ['atrasos', 'Envios atrasados', '/orders/search + /shipments'], ['reclamacoes', 'Reclamações abertas', '/post-purchase/v2/claims/search'], ['perguntas', 'Perguntas >24h', '/questions/search (sem texto)'], ['full', 'Estoque Full', '/inventories/{id}/stock/fulfillment']]
const SAU_HORA = iso => iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
async function carregarSaude(cliente) {
  const alvo = $('saude'); if (!alvo) return
  try {
    const r = await api('/api/cliente/saude?cliente=' + encodeURIComponent(cliente))
    if (dados?.cliente !== cliente) return
    const pend = r.pendente || {}, tx = r.textos || {}, semColeta = !r.dia
    const motivo = k => semColeta ? 'sem_coleta' : pend[k] || ''
    const txt = k => tx[motivo(k)] || motivo(k)
    const valor = (k, v) => motivo(k) ? 'pendente' : v == null ? '—' : v
    const kp = (rot, v, det) => `<div class="kpi"><div class="rotulo">${rot}</div><div class="valor">${v}</div><div class="detalhe">${det}</div></div>`
    const rep = r.reputacao || {}
    const hoje = { reputacao: rep.nivel ? `${esc(rep.nivel)}${rep.medalha ? ` · ${esc(rep.medalha)}` : ''} · reclamações ${rep.taxa_claims ?? '—'}% · atrasos ${rep.taxa_atraso ?? '—'}% · cancelamentos ${rep.taxa_cancel ?? '—'}%` : '—',
      atrasos: intPt(r.atrasos), reclamacoes: r.reclamacoes ? `${intPt(r.reclamacoes.abertas)}${r.reclamacoes.mediacoes ? ` (${intPt(r.reclamacoes.mediacoes)} em mediação)` : ''}` : '—',
      perguntas: r.perguntas ? `${intPt(r.perguntas.mais_de_24h)} de ${intPt(r.perguntas.abertas)} abertas` : '—', full: r.listas?.full?.length ? `${intPt(r.listas.full.length)} anúncio(s) em Full` : '—' }
    alvo.innerHTML = `
      ${semColeta ? `<div class="vazio-box"><b>Ainda sem coleta de saúde.</b> ${esc(tx.sem_coleta || '')}</div>` : `<p class="veredito-frase" id="sauVeredito">Leitura de <b>${brData(r.dia)}</b>${r.do_dia ? '' : ' (não é de hoje)'} · coletada em ${esc(SAU_HORA(r.coletado_em))}</p>`}
      <div class="kpis" id="sauKpis">${kp('Reputação', valor('reputacao', rep.nivel ? esc(rep.nivel) : null), motivo('reputacao') ? esc(txt('reputacao')) : esc(`${rep.medalha || 'sem medalha'} · reclamações ${rep.taxa_claims ?? '—'}%`))}${kp('Envios atrasados', valor('atrasos', intPt(r.atrasos)), motivo('atrasos') ? esc(txt('atrasos')) : 'pedidos pagos dos últimos 7 dias com prazo de despacho vencido')}${kp('Reclamações abertas', valor('reclamacoes', r.reclamacoes ? intPt(r.reclamacoes.abertas) : null), motivo('reclamacoes') ? esc(txt('reclamacoes')) : `${intPt(r.reclamacoes?.mediacoes ?? 0)} em mediação`)}${kp('Perguntas >24h', valor('perguntas', r.perguntas ? intPt(r.perguntas.mais_de_24h) : null), motivo('perguntas') ? esc(txt('perguntas')) : `${intPt(r.perguntas?.abertas ?? 0)} sem resposta no total`)}</div>
      <div class="tabela-wrap mt-2"><table class="t empilha" id="sauTabela"><caption class="sr">Saúde da conta de ${esc(cliente)}</caption><thead><tr><th scope="col">Sinal</th><th scope="col">Hoje</th><th scope="col">Fonte</th><th scope="col">Coletado em</th><th scope="col">Situação</th><th scope="col">Motivo</th></tr></thead><tbody>${SAU_SINAL.map(([k, rot, fonte]) => `<tr>
        <td><b>${rot}</b></td><td>${motivo(k) ? '<span class="mudo">pendente</span>' : hoje[k]}</td><td class="mini">${esc(fonte)}</td><td>${semColeta ? '—' : esc(SAU_HORA(r.coletado_em))}</td>
        <td><span class="selo ${motivo(k) ? 'neutro' : 'bom'}">${motivo(k) ? 'pendente' : 'lido'}</span></td><td>${motivo(k) ? esc(txt(k)) : '<span class="mudo">—</span>'}</td></tr>`).join('')}</tbody></table></div>
      <div class="mt-2"><button class="btn" type="button" id="btnSaudeAtualizar">Atualizar agora</button></div>`
    $('btnSaudeAtualizar').onclick = async function () {
      this.disabled = true; this.textContent = 'Lendo o Mercado Livre…'
      try { await api('/api/cliente/saude/atualizar', { cliente }); toast('Saúde da conta atualizada.'); carregarSaude(cliente) }
      catch (e) { toast(e.message, 'erro'); this.disabled = false; this.textContent = 'Atualizar agora' }
    }
  } catch (e) { erroBloco(alvo, e, () => carregarSaude(cliente)) }
}
// ── Notion do cliente (Resumo, recolhido): página, filhos (bases/páginas) e a tabela Informações com filtro por seção e busca; "Atualizar do Notion" relê agora ──
async function carregarNotion(cliente) {
  const alvo = $('notion'); if (!alvo) return
  try {
    const r = await api('/api/cliente/notion?cliente=' + encodeURIComponent(cliente))
    if (dados?.cliente !== cliente) return
    const n = $('nNotion'); if (n) n.textContent = r.informacoes.length ? `${r.informacoes.length} itens` : ''
    const p = r.pagina
    const cab = p?.page_id ? `<div><a href="${esc(p.url)}" target="_blank" rel="noopener"><b>${esc(p.titulo || cliente)}</b></a> <span class="mini">lido em ${brData(p.lido_em)}</span></div>` + (p.filhos.length ? `<ul class="mini">${p.filhos.map(f => `<li>${esc(f.tipo === 'base' ? 'Base' : 'Página')}: <a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.titulo || '(sem título)')}</a></li>`).join('')}</ul>` : '<div class="mini mudo">Nenhuma base ou página dentro da página do cliente.</div>')
      : p ? `<div class="mini">${esc({ sem_pagina: 'Página do cliente não localizada pela integração.', pagina_invalida: 'O id da central não é uma página ativa.' }[p.erro] || `Última leitura falhou (${p.erro}).`)} Lido em ${brData(p.lido_em)}.</div>` : '<div class="mini mudo">Ainda não lido do Notion: use "Atualizar do Notion".</div>'
    const linha = i => `<tr><td>${esc(i.secao || '—')}</td><td>${esc(i.titulo || '(sem título)')}</td><td>${esc(i.status || '—')}</td><td>${i.link ? `<a href="${esc(i.link)}" target="_blank" rel="noopener">link</a>` : '—'}</td><td>${brData(i.editado_em)}</td><td><a class="btn btn-fantasma btn-p" href="${esc(i.url)}" target="_blank" rel="noopener">abrir</a></td></tr>`
    alvo.innerHTML = `${cab}<div class="filtros mt-2"><label class="campo"><span class="pf-rot">Seção</span><select id="ntSecao"><option value="">Todas</option>${r.secoes.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('')}</select></label><label class="campo"><span class="pf-rot">Buscar</span><input id="ntBusca" type="search" placeholder="título, status ou link"></label><button class="btn" type="button" id="btnNotionAtualizar">Atualizar do Notion</button></div>
      <div class="tabela-wrap"><table class="t"><thead><tr><th>Seção</th><th>Item</th><th>Status</th><th>Link</th><th>Editado</th><th></th></tr></thead><tbody id="ntCorpo"></tbody></table></div>`
    const corpo = $('ntCorpo')
    const filtrar = () => {
      const sec = $('ntSecao').value, q = $('ntBusca').value.trim().toLowerCase()
      const itens = r.informacoes.filter(i => (!sec || i.secao === sec) && (!q || `${i.titulo} ${i.status} ${i.link}`.toLowerCase().includes(q)))
      corpo.innerHTML = itens.length ? itens.map(linha).join('') : `<tr><td colspan="6" class="mudo">${r.informacoes.length ? 'Nenhum item com esse filtro.' : p?.page_id ? 'A página não tem a base Informações ou ela está vazia.' : 'Sem leitura ainda.'}</td></tr>`
    }
    $('ntSecao').onchange = filtrar; $('ntBusca').oninput = filtrar; filtrar()
    const b = $('btnNotionAtualizar')
    b.onclick = async () => {
      let por = lerNome(); if (!por) { por = (prompt('Seu nome (líder ou consultor):') || '').trim(); if (!por) return; gravarNome(por) }
      b.disabled = true; b.textContent = 'Lendo…'
      try { const x = await api('/api/cliente/notion/atualizar', { cliente, por }); toast(x.estado === 'ok' ? `Lido do Notion: ${x.linhas} item(ns) em Informações, ${x.filhos} base(s)/página(s).` : x.estado === 'sem_informacoes' ? 'Página lida; ela não tem a base Informações.' : `Não foi possível ler: ${x.erro || x.estado}.`, x.estado === 'erro' ? 'erro' : 'ok'); carregarNotion(cliente) }
      catch (e) { toast('Falhou: ' + e.message, 'erro'); b.disabled = false; b.textContent = 'Atualizar do Notion' }
    }
  } catch (e) { erroBloco(alvo, e, () => carregarNotion(cliente)) }
}

// ── cadastro do cliente (aba Configurar): central só leitura + campos do CS com prévia e confirmação (docs/cadastro-clientes.md) ──
async function carregarCadastro(cliente) {
  const alvo = $('cad-corpo'); if (!alvo) return
  try {
    const r = await api('/api/cliente/cadastro?cliente=' + encodeURIComponent(cliente))
    if (dados?.cliente === cliente) desenharCadastro(alvo, cliente, r)
  } catch (e) { erroBloco(alvo, e, () => carregarCadastro(cliente)) }
}
function desenharCadastro(alvo, cliente, r, msg = null) {
  const SELO_HS = { 'Saudável': 'bom', 'Atenção': 'atencao', 'Risco': 'ruim', 'Dados insuficientes': 'neutro', 'Sem HS': 'neutro' }
  const c = r.central, k = r.cadastro
  const pessoas = o => Object.entries(o || {}).filter(([, v]) => v).map(([ch, v]) => `${esc(v)} <span class="mini">${esc(NOME_CANAL[ch] || ch)}</span>`).join(', ') || '—'
  const venc = Object.entries(c.vencimentos || {}).filter(([, v]) => v).map(([ch, v]) => `${esc(NOME_CANAL[ch] || ch)} ${esc(brData(String(v)))}`).join(', ') || '—'
  const hsTxt = k.health_score != null ? Number(k.health_score).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : '—'
  const fonte = k.cadastro_fonte ? `<span class="selo neutro">${esc(k.cadastro_fonte)}</span>${k.hs_em ? ` <span class="mini">health score lido em ${esc(brData(k.hs_em))}</span>` : ''}` : '<span class="mini">sem cadastro do CS ainda</span>'
  alvo.innerHTML = `<div class="cartao">
    <h3>Da central (Notion)</h3>
    <ul>
      <li><b>Status:</b> ${esc(c.status || '—')} · <b>Tier:</b> ${esc(c.tier || '—')} · <b>Nicho:</b> ${esc(c.nicho || '—')}</li>
      <li id="cadProduto"><b>Produto:</b> ${c.produto?.produto ? `${esc(c.produto.nome)} (${esc(c.tier)})` : c.produto ? `— <span class="selo atencao">produto não mapeado</span> <span class="mini">tier «${esc(c.tier || 'vazio')}» fora de config/produtos.json: pendência de cadastro do CS</span>` : '—'} <button class="btn-icone btn-ajuda" type="button" aria-label="Como fazer: Produto do cliente (Performance × Prime)" data-ajuda="produto_contratado"></button></li>
      <li><b>Canais:</b> ${(c.canais || []).map(x => esc(NOME_CANAL[x] || x)).join(', ') || '—'}</li>
      <li><b>Consultores:</b> ${pessoas(c.consultores)}</li>
      <li><b>Líderes:</b> ${pessoas(c.lideres)}</li>
      <li><b>CNPJ:</b> ${c.cnpj ? esc(fmtCnpj(c.cnpj)) : 'não registrado'}${c.cpf ? ` · <b>CPF:</b> ${esc(c.cpf)}` : ''} · <b>Contato:</b> ${esc(c.responsavel || '—')}</li>
      <li><b>Vencimentos:</b> ${venc}</li>
      ${r.relatorio ? `<li><b>Relatório ao Notion:</b> ${esc(r.relatorio.frequencia)}${r.relatorio.proximo_envio ? ` · próximo ${esc(brData(r.relatorio.proximo_envio))}` : ''}${r.relatorio.pausado_motivo ? ` · pausado (${esc(r.relatorio.pausado_motivo)})` : ''}</li>` : ''}
    </ul>
    <h3 class="mt-4">Do CS</h3>
    <p>Health score <b>${hsTxt}</b>${k.hs_classificacao ? ` <span class="selo ${SELO_HS[k.hs_classificacao] || 'neutro'}">${esc(k.hs_classificacao)}</span>` : ''} · ${fonte}</p>
    ${k.canais_cs.some(x => x.hs != null || x.cs) ? `<div class="mini">Por canal: ${k.canais_cs.map(x => `${esc(x.canal)}${x.hs != null ? ' ' + Number(x.hs).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : ''}${x.classificacao ? ' (' + esc(x.classificacao) + ')' : ''}`).join(' · ')}</div>` : ''}
    <div class="form-grade">
      <label class="campo" for="cad-cs"><span class="pf-rot">CS responsável</span><input id="cad-cs" type="text" maxlength="120" value="${esc(k.cs_responsavel)}"></label>
      <label class="campo" for="cad-hs"><span class="pf-rot">Health score (0 a 100, vazio = sem leitura)</span><input id="cad-hs" type="number" min="0" max="100" step="0.1" value="${k.health_score != null ? esc(k.health_score) : ''}"></label>
      <label class="campo" for="cad-classe"><span class="pf-rot">Classificação</span><select id="cad-classe"><option value="">—</option>${r.classificacoes.map(x => `<option value="${esc(x)}" ${x === k.hs_classificacao ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
      <label class="campo" for="cad-canais"><span class="pf-rot">Canais informados pelo CS (separados por vírgula)</span><input id="cad-canais" type="text" maxlength="200" value="${esc(k.canais_cs.map(x => x.canal).join(', '))}"></label>
    </div>
    <label class="campo" for="cad-obs"><span class="pf-rot">Observações</span><textarea id="cad-obs" rows="3" maxlength="4000">${esc(k.observacoes)}</textarea></label>
    <label class="campo" for="cad-por"><span class="pf-rot">Seu nome (líder ou consultor)</span><input id="cad-por" type="text" maxlength="80" autocomplete="name" placeholder="Fica registrado na edição" value="${esc(lerNome())}"></label>
    <div class="pf-rodape"><button class="btn" type="button" id="cad-salvar">Salvar cadastro</button></div>
    <div id="cad-msg" class="mt-2">${msg ? `<div class="aviso ${msg.ok ? 'ok' : 'erro'}">${esc(msg.texto)}</div>` : ''}</div>
  </div>`
  const aviso = (texto, ok) => { $('cad-msg').innerHTML = `<div class="aviso ${ok ? 'ok' : 'erro'}">${esc(texto)}</div>` }
  const ROT = { cs_responsavel: 'CS responsável', health_score: 'health score', hs_classificacao: 'classificação', observacoes: 'observações', canais_cs: 'canais' }
  const fmt = v => v == null || v === '' ? '—' : Array.isArray(v) ? (v.map(x => x.canal).join(', ') || '—') : String(v)
  $('cad-salvar').onclick = async e => {
    const b = e.currentTarget, por = $('cad-por').value.trim()
    if (!por) { aviso('Informe seu nome; ele fica registrado junto da edição.', false); $('cad-por').focus(); return }
    const hs = $('cad-hs').value.trim()
    const campos = { cs_responsavel: $('cad-cs').value, health_score: hs === '' ? null : Number(hs), hs_classificacao: $('cad-classe').value, observacoes: $('cad-obs').value,
      canais_cs: $('cad-canais').value.split(',').map(x => x.trim()).filter(Boolean).map(nome => k.canais_cs.find(x => x.canal === nome) || nome) }   // canal que já existia mantém o detalhe por canal
    b.disabled = true
    try {
      const p = await api('/api/cliente/cadastro', { cliente, por, campos })
      if (!p.n) { aviso('Sem mudança: o cadastro já está assim.', true); return }
      const texto = Object.entries(p.mudancas).map(([ch, m]) => `${ROT[ch] || ch}: ${fmt(m.de)} → ${fmt(m.para)}`).join('\n')
      if (!(await confirmar({ titulo: `Salvar ${p.n} mudança(s) no cadastro?`, texto, rotuloOk: 'Confirmar cadastro' }))) return
      await api('/api/cliente/cadastro', { cliente, por, campos, confirmar: true })
      gravarNome(por)
      const novo = await api('/api/cliente/cadastro?cliente=' + encodeURIComponent(cliente))
      if (dados?.cliente === cliente) desenharCadastro(alvo, cliente, novo, { texto: 'Cadastro salvo.', ok: true })
    } catch (x) { aviso(x.message, false) } finally { b.disabled = false }
  }
}

// ── anúncios de catálogo (aba Configurar): "próprio" não vem da API — é marcação manual do líder/consultor, com prévia e confirmação; sem marcação, catálogo é de terceiros ──
async function carregarCatalogo(cliente) {
  const alvo = $('catalogo'); if (!alvo) return
  try {
    const r = await api('/api/cliente/catalogo?cliente=' + encodeURIComponent(cliente))
    if (dados?.cliente === cliente) desenharCatalogo(alvo, cliente, r)
  } catch (e) { erroBloco(alvo, e, () => carregarCatalogo(cliente)) }
}
function desenharCatalogo(alvo, cliente, r, msg = null) {
  const ROT = { terceiros: 'de terceiros', proprio: 'próprio' }
  if (!r.total) { alvo.innerHTML = '<div class="cartao"><p class="mudo">Nenhum anúncio de catálogo na última coleta deste cliente.</p></div>'; return }
  alvo.innerHTML = `<div class="cartao">
    <p><b>${intPt(r.total)}</b> anúncios de catálogo (<b>${intPt(r.ativos)}</b> ativos): ${intPt(r.terceiros)} tratados como de terceiros e ${intPt(r.proprio)} como próprios.</p>
    <label class="campo"><input type="checkbox" id="catProprio" ${r.padrao === 'proprio' ? 'checked' : ''}> Os anúncios de catálogo desta conta são próprios (marca/dono do produto)</label>
    <div class="pf-desc">${esc(r.textos.terceiros)} Marque só se esta conta for a dona do produto no catálogo: aí o conteúdo muda por sugestão de correção, com revisão do Mercado Livre. Sem marcação, vale "de terceiros".</div>
    <label class="campo" for="catPor"><span class="pf-rot">Seu nome (líder ou consultor)</span><input id="catPor" type="text" maxlength="80" autocomplete="name" placeholder="Fica registrado na marcação" value="${esc(lerNome())}"></label>
    <div class="pf-rodape"><button class="btn" type="button" id="btnCatalogo">Salvar marcação</button></div>
    <div id="catMsg" class="mt-2">${msg ? `<div class="aviso ${msg.ok ? 'ok' : 'erro'}">${esc(msg.texto)}</div>` : ''}</div>
    <h3 class="mt-4">Exceções por anúncio</h3>
    ${r.excecoes.length ? `<table class="t"><thead><tr><th scope="col">Anúncio</th><th scope="col">Tratado como</th><th scope="col">Marcado por</th><th scope="col"></th></tr></thead><tbody>${r.excecoes.map(x => `<tr><td>${esc((x.titulo || x.item_id).slice(0, 70))} <span class="mini">${esc(x.item_id)}</span></td><td>${esc(ROT[x.origem] || x.origem)}</td><td>${esc(x.por)} · ${esc(brData(x.em))}</td><td><button class="btn-mini" type="button" data-cat-tirar="${esc(x.item_id)}">Voltar ao padrão</button></td></tr>`).join('')}</tbody></table>` : '<p class="mudo">Nenhuma exceção: todos os anúncios de catálogo seguem a marcação do cliente.</p>'}
    <details class="recolhido"><summary>Marcar um anúncio específico</summary>
      <div class="form-grade mt-2">
        <label class="campo" for="catItem"><span class="pf-rot">Código do anúncio</span><input id="catItem" type="text" maxlength="20" placeholder="MLB123456789"></label>
        <label class="campo" for="catOrigem"><span class="pf-rot">Tratar como</span><select id="catOrigem"><option value="proprio">Catálogo próprio</option><option value="terceiros">Catálogo de terceiros</option></select></label>
      </div>
      <button class="btn mt-2" type="button" id="btnCatItem">Marcar anúncio</button>
    </details>
  </div>`
  const aviso = (texto, ok) => { $('catMsg').innerHTML = `<div class="aviso ${ok ? 'ok' : 'erro'}">${esc(texto)}</div>` }
  // prévia (nada é gravado) → confirmação com o texto da prévia → gravação com confirmar:true
  const gravar = async (url, corpo, titulo) => {
    const por = $('catPor').value.trim()
    if (!por) { aviso('Informe seu nome; ele fica registrado junto da marcação.', false); $('catPor').focus(); return }
    try {
      const p = await api(url, { cliente, ...corpo, por })
      if (p.ok === false) { aviso(p.motivo, false); return }
      if (p.de === p.para && !p.remove_excecao) { aviso('Sem mudança: já está assim.', true); return }
      if (!(await confirmar({ titulo, texto: p.texto, rotuloOk: 'Confirmar marcação' }))) return
      await api(url, { cliente, ...corpo, por, confirmar: true })
      gravarNome(por)
      const novo = await api('/api/cliente/catalogo?cliente=' + encodeURIComponent(cliente))
      if (dados?.cliente === cliente) desenharCatalogo(alvo, cliente, novo, { texto: 'Marcação salva. Vale para os próximos planos, relatórios e telas; o plano já gerado só muda quando for gerado de novo.', ok: true })
    } catch (x) { aviso(x.message, false) }
  }
  $('btnCatalogo').onclick = e => { const b = e.currentTarget; b.disabled = true; gravar('/api/cliente/catalogo', { proprio: $('catProprio').checked }, 'Marcar o catálogo desta conta?').finally(() => { b.disabled = false }) }
  alvo.querySelectorAll('[data-cat-tirar]').forEach(b => { b.onclick = () => gravar('/api/anuncio/catalogo-origem', { item_id: b.dataset.catTirar, origem: null }, 'Voltar este anúncio ao padrão do cliente?') })
  $('btnCatItem').onclick = e => {
    const b = e.currentTarget, id = $('catItem').value.trim()
    if (!id) { aviso('Informe o código do anúncio de catálogo.', false); $('catItem').focus(); return }
    b.disabled = true; gravar('/api/anuncio/catalogo-origem', { item_id: id, origem: $('catOrigem').value }, 'Marcar este anúncio?').finally(() => { b.disabled = false })
  }
}

async function carregarPerfil(cliente) {
  const alvo = $('perfil'); if (!alvo) return
  try {
    const r = await api('/api/cliente/perfil?cliente=' + encodeURIComponent(cliente))
    if (dados?.cliente === cliente) desenharPerfil(alvo, cliente, r)       // outro cliente já aberto: a resposta velha é descartada
  } catch (e) { erroBloco(alvo, e, () => carregarPerfil(cliente)) }
}
function desenharPerfil(alvo, cliente, r, salvo = false) {
  const p = r.perfil, regras = p.regras || {}
  // "padrão da base" sozinho não diz se a madrugada coleta este cliente: a API traz o padrão (config/promocoes.json); sem ele, fica só o rótulo
  const padraoColeta = r.coleta_promocoes_padrao == null ? '' : ` (hoje: ${r.coleta_promocoes_padrao ? 'ligada' : 'desligada'})`
  const coletaTxt = p.coleta_promocoes === 1 ? 'ligada' : p.coleta_promocoes === 0 ? 'desligada' : 'padrão da base' + padraoColeta
  let primario = p.primario
  const extras = new Set(p.perfis.map(x => x.id).filter(id => id !== p.primario))
  alvo.innerHTML = `<div class="cartao">
    ${p.origem === 'padrao' ? `<div class="aviso info">Padrão: este cliente ainda não tem perfil salvo; o relatório usa <b>${esc(p.perfis[0]?.rotulo || p.primario)}</b> e o objetivo <b>${esc(p.objetivo?.rotulo || '—')}</b>. Escolha abaixo e salve para definir.</div>` : ''}
    <div class="pf-grid">
      <div class="pf-campo"><label for="pfPrimario">Perfil primário (vence conflitos)</label>
        <select id="pfPrimario">${r.perfis.map(x => `<option value="${esc(x.id)}">${esc(x.rotulo)}</option>`).join('')}</select>
        <div class="pf-desc" id="pfDescP"></div></div>
      <div class="pf-campo"><label for="pfObjetivo">Objetivo do cliente</label>
        <select id="pfObjetivo">${r.objetivos.map(x => `<option value="${esc(x.id)}">${esc(x.rotulo)}</option>`).join('')}</select>
        <div class="pf-desc" id="pfDescO"></div></div>
      <div class="pf-campo"><span class="pf-rot">Perfis adicionais (opcional)</span><div class="pf-chips" id="pfChips"></div>
        <div class="pf-desc">Ligar e desligar recursos soma entre os perfis; texto e limites seguem o primário.</div></div>
      <div class="pf-campo"><label for="pfTarefas">Lista de tarefas no relatório</label>
        <select id="pfTarefas"><option value="">Seguir o perfil (${regras.lista_tarefas && p.tarefas_override == null ? 'hoje: mostra' : p.tarefas_override == null ? 'hoje: não mostra' : 'padrão do perfil'})</option><option value="sim">Sempre mostrar a lista de tarefas</option><option value="nao">Nunca mostrar, só resultados</option></select>
        <div class="pf-desc">Cliente que não prioriza tarefas recebe o relatório focado em resultados: faturamento, crescimento ou queda, métricas da conta, Ads e Full, tarefas que geraram venda em detalhe, combinações e tarefa de cuidado.</div></div>
      <div class="pf-campo"><label for="pfPromocoes">Coletar promoções do Mercado Livre</label>
        <select id="pfPromocoes"><option value="">Padrão da base${padraoColeta}</option><option value="sim">Ligada: lê as promoções deste cliente na madrugada</option><option value="nao">Desligada: a madrugada pula este cliente</option></select>
        <div class="pf-desc">Só leitura, nunca marca nem altera promoção. Hoje: ${coletaTxt}. O botão "Reler o Mercado Livre" em Promoções continua valendo; a Folha do anúncio e a tela de Promoções leem o resultado.</div></div>
      <div class="pf-campo"><label for="pfPor">Seu nome (obrigatório)</label>
        <input id="pfPor" type="text" maxlength="80" autocomplete="name" placeholder="Quem está definindo o perfil" value="${esc(lerNome())}">
        <div class="pf-desc">Fica registrado junto do perfil.</div></div>
    </div>
    <div class="pf-rodape">
      <button class="btn" type="button" id="btnSalvarPerfil">Salvar perfil</button>
      <span class="mini">Os relatórios semanais estão em Documentos, no topo.</span>
    </div>
    <div id="pfMsg" class="mt-2">${salvo ? '<div class="aviso ok">Perfil salvo; vale a partir do próximo relatório.</div>' : ''}</div>
    <div class="mini mt-2">Em vigor (salvo): lista de tarefas ${regras.lista_tarefas ? 'sim' : 'não (só resultados)'} · densidade ${esc(regras.densidade ?? '—')} · provas ${esc(regras.provas ?? '—')} · linguagem ${esc(regras.linguagem ?? '—')} · tom ${esc(regras.tom ?? '—')} · coleta de promoções ${coletaTxt}</div>
  </div>`
  const sel = $('pfPrimario'), obj = $('pfObjetivo'), msg = (t, ok) => { $('pfMsg').innerHTML = `<div class="aviso ${ok ? 'ok' : 'erro'}">${esc(t)}</div>` }
  sel.value = primario; if (!sel.value) sel.selectedIndex = 0                 // primário que saiu da config: cai no 1º da lista
  primario = sel.value
  obj.value = p.objetivo?.id || ''; if (!obj.value) obj.selectedIndex = 0
  $('pfTarefas').value = p.tarefas_override === true ? 'sim' : p.tarefas_override === false ? 'nao' : ''
  $('pfPromocoes').value = p.coleta_promocoes === 1 ? 'sim' : p.coleta_promocoes === 0 ? 'nao' : ''
  const descricoes = () => {                                                  // textContent: a descrição da config nunca vira HTML
    $('pfDescP').textContent = r.perfis.find(x => x.id === primario)?.descricao || ''
    $('pfDescO').textContent = r.objetivos.find(x => x.id === obj.value)?.descricao || ''
  }
  const chips = () => {
    extras.delete(primario)
    $('pfChips').innerHTML = r.perfis.filter(x => x.id !== primario).map(x => `<button type="button" class="f-chip ${extras.has(x.id) ? 'on' : ''}" data-id="${esc(x.id)}" aria-pressed="${extras.has(x.id)}" title="${esc(x.descricao || '')}">${esc(x.rotulo)}</button>`).join('')
    $('pfChips').querySelectorAll('.f-chip').forEach(b => b.onclick = () => { extras.has(b.dataset.id) ? extras.delete(b.dataset.id) : extras.add(b.dataset.id); chips() })
  }
  sel.onchange = () => { primario = sel.value; chips(); descricoes() }
  obj.onchange = descricoes
  chips(); descricoes()
  $('btnSalvarPerfil').onclick = async e => {
    const btn = e.currentTarget, por = $('pfPor').value.trim()
    if (!por) { msg('Informe seu nome; ele fica registrado junto do perfil.', false); $('pfPor').focus(); return }
    btn.disabled = true
    try {
      const tv = $('pfTarefas').value, pv = $('pfPromocoes').value
      const s = await api('/api/cliente/perfil', { cliente, perfis: [primario, ...extras], objetivo: obj.value, por, tarefas_no_relatorio: tv === 'sim' ? true : tv === 'nao' ? false : null, coleta_promocoes: pv === 'sim' ? true : pv === 'nao' ? false : null })
      gravarNome(por)
      if (dados?.cliente === cliente) desenharPerfil(alvo, cliente, { ...r, perfil: s.perfil }, true)
    } catch (x) { msg(x.message, false); btn.disabled = false }
  }
}
