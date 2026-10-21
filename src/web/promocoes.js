// Tela "Promoções por cliente". Todo texto vindo de dados passa por esc(). Nenhum onclick inline: delegação por data-acao.
const $ = id => document.getElementById(id)
// <puro> — sem DOM: scripts/teste-promocoes-ui.mjs extrai este trecho (entre os marcadores) e o executa isolado
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const enc = encodeURIComponent
const fmtR = n => (n == null || !Number.isFinite(Number(n)) ? '—' : 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const fmtPct = n => (n == null || !Number.isFinite(Number(n)) ? '—' : Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%')
const TZ = 'America/Sao_Paulo'
const fmtTZ = (iso, o) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? null : new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, ...o }).format(d) }
const soData = s => /^\d{4}-\d{2}-\d{2}$/.test(s), semZona = s => !/(Z|[+-]\d{2}:?\d{2})$/i.test(s)
// Data pura e carimbo sem fuso são lidos como estão; carimbo com Z/offset (todo carimbo do servidor) vai para Brasília — data E hora pelo MESMO fuso.
const brData = iso => { if (!iso) return '—'; const s = String(iso), cru = () => s.slice(0, 10).split('-').reverse().join('/'); return soData(s) || semZona(s) ? cru() : fmtTZ(s, { day: '2-digit', month: '2-digit', year: 'numeric' }) ?? cru() }
const brHora = iso => { if (!iso) return '—'; const s = String(iso); if (soData(s)) return brData(s); const h = semZona(s) ? s.slice(11, 16) : fmtTZ(s, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); return h ? `${brData(s)} ${h}` : brData(s) }

const filtrosPadrao = () => ({ q: '', curva: '', situacao: '', campanha: '', so_piso: false, sem_rebate: false, pagina: 1 })
const filtrosAtivos = f => !!(f.q || f.curva || f.situacao || f.campanha || f.so_piso || f.sem_rebate)

// Contrato da coleta: 'concluida' | 'parcial' | 'erro' (e 'rodando' enquanto lê). Só 'concluida' é leitura completa: o resto nunca vira "fato da conta".
const LIMITES_FALHA = ['NOT_AUTHORIZED', 'NETWORK_ERROR', 'ML_INDISPONIVEL', 'PARCIAL']
const coletaConcluida = r => r?.coleta?.estado === 'concluida'
const temLimiteFalha = r => (r?.pendencias || []).some(p => LIMITES_FALHA.includes(p.estado))
const avisoColeta = r => { const c = r?.coleta; if (!c || c.estado === 'concluida') return ''; const x = c.resumo || {}, n = Number(x.leituras_falhas); return `Coleta ${c.estado}: números abaixo podem estar incompletos.` + (n ? ` ${n} leitura(s) falharam.` : '') + (x.erro ? ` ${x.erro}` : '') }
// zero de uma leitura que falhou não é fato: sem coleta confiável o KPI mostra "—" (parcial só esconde o zero)
const kpiVal = (r, v) => { const e = r?.coleta?.estado; return !e || e === 'erro' || (e !== 'concluida' && !v) ? '—' : v }
// sem dados de vendas = série indisponível OU vazia (cliente cuja série nunca foi coletada: disponivel:true, ate:null, 0 dias com dado) — nunca R$ 0,00 / Curva C
const semVendas = r => !r?.vendas?.disponivel || !r.vendas.ate || r.vendas.cobertura?.dias_com_dado === 0
const curvaTag = (r, c) => (semVendas(r) ? '<span class="curva" title="sem série de vendas: curva indeterminada">—</span>' : `<span class="curva c${esc(c)}">${esc(c)}</span>`)
const fatTxt = (r, v) => (semVendas(r) ? '—' : fmtR(v))
// imposto efetivo: o da config; senão o fallback de custos_cliente (o backend só emite SEM_IMPOSTO quando faltam os dois)
const impostoChip = r => {
  const cfg = r?.config?.imposto_pct, fb = r?.custos_cliente?.imposto_pct
  if (cfg != null) return `imposto ${fmtPct(cfg)}`
  if (fb != null) return `imposto ${fmtPct(fb)} (fallback custos_cliente)`
  return Array.isArray(r?.pendencias) && !r.pendencias.some(p => p.codigo === 'SEM_IMPOSTO') ? 'imposto: fallback custos_cliente' : 'imposto não configurado'
}
// filtro que zera uma tabela que TEM linhas é só filtro (limpar mostra a base); o aviso da coleta é dito à parte, nunca no lugar dele
const vazioElegiveis = (r, d) => !r?.coleta ? 'Faça a primeira coleta (botão "Reler o Mercado Livre").'
  : d.total_base ? 'Nenhum anúncio com esses filtros.' + (coletaConcluida(r) ? '' : ` Coleta ${r.coleta.estado}: a base pode estar incompleta — veja o aviso da coleta acima.`)
  : !coletaConcluida(r) ? `Coleta ${r.coleta.estado}: não dá para afirmar que a conta não tem anúncios elegíveis — refaça a coleta.`
  : temLimiteFalha(r) ? 'Nenhum elegível apareceu, mas a coleta teve falhas de leitura (veja as pendências acima): refaça a coleta antes de concluir que não há.'
  : 'Nenhum anúncio com campanha de rebate elegível nesta coleta. Isto é um fato da conta, não um erro — veja "Participando e cobertura" e marque "incluir campanhas sem rebate" para ver o que existe.'
const msgSemDescobertos = (r, nExc) => !r?.coleta ? 'Sem coleta: o vigia de cobertura ainda não pôde ser avaliado.'
  : !coletaConcluida(r) ? `Coleta ${r.coleta.estado}: não dá para afirmar que não há protegidos descobertos — refaça a coleta.`
  : semVendas(r) ? 'Sem série de vendas: a curva A/B é indeterminada e o vigia de cobertura não pôde avaliar os protegidos por curva (só os que você marcou) — atualize a coleta de vendas.'
  : nExc ? `Nenhum protegido descoberto entre os avaliados, mas ${nExc} protegido(s) ficaram com cobertura DESCONHECIDA (fora da conta — veja as exceções abaixo).`
  : 'Nenhum protegido descoberto nesta janela.'
const opcoesDias = dias => [...new Set([7, 14, 30, 60, Number(dias)])].filter(n => Number.isFinite(n) && n > 0).sort((x, y) => x - y)
const paginaAlvo = d => (!d.itens.length && d.total > 0 ? Math.max(1, Math.ceil(d.total / (d.limite || 50))) : 0)   // página fora do intervalo → última válida
const textoAprovarTodas = (n, filtrado, barradas = 0) => `Aprovar ${n} anúncio(s) com sugestão 🤖 pendente(s) de TODO o cliente${filtrado ? ' — os filtros da tela NÃO limitam esta aprovação (inclui anúncios que você não está vendo)' : ''}. Aprovar não executa nada: só habilita a entrada no plano.${barradas ? ` (${barradas} sugestão(ões) barrada(s) por recusa/bloqueio seu não entram na conta.)` : ''}`
// estado vazio de lista que depende da leitura dos anúncios: sem coleta concluída "nenhum/todos" é ausência de dado, nunca fato da conta
const vazioFato = (r, oQue, fato) => (coletaConcluida(r) ? fato : !r?.coleta ? `Sem coleta: não dá para afirmar ${oQue} — rode "Reler o Mercado Livre".` : `Sem leitura confiável (coleta ${r.coleta.estado}): não dá para afirmar ${oQue} — refaça a coleta.`)
// toast do fim da coleta pelo estado REAL do resultado do job: parcial/erro e a falha de "atualizar vendas antes" nunca saem como "concluída" neutra
const desfechoColeta = (cli, r) => {
  const est = r.estado || 'concluida', ok = est === 'concluida', n = Number(r.leituras_falhas) || 0, lidos = `${r.campanhas} campanha(s), ${r.campanhas_rebate} de rebate, ${r.anuncios_lidos} anúncio(s) lidos`
  return { ruim: !ok || !!r.vendas?.erro, msg: (ok ? `Coleta de ${cli} concluída: ${lidos}` : `Coleta de ${cli} ${String(est).toUpperCase()}: ${lidos}${n ? ` · ${n} leitura(s) falharam` : ''} — números podem estar incompletos; analista e plano só valem sobre coleta concluída`)
    + (r.vendas?.erro ? ` · vendas NÃO atualizadas: ${r.vendas.erro}` : '') + (r.derrubadas?.derrubadas ? ` · ⚠ ${r.derrubadas.derrubadas} participação(ões) sumiram antes do prazo` : '') }
}
// toast da aprovação pela resposta do servidor: nunca "aprovada" quando o servidor barrou (recusa 👤 / IGNORAR / Revisar toda rodada) ou não achou a sugestão pendente
// o par aprovado leva os NÚMEROS exibidos no botão (data-preco/data-mc; vazio = "—" = null): o servidor só aprova se a sugestão ainda tiver estes números
const parDoBotao = ds => ({ item_id: ds.item, pid: ds.pid, preco: ds.preco == null || ds.preco === '' ? null : Number(ds.preco), mc_pct: ds.mc == null || ds.mc === '' ? null : Number(ds.mc) })
const desfechoAprovacao = r => {
  const a = Number(r?.aprovadas) || 0, b = Number(r?.bloqueadas_por_recusa) || 0
  return { ruim: !a || b > 0, msg: (a ? `${a} sugestão(ões) aprovada(s)` : 'Nenhuma sugestão aprovada') + (b ? ` · ${b} bloqueada(s) por recusa do dono` : a ? '' : ' — a sugestão não está mais pendente') }
}
// desfecho da execução pelo resultado REAL do job (estado, resumo, interrompido, erro, resposta por chamada): enviada | interrompida | erro | nada enviado — nunca "enviada" sem POST
const desfechoExecucao = (cli, res) => {
  const ch = Array.isArray(res?.chamadas) ? res.chamadas : [], rs = res?.resumo || {}, est = res?.estado
  const enviadas = Number.isFinite(Number(rs.chamadas)) ? Number(rs.chamadas) : ch.filter(c => c.chamada).length
  const falha = res?.interrompido || res?.erro || res?.motivo || '', motivos = [...new Set(ch.filter(c => !c.chamada && c.resposta).map(c => c.resposta))].slice(0, 3).join(' | ')
  const naoEnv = Number(rs.nao_enviadas) || 0, atencao = naoEnv + (Number(rs.recusadas) || 0) + (Number(rs.incertas) || 0)
  if (est === 'nao_iniciada') return { tipo: 'nada', ruim: true, msg: `Execução de ${cli} NÃO foi iniciada: nada foi enviado ao Mercado Livre.${falha ? ' ' + falha : ''}` }
  if (est === 'erro' || est === 'executado_parcial' || res?.interrompido || res?.erro) return enviadas
    ? { tipo: 'interrompida', ruim: true, msg: `Execução de ${cli} INTERROMPIDA: ${enviadas} chamada(s) enviada(s), ${naoEnv} não enviada(s). ${falha}${falha ? '. ' : ''}Confira a Auditoria e o painel do ML antes de repetir.` }
    : { tipo: 'erro', ruim: true, msg: `Execução de ${cli} com ERRO: nenhuma chamada foi enviada. ${falha || motivos}` }
  if (!enviadas) return { tipo: 'nada', ruim: true, msg: `Nada foi enviado ao Mercado Livre${motivos || falha ? ': ' + (motivos || falha) : ' (o pre-check ao vivo barrou todas as chamadas)'}.` }
  return { tipo: 'enviada', ruim: atencao > 0, msg: `Execução de ${cli} enviada: ${enviadas} chamada(s)${atencao ? ` — ${naoEnv} não enviada(s), ${rs.recusadas || 0} recusada(s), ${rs.incertas || 0} incerta(s): veja o resultado` : ''}. "Entrou" só com prova — sincronize depois da propagação.` }
}
// read-back do invariante: o número da janela do KPI (config.dias_vigia) em destaque e as outras ao lado — somar 7d+14d contaria o mesmo anúncio duas vezes
const textoReadback = (inv, dias) => {
  const rb = inv.readback, js = Array.isArray(rb.janelas) && rb.janelas.length ? rb.janelas : null, p = js && (js.find(j => Number(j.dias) === Number(dias)) || js[0])
  const cob = p ? `${p.descobertos} protegidos descobertos em ${p.dias}d (janela do KPI)` + (js.length > 1 ? ` · ${js.filter(j => j !== p).map(j => `${j.dias}d: ${j.descobertos}`).join(' · ')} (o mesmo anúncio conta 1× por janela)` : '') : `${rb.protegidos_descobertos} alerta(s) de cobertura (anúncio×janela)`
  return `read-back: ${rb.elegiveis_ge_piso} elegíveis ≥ piso, ${cob}, ${rb.rebate_pior} rebate-pior`
}
// aviso ANTES de reaplicar o analista: aprovação do dono vale para os números aprovados e é revogada se a rodada recalcular números diferentes
const textoAplicar = n => `Gravar as recomendações do analista? Recalcula as linhas 🤖 (suas marcas 👤 nunca são tocadas). ` + (n > 0 ? `Você tem ${n} aprovação(ões) 🤖: as que ficarem com preço ou MC% diferente na rodada nova serão REVOGADAS e precisam ser aprovadas de novo (senão "Gerar plano" falha por falta de marca efetiva).`
  : n === 0 ? 'Nenhuma aprovação 🤖 sua está em risco.' : 'Aprovações 🤖 suas cujo preço ou MC% mudarem na rodada nova serão REVOGADAS e precisam ser aprovadas de novo (esta resposta não traz a contagem exata).')
// marca em decisão via painel: só 'humano' é decisão do dono (👤); qualquer outra origem (analista, desconhecida) é 🤖 — nunca apresentada como escolha do dono
const ehMarcaHumana = m => m?.origem === 'humano'
// alerta de cobertura INCERTA (saida 'CONFIRMAR COBERTURA' / incerta:true): confirmar em /items/{id}/prices — não é "SUGERIR MANUAL" nem conta como descoberto
const ehIncerta = a => !!a?.incerta || a?.saida === 'CONFIRMAR COBERTURA'
// abas com formulário/rascunho em edição: o fim da coleta atualiza só status/KPIs, nunca repinta (apagaria o que o dono digitava)
const ABAS_FORM = new Set(['custos', 'regras', 'interrogatorio'])
const estadoSelo = p => (p.estado === 'executado' ? ((p.resultado?.resumo?.entrou_provado || 0) > 0 ? 'bom' : 'atencao') : ({ 'dry-run': 'neutro', aprovado: 'bom', cancelado: 'ruim', executando: 'atencao', executado_parcial: 'atencao', erro: 'ruim' }[p.estado] || 'neutro'))
const botaoExecutar = (p, bloq) => (p.estado !== 'aprovado' || p.expirado ? 'oculto' : bloq ? 'desabilitado' : 'ativo')
// ações que gravam: exigem "Seu nome" (autoria na auditoria) e nenhum job em andamento no cliente
const GRAVAM = new Set(['marcar', 'aprovar', 'aprovar-todas', 'aprovar-todas-ok', 'protegido', 'analista-aplicar', 'analista-aplicar-ok', 'rm-regra', 'off-aprend', 'plano-gerar', 'plano-aprovar', 'plano-executar', 'plano-sync'])
// foco após repintar: o elemento focado é identificado por id ou por data-* (a posição muda, o dado não)
const aq = v => String(v).replace(/["\\]/g, '\\$&')
const DATA_FOCO = ['foco', 'item', 'pid', 'v', 'k', 'id', 'mlb', 'sku']
const seletorFoco = el => { if (!el) return ''; if (el.id) return `[id="${aq(el.id)}"]`; const d = el.dataset || {}; return d.acao ? `[data-acao="${aq(d.acao)}"]` + DATA_FOCO.filter(k => d[k]).map(k => `[data-${k}="${aq(d[k])}"]`).join('') : '' }
// Token de requisição: cada render captura (cliente, aba, tok) e só pinta se ainda forem os atuais; resposta velha vira OBSOLETA e é descartada em silêncio.
function criarRender(S, api) {
  const OBSOLETA = new Error('resposta obsoleta')
  const nova = aba => { if (aba !== S.aba) throw OBSOLETA; return { cli: S.cliente, aba, tok: ++S.tok } }
  const atual = t => t.cli === S.cliente && t.aba === S.aba && t.tok === S.tok
  const carregar = async (t, url) => { let d; try { d = await api(url) } catch (e) { throw atual(t) ? e : OBSOLETA } if (!atual(t)) throw OBSOLETA; return d }
  return { OBSOLETA, nova, atual, carregar }
}
// <custos-erp> aba Custos: custo efetivo com proveniência (skus_efetivos) e pendências de custo (custos_pendencias) do GET /api/promocoes/custos
// (integração ERP/planilha). Sem esses campos (servidor sem a integração) a tabela é a de antes. Frescor: verde dentro do limite, âmbar velho.
const VELHO_DIAS = { bling: 3, tiny: 3, sheets: 14 }   // padrão do dono (spec 13 #7); se o item trouxer `velha` (custosEfetivosDetalhe, limite do cliente), vale o do servidor
const ROT_PEND_CUSTO = { CUSTO_FONTE_VELHA: 'custo velho', CUSTO_FONTE_ERRO: 'erro na fonte', CUSTO_REAUTORIZAR: 'reautorizar ERP', CUSTO_QUARENTENA: 'quarentena', CUSTO_REJEITADO: 'rejeitado', CUSTO_NAO_VISTO: 'não visto' }
const frescorCusto = i => {
  if (i.fonte === 'manual') return '<span class="mudo peq">manual (sem prazo)</span>'
  if (i.nao_visto_desde) return `<span class="selo atencao">não visto desde ${esc(brData(i.nao_visto_desde))}</span>`
  const idade = i.idade_dias == null || i.idade_dias === '' ? NaN : Number(i.idade_dias)
  const velho = typeof i.velha === 'boolean' ? i.velha : !(idade <= (VELHO_DIAS[i.fonte] ?? 3))   // sem idade conhecida = velho (nunca "em dia" sem prova)
  return `<span class="selo ${velho ? 'atencao' : 'bom'}">${velho ? 'custo velho' : 'em dia'}${Number.isFinite(idade) ? esc(` · há ${idade.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} d`) : ''}</span>`
}
const faixaPendCustos = (pend, cliente) => (Array.isArray(pend) && pend.length ? `<div class="aviso-faixa"><b>Custos vindos de ERP/planilha</b> (o custo velho continua valendo: a pendência só avisa) · <a href="/integracoes?custos=${enc(cliente)}">abrir o cartão de custos</a><ul>${pend.map(p => `<li><span class="tagzinha">${esc(ROT_PEND_CUSTO[p.codigo] || p.estado || p.codigo)}</span> ${esc(p.texto)}</li>`).join('')}</ul></div>` : '')
const secaoCustos = (d, cliente) => {
  const ef = Array.isArray(d.skus_efetivos) ? { total: d.skus_efetivos.length, itens: d.skus_efetivos } : d.skus_efetivos
  if (!Array.isArray(ef?.itens)) return `<div class="secao"><h3>Custos cadastrados (${d.skus.length})</h3>${d.skus.length ? `<div class="tabela-wrap"><table class="t"><thead><tr><th>SKU</th><th class="n">Custo</th><th>Fonte</th><th>Atualizado</th></tr></thead><tbody>${d.skus.slice(0, 300).map(s => `<tr><td>${esc(s.sku)}</td><td class="n">${fmtR(s.custo)}</td><td>${esc(s.fonte)}</td><td>${esc(brData(s.atualizado_em))}</td></tr>`).join('')}</tbody></table></div>${d.skus.length > 300 ? `<div class="mudo peq">mostrando 300 de ${d.skus.length}</div>` : ''}` : '<div class="vazio-box">Nenhum custo por SKU cadastrado.</div>'}</div>`
  const livre = new Map((d.skus || []).map(s => [String(s.sku).toLowerCase(), s.fonte]))   // a linha manual mostra a sua "fonte" livre no lugar do campo do ERP
  const total = Number(ef.total ?? ef.itens.length)
  return `<div class="secao"><h3>Custos efetivos (${esc(total)})</h3><div class="sub">Vale a primeira fonte com custo válido na ordem de precedência (padrão: manual &gt; Bling &gt; Tiny &gt; planilha). Quarentena e reconciliação: <a href="/integracoes?custos=${enc(cliente)}">cartão de custos nas Integrações</a>.</div>
    ${ef.itens.length ? `<div class="tabela-wrap"><table class="t"><thead><tr><th>SKU</th><th class="n">Custo</th><th>Fonte</th><th>Campo do ERP / fonte livre</th><th>Atualizado na fonte</th><th>Recebido / visto</th><th>Frescor</th></tr></thead><tbody>${ef.itens.map(i => `<tr>
      <td>${esc(i.sku)}</td><td class="n">${fmtR(i.custo)}</td>
      <td>${esc(i.fonte)}${Array.isArray(i.perdedoras) && i.perdedoras.length ? `<div class="mudo peq">também: ${i.perdedoras.map(x => `${esc(x.fonte)} ${fmtR(x.custo)}`).join(' · ')}</div>` : ''}</td>
      <td>${esc(i.fonte === 'manual' ? livre.get(String(i.sku).toLowerCase()) || '—' : i.campo || '—')}${i.id_externo ? `<div class="mudo peq">id ${esc(i.id_externo)}</div>` : ''}</td>
      <td>${esc(brHora(i.atualizado_na_fonte))}</td><td>${esc(brHora(i.recebido_em))}<div class="mudo peq">visto ${esc(brHora(i.visto_em))}</div></td><td>${frescorCusto(i)}</td></tr>`).join('')}</tbody></table></div>${total > ef.itens.length ? `<div class="mudo peq">mostrando ${esc(ef.itens.length)} de ${esc(total)}</div>` : ''}`
    : '<div class="vazio-box">Nenhum custo por SKU (nem manual, nem de ERP/planilha).</div>'}</div>`
}
// vínculo custo ↔ anúncio (GET /api/custos/vinculos): os candidatos vêm da semelhança nome do custo × título; nada é gravado sem Confirmar / Não é este / Vincular.
// A origem diz POR QUE o custo vale para o anúncio (precedência do servidor: manual > SKU igual > SKU normalizado > herdado do mesmo produto).
const ROT_ORIGEM = { manual: 'manual', sku: 'SKU', sku_normalizado: 'SKU normalizado', grupo: 'herdado' }
const TIT_ORIGEM = { manual: 'vínculo feito à mão (manda sobre o SKU)', sku: 'SKU do anúncio igual ao SKU de custo', sku_normalizado: 'vínculo automático por SKU normalizado (sem espaço e hífen; só um custo casa)', grupo: 'herdado de outro anúncio do mesmo produto (user_product_id)' }
const hOrigem = o => (o ? `<span class="tagzinha" title="${esc(TIT_ORIGEM[o] || o)}">${esc(ROT_ORIGEM[o] || o)}</span>` : '<span class="mudo">—</span>')
// ID digitado: aceita "mlb-123…" e devolve "MLB123…", ou '' fora de ^MLB[0-9]{6,12}$ (mesma régua do vínculo de tarefa da tela do cliente)
const normMlb = s => { const id = String(s ?? '').trim().toUpperCase().replace(/^MLB-?/, 'MLB'); return /^MLB[0-9]{6,12}$/.test(id) ? id : '' }
const urlImg = u => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '')
const hImg = (u, alt) => (urlImg(u) ? `<img class="pr-thumb" src="${esc(urlImg(u))}" alt="${esc(alt)}" loading="lazy" referrerpolicy="no-referrer">` : '<span class="pr-thumb pr-semimg">sem imagem</span>')
const hPar = (item, sku) => `<span class="pr-acoes"><button class="btn-mini ok" type="button" data-acao="cv-vincular" data-item="${esc(item)}" data-sku="${esc(sku)}">Confirmar</button><button class="btn-mini no" type="button" data-acao="cv-recusar" data-item="${esc(item)}" data-sku="${esc(sku)}">Não é este</button></span>`
// selo de catálogo (mesmo markup de acomp.js → seloCatalogo; esta página não carrega acomp.js): terceiros = conteúdo controlado pelo catálogo; próprio = só por sugestão de correção
const hSelo = o => o === 'terceiros' ? '<span class="selo azul" title="Conteúdo controlado pelo catálogo do Mercado Livre: foto, título e descrição não são alterados pelo vendedor">Catálogo</span>' : o === 'proprio' ? '<span class="selo azul" title="Catálogo próprio: o conteúdo muda por sugestão de correção, com revisão do Mercado Livre">Catálogo próprio</span>' : ''
const hCand = (sku, c) => `<div class="pr-cand">${hImg(c.thumb, c.titulo)}<div class="pr-cand-txt"><div>${esc(String(c.titulo || c.item_id).slice(0, 90))} ${hSelo(c.catalogo_origem)}</div><div class="mudo peq">${esc(c.item_id)} · ${esc(c.sku ? 'SKU ' + c.sku : 'sem SKU')} · semelhança ${esc(c.semelhanca)}%</div></div>${hPar(c.item_id, sku)}</div>`
const hCands = c => (c.candidatos || []).map(x => hCand(c.sku_custo, x)).join('') || '<div class="mudo peq">Nenhum anúncio sem custo parecido pelo nome: informe o ID.</div>'
const hCustoSemAnuncio = c => `<div class="pr-vinc"><div><b>${esc(c.sku_custo)}</b> <span class="mudo">${fmtR(c.custo)}</span></div>${hCands(c)}
  <div class="pr-manual"><input type="text" maxlength="20" placeholder="ID do anúncio (MLB…)" aria-label="ID do anúncio para o custo ${esc(c.sku_custo)}"><button class="btn-mini" type="button" data-acao="cv-manual" data-sku="${esc(c.sku_custo)}">Vincular</button></div></div>`
const hParecidos = a => ((a.candidatos || []).length ? `<div class="mudo peq">parecidos pelo nome: ${esc(a.candidatos.map(c => c.sku_custo + ' (' + c.semelhanca + '%)').join(' · '))}</div>` : '')
const hAnuncioSemCusto = (a, foco) => `<div class="pr-vinc pr-vinc-an${foco ? ' foco' : ''}">${hImg(a.thumb, a.titulo)}<div class="pr-cand-txt"><div>${esc(String(a.titulo || a.item_id).slice(0, 90))} ${hSelo(a.catalogo_origem)}</div><div class="mudo peq">${esc(a.item_id)} · ${esc(a.sku ? 'SKU ' + a.sku : 'sem SKU')} · fat. 30d ${fmtR(a.fat30)}</div>${hParecidos(a)}</div>
  <div class="pr-manual"><input type="text" list="cvCustos" maxlength="80"${foco ? ' id="cvFoco"' : ''} placeholder="Escolher custo (digite o SKU)" aria-label="Escolher custo para ${esc(a.item_id)}"><button class="btn-mini" type="button" data-acao="cv-escolher" data-item="${esc(a.item_id)}">Vincular</button></div></div>`
// manual se desfaz; automático errado (SKU normalizado, herdado, até o SKU igual) sai com "Não é este" (grava recusado: o par não volta)
const hDesvinc = v => (v.origem === 'manual' ? `<button class="btn-mini perigo" type="button" data-acao="cv-desvincular" data-item="${esc(v.item_id)}" data-sku="${esc(v.sku_custo)}">Desvincular</button>`
  : `<button class="btn-mini no" type="button" data-acao="cv-recusar" data-item="${esc(v.item_id)}" data-sku="${esc(v.sku_custo)}">Não é este</button>`)
const hLinhaVinc = v => `<tr><td>${esc(v.item_id)}</td><td>${esc(v.sku_custo)}</td><td>${hOrigem(v.origem)}</td><td class="mudo peq">${esc(v.por ? v.por + ' · ' + brData(v.em) : 'automático')}</td><td>${hDesvinc(v)}</td></tr>`
const hOpcao = s => `<option value="${esc(s.sku)}">${fmtR(s.custo)}</option>`
const hOpcoes = l => l.map(hOpcao).join('')
const hLinhasVinc = l => l.map(hLinhaVinc).join('')
// "Mostrar mais" de 50 em 50 (data-acao="mais", como pag50) e o teto do servidor (500 por lista) dito com o total real
const hMais = (k, mostra, lista, total) => (lista > mostra ? `<div class="t-pag">1–${esc(mostra)} de ${esc(lista)} · <button class="btn btn-fantasma btn-p" data-acao="mais" data-k="${esc(k)}">Mostrar mais</button></div>` : '') + (total > lista ? `<div class="mudo peq">a lista para em ${esc(lista)} de ${esc(total)}: vincule estes e recarregue</div>` : '')
// as três seções do vínculo. foco = anúncio vindo do atalho "Vincular custo" (Elegíveis): sobe para o topo de "Anúncios sem custo", destacado e com id="cvFoco"
function secaoVinculos(v, { r = null, foco = '', mais = {}, custos = [] } = {}) {
  const n = k => mais[k] || 50, tot = v.totais || {}
  const cs = v.custos_sem_anuncio || [], vs = v.vinculados || []
  const as = [...(v.anuncios_sem_custo || [])].sort((x, y) => (y.item_id === foco) - (x.item_id === foco))      // sort estável: o resto fica por faturamento
  const nT = x => Number(x) || 0
  return `<datalist id="cvCustos">${hOpcoes(custos)}</datalist>
    <div class="secao"><h3>Custos sem anúncio (${esc(nT(tot.custos_sem_anuncio ?? cs.length))})</h3><div class="sub">Custo cadastrado que não vale para nenhum anúncio. Candidatos pela semelhança entre o nome do custo e o título do anúncio: nada é gravado sem "Confirmar"; "Não é este" tira o candidato de vez.</div>
    ${cs.length ? cs.slice(0, n('cv_custos')).map(hCustoSemAnuncio).join('') + hMais('cv_custos', n('cv_custos'), cs.length, nT(tot.custos_sem_anuncio)) : `<div class="vazio-box">${custos.length ? 'Todo custo cadastrado vale para algum anúncio.' : 'Nenhum custo cadastrado: importe abaixo ou conecte o ERP/planilha em Integrações.'}</div>`}</div>
    <div class="secao"><h3>Anúncios sem custo (${esc(nT(tot.anuncios_sem_custo ?? as.length))})</h3><div class="sub">Anúncios ativos sem custo, do maior faturamento em 30 dias para o menor. Escolha o custo (digite para buscar o SKU) e clique em Vincular.</div>
    ${as.length ? as.slice(0, n('cv_anuncios')).map(a => hAnuncioSemCusto(a, a.item_id === foco)).join('') + hMais('cv_anuncios', n('cv_anuncios'), as.length, nT(tot.anuncios_sem_custo)) : `<div class="vazio-box">${esc(vazioFato(r, 'que todo anúncio ativo tem custo', 'Todo anúncio ativo tem custo.'))}</div>`}</div>
    <div class="secao"><h3>Custo por anúncio (${esc(nT(tot.vinculados ?? vs.length))})</h3><div class="sub">Origem do custo: manual (vínculo feito à mão), SKU (igual ao do custo), SKU normalizado (igual sem espaço e hífen) ou herdado (de outro anúncio do mesmo produto). O manual se desfaz aqui; um automático errado sai com "Não é este".</div>
    ${vs.length ? `<div class="tabela-wrap"><table class="t"><thead><tr><th>Anúncio</th><th>SKU de custo</th><th>Origem do custo</th><th>Quem / quando</th><th></th></tr></thead><tbody>${hLinhasVinc(vs.slice(0, n('cv_vinculados')))}</tbody></table></div>` + hMais('cv_vinculados', n('cv_vinculados'), vs.length, vs.length) : '<div class="vazio-box">Nenhum anúncio com custo ainda.</div>'}</div>`
}
// </custos-erp>
// </puro>
const sleep = ms => new Promise(r => setTimeout(r, ms))
const api = async (url, body, metodo) => {
  const r = await fetch(url, body === undefined ? undefined : { method: metodo || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.erro || `erro ${r.status}`)
  return j
}
// duas regiões vivas fixas (nunca escondidas por hidden/display, senão o leitor de tela não anuncia): erro em role=alert, aviso em role=status
const toastT = {}
function toast(msg, ruim = false) {
  const t = $(ruim ? 'toastErro' : 'toast'); $(ruim ? 'toast' : 'toastErro').textContent = ''; t.textContent = msg
  clearTimeout(toastT[t.id]); toastT[t.id] = setTimeout(() => { t.textContent = '' }, ruim ? 7000 : 3500)
}
const quem = () => $('quem').value.trim()
const exigirQuem = () => { if (!quem()) { $('quem').focus(); toast('Informe "Seu nome" no topo — a decisão fica registrada com o seu nome.', true); return false } return true }
// job em andamento: por cliente (trocar de cliente não trava o outro, nem perde o acompanhamento do primeiro)
const ocupado = () => !!S.jobs[S.cliente]
const bloqueadoPorJob = () => { if (!ocupado()) return false; toast('Há um job em andamento neste cliente — aguarde terminar.', true); return true }
const podeGravar = () => !bloqueadoPorJob() && exigirQuem()
// desabilita só o que o job desabilitou (data-por-job) e reabilita só isso: botão que já nasceu desabilitado (ex.: "Próxima →" na última página) fica como está
function sincOcupado(raiz = document) {
  const oc = ocupado()
  raiz.querySelectorAll('button.btn,button.btn-mini').forEach(b => { if (oc && !b.disabled) { b.disabled = true; b.dataset.porJob = '1' } else if (!oc && b.dataset.porJob) { b.disabled = false; delete b.dataset.porJob } })
}
// repinta preservando o foco do teclado: guarda o elemento ativo (id/data-*) e a seleção do campo, e o devolve depois do innerHTML
function pintarEm(alvo, html) {
  const ae = document.activeElement, dentro = !!ae && ae !== document.body && alvo.contains(ae)
  const sel = dentro ? seletorFoco(ae) : '', pos = dentro && typeof ae.selectionStart === 'number' ? [ae.selectionStart, ae.selectionEnd] : null
  alvo.innerHTML = html; sincOcupado(alvo)
  if (!dentro) return
  let novo = null; try { novo = sel ? alvo.querySelector(sel) : null } catch { /* seletor inválido: cai no contêiner */ }
  if (!novo || novo.disabled || novo.closest('[hidden]')) { novo = alvo; alvo.tabIndex = -1 }
  novo.focus({ preventScroll: true }); if (pos && novo !== alvo) { try { novo.setSelectionRange(pos[0], pos[1]) } catch { /* campo sem seleção */ } }
}
// uso: pintar`<div>${x}</div>` (template etiquetado: os mesmos ${} de antes, sem fechar parêntese) ou pintar(htmlString)
const pintar = (s, ...v) => pintarEm($('conteudo'), typeof s === 'string' ? s : s.reduce((a, p, i) => a + p + (i < v.length ? v[i] : ''), ''))
const falha = e => { if (e !== OBSOLETA) toast(e.message, true) }
// depois de gravar: recarrega o resumo (KPIs) e a aba de origem; resposta de outra aba/cliente é descartada sem barulho
const aposGravar = refaz => Promise.all([recarregarResumo().catch(falha), refaz().catch(falha)])
$('quem').value = (() => { try { return localStorage.getItem('promo_quem') || '' } catch { return '' } })()
$('quem').addEventListener('change', () => { try { localStorage.setItem('promo_quem', quem()) } catch { /* sem storage: segue */ } })

// ordem do trabalho (spec 7.4): decisão │ configuração │ histórico — as chaves ?aba= e os rótulos não mudam
const ABAS = [['elegiveis', 'Campanhas candidatas'], ['participando', 'No ar e cobertura dos protegidos'], ['relampago', 'Ofertas relâmpago (candidatos)'], ['plano', 'Plano'], ['custos', 'Custo ligado ao anúncio'], ['regras', 'Regras por SKU'], ['interrogatorio', 'Divergências humano × analista automático'], ['auditoria', 'Auditoria']]
// tok/nav/seqResumo = tokens de requisição (ver criarRender); jobs = { cliente: rótulo } dos jobs em acompanhamento; abertos = linhas "Detalhes" abertas; execBloq = { cli, id, aviso } após execução interrompida; mais = { lista: quantas linhas já mostra }; focoCusto = anúncio do atalho "Vincular custo"
const S = { cliente: '', aba: 'elegiveis', resumo: null, f: filtrosPadrao(), planoId: '', jobs: {}, abertos: new Set(), tok: 0, nav: 0, seqResumo: 0, execBloq: null, mais: {}, focoCusto: '' }
const { OBSOLETA, nova, carregar } = criarRender(S, api)

// ── estados de bloco (spec 5.8) ─────────────────────────────────────────────────────────────────────
const skTabela = '<div class="skeleton" aria-hidden="true"></div><div class="sk-tabela mt-2" aria-hidden="true"></div>'
// erro de bloco: título fixo, mensagem humana, [Tentar de novo] (data-acao de quem repinta) e o detalhe cru recolhido
const erroBloco = (e, tentar) => `<div class="erro-bloco"><b>Não foi possível carregar</b>${esc(e.message)}<div><button class="btn" ${tentar}>Tentar de novo</button></div><details><summary>Detalhe técnico</summary><pre>${esc(e.stack || e.message)}</pre></details></div>`
// listas longas: 50 por vez; "Mostrar mais" repinta a aba atual com mais 50 (S.mais[k])
const pag50 = (lista, k) => { const n = S.mais[k] || 50, it = lista.slice(0, n); return { it, rod: lista.length > n ? `<div class="t-pag">1–${n} de ${lista.length.toLocaleString('pt-BR')} · <button class="btn btn-fantasma btn-p" data-acao="mais" data-k="${k}">Mostrar mais</button></div>` : '' } }
// códigos crus das pendências viram rótulo; o código fica no title
const ROT_PEND = { NEEDS_EXTERNAL_DATA: 'falta dado externo', ATENCAO: 'atenção', NOT_AVAILABLE: 'indisponível', NOT_AUTHORIZED: 'sem autorização', NETWORK_ERROR: 'erro de rede', ML_INDISPONIVEL: 'ML indisponível', PARCIAL: 'leitura parcial' }
const rotPend = cod => `<span class="tagzinha" title="${esc(cod)}">${esc(ROT_PEND[cod] || String(cod || '').toLowerCase().replace(/_/g, ' '))}</span>`
const comoFunciona = (titulo, html) => `<details class="recolhido"><summary>${esc(titulo)}</summary><div class="explica">${html}</div></details>`

// ── veredito e próxima ação (calculados no front com o resumo que a tela já recebe) ─────────────────
// o veredito interpreta (proporção, bloqueio); os números ficam só nos .kpi (spec 5.1)
const parteDe = (n, t, de) => (n >= t ? `todos os ${de}` : n / t >= 0.8 ? `quase todos os ${de}` : n / t > 0.5 ? `a maioria dos ${de}` : n / t > 0.2 ? `parte dos ${de}` : `poucos ${de}`)
function textoVeredito(r) {
  const k = r.kpis || {}, c = r.coleta
  if (!c) return 'Sem coleta: <b>faça a primeira coleta</b> para ler campanhas, margem e cobertura.'
  if (!coletaConcluida(r)) return `Coleta ${esc(c.estado)}: <b>os números não são confiáveis</b> até refazer a coleta.`
  const cob = semVendas(r) ? 'cobertura não avaliada (sem série de vendas)' : k.descobertos ? `<b>há protegidos descobertos</b> em ${esc(r.config.dias_vigia)} dias` : 'nenhum protegido fica descoberto'
  // sem imposto (ou sem custo em todos os elegíveis) nenhuma MC existe: "0 ≥ piso" é leitura bloqueada, não fato
  const semImp = (r.pendencias || []).some(p => p.codigo === 'SEM_IMPOSTO'), tudoSemCusto = k.elegiveis > 0 && k.sem_custo >= k.elegiveis
  const f = semImp || tudoSemCusto
    ? `${semImp ? 'sem imposto configurado' : 'sem custo em todos os elegíveis'}, <b>a margem não é calculada</b>: nenhuma oportunidade pode ser lida ainda; ${cob}.`
    : [!k.elegiveis ? 'nenhum anúncio tem campanha de rebate elegível' : k.elegiveis_ge_piso ? `há campanha sem furar o piso para <b>${parteDe(k.elegiveis_ge_piso, k.elegiveis, 'elegíveis')}</b>` : '<b>nenhum elegível passa o piso</b> de margem',
      k.sem_custo ? `falta custo em ${parteDe(k.sem_custo, k.elegiveis, 'elegíveis')} (sem margem calculada)` : '', cob].filter(Boolean).join('; ') + '.'
  return r.frescor?.fresca ? f.charAt(0).toUpperCase() + f.slice(1) : 'Leitura de uma coleta velha: ' + f
}
const botaoProximo = (rot, acao, extra = '') => `<button class="btn btn-primario" data-acao="${acao}" ${extra}>${rot}</button>`
// o único botão cheio da tela: ou o "Coletar agora" (passos de coleta) ou o de #proximoAcao — nunca os dois
async function pintarProximo(r) {
  const k = r.kpis || {}, cli = S.cliente, idade = r.frescor?.idade_horas
  let texto, acao = ''
  if (!r.coleta) texto = 'Primeira coleta deste cliente'
  else if (!coletaConcluida(r)) texto = `Coleta ${r.coleta.estado}: refaça a coleta`
  else if (!r.frescor?.fresca) texto = `Coleta de há ${idade == null ? 'mais de 12' : idade >= 48 ? Math.round(idade / 24) + ' dias' : idade + ' h'}: refaça antes de decidir`
  else if ((r.pendencias || []).some(p => p.codigo === 'SEM_IMPOSTO')) { texto = 'Imposto não configurado: a margem não é confiável'; acao = botaoProximo('Configurar custos', 'aba', 'data-k="custos"') }
  else if (k.sem_custo) { texto = `${k.sem_custo} anúncio(s) sem custo: a margem não é confiável`; acao = botaoProximo('Configurar custos', 'aba', 'data-k="custos"') }
  else if (k.sugeridas) { texto = `${k.sugeridas} sugestão(ões) do analista aguardando`; acao = botaoProximo('Aprovar sugestões', 'ir-aprovar') }
  else if (k.marcadas) {
    const p = await api(`/api/promocoes/plano?cliente=${enc(cli)}`).then(x => x.plano).catch(() => null)
    if (cli !== S.cliente || r !== S.resumo) return   // outro cliente/resumo passou na frente
    if (p && p.estado === 'dry-run' && !p.expirado) { texto = 'Plano pronto para aprovar'; acao = botaoProximo('Aprovar plano', 'aba', 'data-k="plano"') }
    else { texto = `${k.marcadas} anúncio(s) marcado(s) sem plano`; acao = botaoProximo('Gerar plano', 'plano-gerar') }
  } else texto = 'Nada pendente: marque anúncios em Elegíveis ou refaça a coleta na próxima rodada'
  $('proximoTexto').textContent = texto; $('proximoAcao').innerHTML = acao
  $('btnColetar').classList.toggle('btn-primario', !acao); sincOcupado($('proximoAcao'))
}

// ── seletor de cliente (reusa /api/clientes/busca) ──────────────────────────────────────────────────
let timer = null, timerFiltro = null, buscaSeq = 0
$('q').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(buscarCliente, 220) })
document.addEventListener('click', e => { if (!e.target.closest('.busca-wrap')) { $('resultados').hidden = true; $('resultados').innerHTML = '' } })
async function buscarCliente() {
  const q = $('q').value.trim(), box = $('resultados')
  if (q.length < 3) { box.hidden = true; box.innerHTML = ''; return }
  const id = ++buscaSeq
  try {
    const { resultados } = await api('/api/clientes/busca?q=' + enc(q))
    if (id !== buscaSeq) return
    box.hidden = false
    box.innerHTML = resultados.length ? resultados.map(c => `<button class="res-item" data-acao="abrir" data-c="${esc(c.cliente)}"><span><b>${esc(c.cliente)}</b><span class="sub">${esc([c.consultor, (c.canais || []).join(' · ')].filter(Boolean).join(' · '))}</span></span></button>`).join('') : '<div class="res-vazio">Nenhum cliente com esse nome ou CNPJ.</div>'
  } catch (e) { box.hidden = false; box.innerHTML = `<div class="res-vazio">${esc(e.message)}</div>` }
}

// ── navegação ───────────────────────────────────────────────────────────────────────────────────────
// trocar de cliente zera TUDO o que era do anterior (painéis, filtros, resumo, linhas abertas) e invalida respostas em voo (nav/tok)
const PAINEIS = ['chips', 'status', 'invariante', 'pendencias', 'kpis', 'faixaColeta', 'veredito', 'proximoAcao']
const limparTela = () => { for (const id of PAINEIS) $(id).innerHTML = ''; $('proximoTexto').textContent = ''; $('detRodadaN').textContent = ''; $('btnColetar').classList.remove('btn-primario'); S.resumo = null; S.f = filtrosPadrao(); S.planoId = ''; S.abertos.clear(); S.mais = {}; S.focoCusto = ''; clearTimeout(timerFiltro); S.tok++ }
async function abrir(cliente, aba, empurrar = true) {
  const nav = ++S.nav
  S.cliente = cliente; S.aba = ABAS.some(a => a[0] === aba) ? aba : 'elegiveis'; limparTela(); sincOcupado()
  $('resultados').hidden = true; $('q').value = ''
  if (empurrar) history.pushState({}, '', `/promocoes?cliente=${enc(cliente)}&aba=${S.aba}`)
  $('telaEscolha').hidden = true; $('telaCliente').hidden = false
  $('titulo').textContent = cliente; $('conteudo').innerHTML = skTabela
  $('kpis').setAttribute('aria-busy', 'true')   // os painéis ficam vazios (teste 29), só o conteúdo tem skeleton
  // false = um resumo mais novo do mesmo cliente passou na frente (ex.: refresh de fim de coleta): refaz até este abrir() ter S.resumo, senão a aba pintaria com resumo nulo
  try { for (let i = 0; !(await recarregarResumo()) && nav === S.nav && !S.resumo; i++) if (i >= 3) throw new Error('não consegui carregar o resumo do cliente: tente de novo') } catch (e) { if (nav === S.nav) { $('kpis').removeAttribute('aria-busy'); $('conteudo').innerHTML = erroBloco(e, `data-acao="abrir" data-c="${esc(cliente)}"`) } return }
  $('kpis').removeAttribute('aria-busy')
  if (nav !== S.nav) return
  await mostrarAba(S.aba, false)
}
// carteira: quem nunca coletou primeiro (prioridade), depois a coleta mais antiga
const ordemCarteira = (a, b) => (a.coleta ? 1 : 0) - (b.coleta ? 1 : 0) || String(a.coleta || '').localeCompare(String(b.coleta || '')) || a.cliente.localeCompare(b.cliente)
const linhaCarteira = c => `<button class="res-item" data-acao="abrir" data-c="${esc(c.cliente)}"><span><b>${esc(c.cliente)}</b>${c.nickname ? `<span class="sub">${esc(c.nickname)}</span>` : ''}</span><span class="lado">${c.coleta ? `coleta ${esc(brData(c.coleta))}` : '<span class="selo atencao">sem coleta</span>'}</span></button>`
async function escolher() {
  const nav = ++S.nav
  S.cliente = ''; limparTela(); $('titulo').textContent = ''; $('conteudo').innerHTML = ''; $('telaCliente').hidden = true; $('telaEscolha').hidden = false
  const box = $('chipsClientes'); box.innerHTML = '<div class="sk-tabela" aria-hidden="true"></div>'; box.setAttribute('aria-busy', 'true')
  try {
    const l = await api('/api/promocoes/clientes'); if (nav !== S.nav) return
    box.innerHTML = l.length ? [...l].sort(ordemCarteira).map(linhaCarteira).join('') : '<div class="vazio-box"><b>Nenhum cliente com conta Mercado Livre conectada.</b>Conecte pela tela de integrações. <a class="btn" href="/integracoes">Abrir Integrações</a></div>'
  } catch (e) { if (nav === S.nav) box.innerHTML = erroBloco(e, 'data-acao="escolher"') }
  if (nav === S.nav) box.removeAttribute('aria-busy')
}
window.addEventListener('popstate', () => iniciar())
function iniciar() {
  const p = new URLSearchParams(location.search), c = p.get('cliente')
  c ? abrir(c, p.get('aba') || 'elegiveis', false) : escolher()
}

// devolve true se pintou; false se a resposta ficou obsoleta (outro cliente ou outra chamada mais nova já valeu) — nunca pinta resumo de cliente que não está na tela
async function recarregarResumo() {
  const cli = S.cliente, seq = ++S.seqResumo, vale = () => cli === S.cliente && seq === S.seqResumo
  let r; try { r = await api('/api/promocoes/resumo?cliente=' + enc(cli)) } catch (e) { if (vale()) throw e; return false }
  if (!vale()) return false
  S.resumo = r
  const c = r.coleta, f = r.frescor || {}, ok = coletaConcluida(r), aviso = avisoColeta(r)
  // meta-linha: texto; só "imposto não configurado" vira badge de atenção e "execução LIGADA" badge de contorno
  const imp = impostoChip(r)
  $('chips').innerHTML = [`Piso de MC ${fmtPct(r.config.piso_mc)}`, `relâmpago ${fmtPct(r.config.piso_relampago)}`].map(t => `<span>${esc(t)}</span>`).join('')
    + (imp === 'imposto não configurado' ? `<span class="selo atencao">${esc(imp)}</span>` : `<span>${esc(imp)}</span>`)
    + (r.execucao.habilitada ? '<span class="chip laranja">execução LIGADA</span>' : '<span>execução DESLIGADA</span>')
  // coleta_ligada:false = a coleta da madrugada pula este cliente (interruptor em Cliente → Configurar, decisão de 08/10); "Coletar agora" continua valendo.
  // Uma só faixa .aviso acima da dobra (§5.8): com erro de coleta, a nota de "desligada" entra na mesma faixa
  const desligada = r.coleta_ligada === false ? `<b>Coleta desligada para este cliente</b> — a coleta da madrugada pula esta conta; "Reler o Mercado Livre" continua funcionando. <a href="/cliente?cliente=${enc(cli)}&amp;aba=configurar">Ligue em Configurar</a>.` : ''
  $('faixaColeta').innerHTML = aviso ? `<div class="aviso erro">${esc(aviso)}${desligada ? ' ' + desligada : ''}</div>` : desligada ? `<div class="aviso info">${desligada}</div>` : ''
  const velha = ok && !f.fresca, quando = [c?.concluida_em && brHora(c.concluida_em), f.idade_horas != null && `há ${Number(f.idade_horas).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`].filter(Boolean).join(' · ')
  $('status').innerHTML = !c ? '<span class="selo ruim">sem coleta</span><span class="mudo">rode "Reler o Mercado Livre" para começar</span>'
    : `<span class="selo ${!ok || velha ? 'ruim' : 'bom'}">coleta ${ok ? (velha ? 'VELHA' : 'fresca') : esc(String(c.estado).toUpperCase())}</span>${quando ? `<span>${esc(quando)}</span>` : ''}${velha ? '<span class="neg">refaça a coleta: não se analisa foto velha</span>' : ''}${semVendas(r) ? '<span class="neg">sem dados de vendas (série indisponível ou vazia)</span>' : `<span class="mudo">vendas até ${esc(brData(r.vendas.ate))}</span>`}<span class="progresso" id="progresso"></span>`
  const inv = r.invariante
  $('invariante').innerHTML = !inv ? '' : `<div class="pr-inv ${inv.ok ? 'ok' : 'ruim'}"><b>${inv.ok ? '✔ Rodada fechada' : '✖ Rodada NÃO está fechada'}</b>${inv.itens.map(i => `<span class="it ${i.encontrado === 0 ? 'ok' : 'ruim'}">${esc(i.encontrado)} ${esc(i.rotulo)}</span>`).join('')}${inv.coleta_fresca ? '' : `<span class="it ruim">coleta ${ok ? 'velha' : esc(c?.estado || 'ausente')}</span>`}<span class="mudo peq">${esc(textoReadback(inv, r.config.dias_vigia))}</span></div>`
  const k = r.kpis, kv = v => kpiVal(r, v), semV = semVendas(r), ruim = ok ? '' : 'ruim'
  const kp = (rot, v, det, cls = '') => `<div class="kpi ${cls}"><div class="rotulo">${esc(rot)}</div><div class="valor">${esc(v)}</div><div class="detalhe">${esc(det)}</div></div>`
  // 4 manchetes (oportunidade, risco, bloqueio, situação) e 3 compactas na 2ª linha (CSS: #telaCliente .kpi:nth-child(n+5))
  $('kpis').innerHTML = kp('≥ piso', kv(k.elegiveis_ge_piso), 'MC ≥ piso do anúncio', ruim || (ok && k.elegiveis_ge_piso ? 'bom' : ''))
    + kp('Descobertos', semV ? '—' : kv(k.descobertos), semV ? 'sem dados de vendas: vigia não avaliável' : `protegidos em ${r.config.dias_vigia} dias`, ruim || (semV || k.descobertos ? 'alerta' : ''))
    + kp('Sem custo', kv(k.sem_custo), `bloqueio · ${k.skus_sem_custo} SKU(s) sem custo cadastrado`, ruim || (k.sem_custo ? 'alerta' : ''))
    + kp('Participando', kv(k.participando), `${kv(k.participando_rebate)} com rebate`, ruim)
    + kp('Elegíveis a rebate', kv(k.elegiveis), ok ? 'anúncios com campanha elegível' : 'sem leitura confiável', ruim)
    + kp('Marcadas', k.marcadas, `${k.sugeridas} sugestão(ões) do analista aguardando` + (k.sugeridas_barradas ? ` · ${k.sugeridas_barradas} barrada(s) por recusa` : ''))
    + kp('Cobertura incerta', semV ? '—' : kv(k.cobertura_incerta ?? 0), semV ? 'sem dados de vendas: vigia não avaliável' : 'data só da campanha-mãe: confirmar no anúncio', ruim || (!semV && k.cobertura_incerta ? 'alerta' : ''))
  $('pendencias').innerHTML = r.pendencias.length ? `<div class="pr-pend"><details ${r.pendencias.some(p => ['NEEDS_EXTERNAL_DATA', 'ATENCAO', ...LIMITES_FALHA].includes(p.estado)) ? 'open' : ''}><summary>${r.pendencias.length} pendência(s) e limite(s) declarado(s) — nada aqui é inventado</summary><ul>${r.pendencias.map(p => `<li>${rotPend(p.estado)} ${esc(p.texto)}</li>`).join('')}</ul></details></div>` : ''
  $('detRodadaN').textContent = r.pendencias.length ? String(r.pendencias.length) : ''
  $('detRodada').open = !!(inv && !inv.ok)   // abre sozinho só quando a rodada não fechou
  $('veredito').innerHTML = textoVeredito(r)
  pintarProximo(r).catch(() => {})   // best-effort: pode consultar o plano atual; nunca derruba o resumo
  return true
}
$('abas').innerHTML = ABAS.map(([k, r]) => `<button class="f-chip" aria-pressed="false" data-acao="aba" data-k="${k}">${esc(r)}</button>`).join('')
async function mostrarAba(k, empurrar = true) {
  S.aba = k
  document.querySelectorAll('#abas .f-chip').forEach(b => { b.classList.toggle('on', b.dataset.k === k); b.setAttribute('aria-pressed', b.dataset.k === k ? 'true' : 'false') })
  if (empurrar) history.replaceState({}, '', `/promocoes?cliente=${enc(S.cliente)}&aba=${k}`)
  $('conteudo').innerHTML = skTabela; $('conteudo').setAttribute('aria-busy', 'true')
  try { await ABA_FN[k]() }
  catch (e) { if (e !== OBSOLETA) $('conteudo').innerHTML = erroBloco(e, `data-acao="aba" data-k="${esc(k)}"`) }
  if (S.aba === k) $('conteudo').removeAttribute('aria-busy')
}
const ABA_FN = { elegiveis: abaElegiveis, participando: abaParticipando, relampago: abaRelampago, regras: abaRegras, custos: abaCustos, interrogatorio: abaInterrogatorio, plano: abaPlano, auditoria: abaAuditoria }
const C = () => enc(S.cliente)

// ── jobs ────────────────────────────────────────────────────────────────────────────────────────────
// acompanha o job DO cliente que o iniciou (cli), mesmo que a tela já esteja em outro; só escreve o progresso se a tela ainda for a dele
async function acompanhar(jobId, rotulo, cli) {
  S.jobs[cli] = rotulo; sincOcupado()
  try {
    for (;;) {
      const j = await api(`/api/promocoes/job/${enc(jobId)}?cliente=${enc(cli)}`)
      const el = cli === S.cliente && $('progresso'); if (el) el.textContent = `${rotulo}: ${j.progresso?.fase || ''} ${j.progresso?.feitos ?? 0}/${j.progresso?.total ?? 0}`
      if (j.estado !== 'rodando') return j
      await sleep(1200)
    }
  } finally { delete S.jobs[cli]; sincOcupado() }
}
async function coletar() {
  if (!podeGravar()) return
  const cli = S.cliente; let iniciou = false
  try {
    const { job } = await api('/api/promocoes/coletar', { cliente: cli, vendas: $('chkVendas').checked, por: quem() }); iniciou = true
    toast(`Coleta de ${cli} iniciada (só leitura). Leva alguns minutos.`)
    const j = await acompanhar(job, 'coletando', cli)
    if (j.estado === 'erro') throw new Error(j.erro)
    const d = desfechoColeta(cli, j.resultado); toast(d.msg, d.ruim)
  } catch (e) { toast(`${cli}: ${e.message}`, true) }
  // coleta que terminou (ou falhou) muda o estado mostrado: recarrega — mas só se a tela ainda for deste cliente.
  // Aba com formulário em edição (Custos/Regras/Interrogatório) NÃO é repintada: só status/KPIs se atualizam, senão some o que o dono estava digitando.
  if (iniciou && cli === S.cliente) { try { await recarregarResumo(); if (!ABAS_FORM.has(S.aba)) await mostrarAba(S.aba, false) } catch (e) { falha(e) } }
}

// ── aba Elegíveis ───────────────────────────────────────────────────────────────────────────────────
const SITUACOES = [['', 'Situação: todas'],['marcada', 'Marcadas (sua ou aprovada)'], ['sugerida', 'Sugeridas pelo analista'], ['sem_marca', 'Sem marca'], ['abaixo_piso', 'Abaixo do piso'], ['sem_custo', 'Sem custo'], ['participando', 'Participando']]
const qsFiltros = () => { const f = S.f; return `cliente=${C()}&q=${enc(f.q)}&curva=${enc(f.curva)}&situacao=${enc(f.situacao)}&campanha=${enc(f.campanha)}&so_piso=${f.so_piso ? 1 : 0}&sem_rebate=${f.sem_rebate ? 1 : 0}` }
async function abaElegiveis() {
  const t = nova('elegiveis')
  const d = await carregar(t, `/api/promocoes/elegiveis?${qsFiltros()}&pagina=${S.f.pagina}&limite=50`)
  const f = S.f, alvo = paginaAlvo(d)
  if (alvo && alvo !== f.pagina) { f.pagina = alvo; return abaElegiveis() }   // página fora do intervalo (ex.: aprovou o último da página): volta à última válida
  // A barra de filtros é pintada UMA vez por abertura da aba: só o corpo (tabela/paginador) e os contadores mudam a cada resposta.
  // Repintar o <input> perdia o que se digitava durante o fetch e derrubava o foco do teclado.
  if (!$('fQ')) {
    pintar`
    <div class="pr-filtros">
      <input type="search" id="fQ" placeholder="Buscar SKU, MLB ou título" value="${esc(f.q)}" aria-label="Buscar">
      <select id="fCurva" aria-label="Curva">${[['', 'Curva: todas'], ['A', 'Curva A'], ['B', 'Curva B'], ['C', 'Curva C']].map(([v, r]) => `<option value="${v}" ${f.curva === v ? 'selected' : ''}>${r}</option>`).join('')}</select>
      <select id="fSit" aria-label="Situação">${SITUACOES.map(([v, r]) => `<option value="${v}" ${f.situacao === v ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>
      <details class="mais-filtros"><summary>Mais filtros<span id="fMaisN"></span></summary><div>
        <label><input type="checkbox" id="fPiso" ${f.so_piso ? 'checked' : ''}> só ≥ piso</label>
        <label><input type="checkbox" id="fSem" ${f.sem_rebate ? 'checked' : ''}> incluir campanhas sem rebate (só leitura)</label>
      </div></details>
      <button class="btn btn-fantasma" id="fLimpar" type="button">Limpar</button>
    </div>
    <div class="pr-filtros">
      <button class="btn" data-acao="analista-aplicar">Aplicar analista</button>
      <button class="btn btn-fantasma" data-acao="analista-previa">Rodar analista (prévia)</button>
      <button class="btn btn-fantasma" id="btnAprovarTodas" data-acao="aprovar-todas">Aprovar todas as sugestões</button>
      <a class="btn btn-fantasma" id="elCsv" href="#">Exportar CSV</a>
    </div>
    <div id="confTodas"></div>
    <div class="n-acoes" id="elTotal"></div>
    <div id="elCorpo"></div>
    ${comoFunciona('Como funciona', '<ul><li><b>Analista</b> = sugestão recalculável a cada rodada. <b>Você</b> = sua marcação (o analista nunca mexe nela).</li><li>Marcar não executa: o anúncio entra no plano só depois de aprovado.</li><li>Campanha atual e melhor elegível de cada anúncio estão em "Detalhes".</li></ul>')}`
    const refiltrar = () => { S.f.pagina = 1; abaElegiveis().catch(falha) }
    $('fLimpar').onclick = () => { S.f = filtrosPadrao(); $('fQ').value = ''; $('fCurva').value = ''; $('fSit').value = ''; $('fPiso').checked = false; $('fSem').checked = false; refiltrar() }
    $('fQ').addEventListener('input', e => { clearTimeout(timerFiltro); timerFiltro = setTimeout(() => { S.f.q = e.target.value; refiltrar() }, 350) })
    $('fCurva').onchange = e => { S.f.curva = e.target.value; refiltrar() }
    $('fSit').onchange = e => { S.f.situacao = e.target.value; refiltrar() }
    $('fPiso').onchange = e => { S.f.so_piso = e.target.checked; refiltrar() }
    $('fSem').onchange = e => { S.f.sem_rebate = e.target.checked; refiltrar() }
  }
  SITUACOES.forEach(([v, r], i) => { $('fSit').options[i].textContent = r + (v && d.totais[v] ? ` (${d.totais[v]})` : '') })
  $('elCsv').href = `/api/promocoes/exportar.csv?${qsFiltros()}&tipo=elegiveis`
  const nMais = [f.so_piso, f.sem_rebate].filter(Boolean).length
  $('fMaisN').textContent = nMais ? ` (${nMais})` : ''
  $('elTotal').textContent = `${d.total} anúncio(s)`
  const paginas = Math.max(1, Math.ceil(d.total / d.limite))
  const pag = d.total ? `<div class="pr-pag"><button class="btn-mini" data-acao="pag" data-foco="ant" data-p="${d.pagina - 1}" ${d.pagina <= 1 ? 'disabled' : ''}>Anterior</button>página ${d.pagina} de ${paginas}<button class="btn-mini" data-acao="pag" data-foco="prox" data-p="${d.pagina + 1}" ${d.pagina >= paginas ? 'disabled' : ''}>Próxima</button></div>` : ''
  // 6 colunas + ação (spec 5.7): campanha atual e melhor elegível ficam na linha de detalhe
  pintarEm($('elCorpo'), (d.itens.length ? `<div class="tabela-wrap"><table class="t"><thead><tr><th>Curva</th><th>Anúncio</th><th class="n">Fat. 30d</th><th class="n">MC</th><th>Analista</th><th>Você</th><th></th></tr></thead><tbody>${d.itens.map(linha).join('')}</tbody></table></div>` : `<div class="vazio-box">${esc(vazioElegiveis(S.resumo, d))}</div>`) + pag)
}
function linha(l) {
  const sug = l.sugerida[0], meus = l.marcadas.filter(m => m.marcado), recus = l.marcadas.filter(m => !m.marcado)
  const aberto = S.abertos.has(l.item_id)   // "Detalhes" aberto sobrevive ao repaint (S.abertos), com o foco no mesmo botão
  const mc = l.melhor?.mcPct
  // origem do custo (de onde a MC tira o custo): % da conta, ou o vínculo do anúncio (manual / SKU / SKU normalizado / herdado)
  const o = l.custo.origem, origem = l.custo.modo === 'percentual' ? '<div class="mudo peq">custo: % da conta</div>'
    : o ? `<div class="mudo peq" title="${esc(TIT_ORIGEM[o] || o)}">custo: ${esc(ROT_ORIGEM[o] || o)}${o !== 'sku' && l.custo.sku_custo ? ' · ' + esc(l.custo.sku_custo) : ''}</div>` : ''
  const mcCel = l.custo.ok ? (mc == null ? '<span class="mudo">—</span>' : `<span class="${mc < 0 ? 'neg' : mc >= l.piso ? 'pos' : 'mudo'}">${fmtPct(mc)}</span><div class="mudo peq">piso ${fmtPct(l.piso)}</div>`) + origem
    : `<span class="selo atencao">${esc(l.custo.estado)}</span><div class="mudo peq">falta: ${esc(l.custo.faltando.join(', '))}</div>`
      + (l.custo.faltando.includes('custo') ? `<button class="btn-mini" type="button" data-acao="vincular-custo" data-item="${esc(l.item_id)}">Vincular custo</button>` : '')
  const badges = [l.avisoP && '<span class="tagzinha impacto" title="' + esc(l.avisoP) + '">já em outra campanha</span>', l.under_review && '<span class="selo ruim" title="under_review">em revisão pelo ML</span>', l.protegido && '<span class="tagzinha fato">protegido</span>',
    l.regraSku && `<span class="tagzinha">regra: ${esc(l.regraSku)}</span>`, !l.sku && '<span class="tagzinha">sem SKU</span>'].filter(Boolean).join('')
  const sugCel = sug ? `<span title="${esc(sug.motivo)}">${esc(sug.regra)}</span><div class="mudo peq">${esc(nomeDe(l, sug.pid))}${sug.aprovado ? ' · <b class="pos">aprovada</b>' : ''}${sug.gravada ? '' : ' · prévia (não gravada)'}</div>`
    : `<span class="mudo peq" title="${esc(l.motivoSemMarca)}">${esc((l.motivoSemMarca || '—').slice(0, 70))}</span>`
  const meuCel = meus.length ? meus.map(m => `<span class="pos">marcou</span><div class="mudo peq">${esc(nomeDe(l, m.pid))} · ${esc(m.por)}</div>`).join('') : recus.length ? '<span class="mudo">recusou</span>' : '<span class="mudo">—</span>'
  return `<tr class="${l.situacao === 'marcada' ? 'lin-marcada' : ''}" data-item="${esc(l.item_id)}">
    <td>${curvaTag(S.resumo, l.curva)}</td>
    <td><b>${l.permalink ? `<a href="${esc(l.permalink)}" target="_blank" rel="noopener noreferrer">${esc(l.titulo || l.item_id)}</a>` : esc(l.titulo || l.item_id)}</b><div class="mudo peq">${esc(l.sku || 'sem SKU')} · ${esc(l.item_id)}</div><div class="pr-badges">${badges}</div></td>
    <td class="n">${fatTxt(S.resumo, l.fat30)}</td>
    <td class="n">${mcCel}</td><td>${sugCel}</td><td>${meuCel}</td>
    <td><button class="btn-mini" data-acao="det" data-item="${esc(l.item_id)}" aria-expanded="${aberto}">${aberto ? 'Fechar' : 'Detalhes'}</button></td></tr>
    <tr class="det" ${aberto ? '' : 'hidden'}><td colspan="7">${detalhe(l)}</td></tr>`
}
const nomeDe = (l, pid) => l.candidatos.find(c => c.pid === pid)?.nome || pid
function detalhe(l) {
  const marcado = pid => l.marcadas.find(m => m.pid === pid)
  const linhas = l.candidatos.map(c => {
    const m = marcado(c.pid), sug = l.sugerida.find(s => s.pid === c.pid)
    return `<tr><td>${esc(c.nome)}${c.trilha === 'painel' ? ' <span class="tagzinha">relâmpago · só painel</span>' : ''}${c.semRebate ? ' <span class="tagzinha">sem rebate</span>' : ''}${sug ? ' <span class="tagzinha">sugerida</span>' : ''}<div class="mudo peq">${esc(c.pid)} · ${esc(c.tipo)}</div></td>
      <td class="n">${fmtR(c.preco)}</td><td class="n">${fmtPct(c.meliPct)}</td><td class="n">${fmtR(c.mc)}</td><td class="n">${c.mcPct == null ? '—' : `<span class="${c.mcPct < 0 ? 'neg' : c.passaPiso ? 'pos' : 'mudo'}">${fmtPct(c.mcPct)}</span>`}</td><td>${c.passaPiso ? 'sim' : '—'}</td><td>${esc(brData(c.fim))}</td>
      <td><div class="pr-acoes"><button class="btn-mini ${m?.marcado ? 'sel' : ''}" data-acao="marcar" data-item="${esc(l.item_id)}" data-pid="${esc(c.pid)}" data-v="1">${m?.marcado ? 'Marcada' : 'Marcar'}</button>
        <button class="btn-mini ${m && !m.marcado ? 'sel' : ''}" data-acao="marcar" data-item="${esc(l.item_id)}" data-pid="${esc(c.pid)}" data-v="0">Recusar</button>
        ${m ? `<button class="btn-mini" data-acao="marcar" data-item="${esc(l.item_id)}" data-pid="${esc(c.pid)}" data-v="limpar">Limpar</button>` : ''}
        ${sug && !sug.aprovado && sug.gravada && !(m && !m.marcado) ? `<button class="btn-mini ok" data-acao="aprovar" data-item="${esc(l.item_id)}" data-pid="${esc(c.pid)}" data-preco="${esc(sug.preco ?? '')}" data-mc="${esc(sug.mc_pct ?? '')}">Aprovar 🤖 ${fmtR(sug.preco)} · MC ${fmtPct(sug.mc_pct)}</button>` : ''}</div></td></tr>`
  }).join('')
  const atual = l.atual ? `${esc(l.atual.nome)} · ${fmtR(l.atual.preco)} · MC ${fmtPct(l.atual.mcPct)}` : l.participa.length ? l.participa.map(o => `${esc(o.nome)} (${esc(o.tipo)} · ${esc(o.status)} · ${fmtR(o.preco)})`).join(' · ') : 'sem campanha ativa'
  const melhor = l.melhor ? `${esc(l.melhor.nome)} · ${fmtR(l.melhor.preco)} · rebate ${fmtPct(l.melhor.meliPct)}${l.melhor.fim ? ' · até ' + esc(brData(l.melhor.fim)) : ''}` : '—'
  return `<div class="pr-obs"><b>Campanha atual:</b> ${atual}<br><b>Melhor elegível:</b> ${melhor}</div>
    <div class="pr-obs">${l.sugerida[0] ? esc(l.sugerida[0].obs) : esc(l.motivoSemMarca)}</div>
    ${l.avisoP && !(l.sugerida[0]?.obs || '').includes(l.avisoP) ? `<div class="pr-obs"><b>${esc(l.avisoP)}</b></div>` : ''}${l.avisos.map(a => `<div class="pr-obs mudo">${esc(a)}</div>`).join('')}
    <div class="tabela-wrap"><table class="pr-det-t"><thead><tr><th>Campanha</th><th class="n">Preço</th><th class="n">Rebate</th><th class="n">MC R$</th><th class="n">MC %</th><th>≥ piso</th><th>Até</th><th>Decisão</th></tr></thead><tbody>${linhas}</tbody></table></div>
    <label class="pr-chk"><input type="checkbox" class="chkOrdem"> ordem direta (permite MC negativa no plano; vale para a próxima marcação)</label>
    <div class="pr-acoes mt-2"><button class="btn-mini" data-acao="protegido" data-item="${esc(l.item_id)}" data-v="${l.protegido ? 0 : 1}">${l.protegido ? 'Tirar de "protegido"' : 'Marcar como protegido (vigiar cobertura)'}</button></div>`
}

// ── aba Participando e cobertura ────────────────────────────────────────────────────────────────────
async function abaParticipando(dias) {
  const t = nova('participando'), dv = dias || S.resumo?.config?.dias_vigia
  const d = await carregar(t, `/api/promocoes/participando?cliente=${C()}${dv ? '&dias=' + enc(dv) : ''}`)
  const cob = d.cobertura, datas = a => `<b>${esc(brData(a.cobreAte))}</b><div class="mudo peq">c/ rebate ${esc(brData(a.cobreAteRebate))} · s/ rebate ${esc(brData(a.cobreAteSemRebate))}</div>${a.suspeita ? '<div class="neg peq">data &gt; 60 dias: suspeita — confira em /items/{id}/prices</div>' : ''}`
  const tid = (a) => `<b>${esc(a.titulo || a.item_id)}</b><div class="mudo peq">${esc(a.sku || 'sem SKU')} · ${esc(a.item_id)}</div>`
  // cobertura INCERTA (data só da campanha-mãe a >60 dias) não é descoberto: selo e texto próprios, data sem negrito de fato, e fora da conta/tabela dos descobertos
  const certos = cob.alertas.filter(a => !ehIncerta(a)), incertos = cob.alertas.filter(ehIncerta)
  const linhaAlerta = a => `<tr><td>${curvaTag(S.resumo, a.curva)}</td><td>${tid(a)}</td><td class="n">${fatTxt(S.resumo, a.fat30)}</td><td>${ehIncerta(a) ? `<span class="selo atencao">cobertura incerta</span><div class="mudo peq">data só da campanha-mãe: ${esc(brData(a.cobreAte))}</div>` : a.cobreAte ? datas(a) : '<span class="neg">DESCOBERTO</span>' + (a.voltaEm ? `<div class="mudo peq">volta em ${esc(brData(a.voltaEm))}</div>` : '')}</td>
      <td>${ehIncerta(a) ? `<span class="selo atencao">CONFIRMAR COBERTURA</span><div class="mudo peq">${esc(a.manualNota)}</div>` : a.saida === 'MARCAR' ? `<span class="selo ${a.marcaCobre ? 'bom' : 'atencao'}">MARCAR</span> ${esc(a.melhorCobre?.nome || '')} (MC ${fmtPct(a.melhorCobre?.mcPct)}, até ${esc(brData(a.melhorCobre?.fim))})<div class="mudo peq">${a.marcaCobre ? 'já há marca cobrindo — falta aprovar/executar' : 'ainda sem marca: veja a aba Elegíveis'}</div>` : `<span class="selo atencao">SUGERIR MANUAL</span><div class="mudo peq">${esc(a.manualNota)}</div>`}</td></tr>`
  const tabAlertas = l => `<div class="tabela-wrap"><table class="t"><thead><tr><th>Curva</th><th>Anúncio</th><th class="n">Fat. 30d</th><th>Cobre até</th><th>Saída</th></tr></thead><tbody>${l.map(linhaAlerta).join('')}</tbody></table></div>`
  // a coleta grava em resumo.derrubadas as CONTAGENS {derrubadas, vencidas, sem_prazo, saiu_da_coleta, desde} e a lista item a item (lista); sem lista (coleta antiga) mostra a contagem
  const dr = d.derrubadas, lista = Array.isArray(dr?.lista) ? dr.lista : [], part = pag50(d.participando, 'participando')
  const secDerrubadas = dr?.derrubadas > 0 ? `<div class="secao"><h3>Derrubadas antes do prazo (${esc(dr.derrubadas)}) · desde ${esc(brData(dr.desde))}</h3><div class="sub">Participações started/pending com fim futuro que sumiram entre as duas últimas coletas — o sistema nunca reentra sozinho: confira o painel do ML.${dr.vencidas ? ` ${esc(dr.vencidas)} já venceram (normal).` : ''}${dr.sem_prazo ? ` ${esc(dr.sem_prazo)} sem prazo próprio.` : ''}${dr.saiu_da_coleta ? ` ${esc(dr.saiu_da_coleta)} anúncio(s) ficaram fora da coleta (não contam como derrubada).` : ''}</div>`
    + (lista.length ? `<div class="tabela-wrap"><table class="t"><thead><tr><th>Anúncio</th><th>Campanha</th><th>Fim previsto</th></tr></thead><tbody>${lista.map(x => `<tr><td>${esc(x.item_id)}</td><td>${esc(x.pid)}</td><td>${esc(brData(x.fim))}</td></tr>`).join('')}</tbody></table></div>${lista.length < dr.derrubadas ? `<div class="mudo peq">mostrando ${esc(lista.length)} de ${esc(dr.derrubadas)}</div>` : ''}`
      : `<div class="vazio-box">${esc(dr.derrubadas)} participação(ões) sumiram antes do prazo; a lista item a item não foi gravada nesta coleta — veja a Auditoria (evento "coleta").</div>`) + '</div>' : ''
  pintar`
    <div class="secao"><h3>Protegidos que ficam descobertos</h3><div class="sub">Protegido = curva A/B ou marcado por você. Janela de <select id="selDias" aria-label="Janela do vigia, em dias">${opcoesDias(d.dias).map(n => `<option value="${n}" ${n === Number(d.dias) ? 'selected' : ''}>${n}</option>`).join('')}</select> dias (rode 7 E 14 em toda rodada). Cobertura = promoções started+pending, sem lacuna; PRICE_MATCHING/cupom/Pix não contam. <a href="/api/promocoes/exportar.csv?cliente=${C()}&tipo=descobertos&dias=${enc(d.dias)}">CSV</a></div>
    ${certos.length ? tabAlertas(certos) : `<div class="vazio-box">${esc(msgSemDescobertos(S.resumo, cob.excecoes.length))}</div>`}
    ${incertos.length ? `<h3 class="mt-4">Cobertura incerta — confirmar (${incertos.length})</h3><div class="sub">A data de cobertura vem só da campanha-mãe, a mais de 60 dias: a participação real pode acabar antes. Não é descoberto nem coberto — confirme no anúncio (preços); não crie promoção manual.</div>${tabAlertas(incertos)}` : ''}
    ${cob.excecoes.length ? `<details class="evid" open><summary>${cob.excecoes.length} exceção(ões) fora da conta de descobertos (declaradas)</summary><div class="box">${cob.excecoes.map(x => `<div><b>${esc(x.sku || x.item_id)}</b> ${esc(x.item_id)} — ${esc(x.motivo)}</div>`).join('')}</div></details>` : ''}</div>
    <div class="secao"><h3>Rebate pior no ar</h3><div class="sub">Anúncio coberto pela campanha de MENOR rebate quando há uma melhor pelo mesmo preço (ou elegível melhor). O sistema <b>nunca</b> sai de campanha: a decisão é sua, 1 a 1.</div>
    ${d.rebate_pior.length ? `<div class="tabela-wrap"><table class="t"><thead><tr><th>Anúncio</th><th>Tipo</th><th>No ar</th><th>Melhor</th><th class="n">Ganho/venda</th><th class="n">Ganho/mês</th><th>Leitura</th></tr></thead><tbody>${d.rebate_pior.map(a => `<tr><td>${tid(a)}</td><td>${a.tipo === 'empate' ? 'empate de preço' : 'elegível melhor'}</td><td>${esc(a.atual.nome)}<div class="mudo peq">${fmtPct(a.atual.meliPct)} · ${fmtR(a.atual.preco)}</div></td><td>${esc(a.melhor.nome)}<div class="mudo peq">${fmtPct(a.melhor.meliPct)} · até ${esc(brData(a.melhor.fim))}</div></td><td class="n">${fmtR(a.ganhoVenda)}</td><td class="n">${fmtR(a.ganhoMes)}</td><td>${esc(a.recomendacao)}</td></tr>`).join('')}</tbody></table></div>` : `<div class="vazio-box">${esc(vazioFato(S.resumo, 'que não há rebate pior no ar', 'Nenhum caso de rebate pior no ar.'))}</div>`}</div>
    ${secDerrubadas}
    <div class="secao"><h3>Participando e cobertura (${d.participando.length})</h3><div class="sub">Todo anúncio com oferta started/pending (qualquer tipo de campanha). O preço vigente é o MENOR entre as started que mexem no preço.</div>
    ${d.participando.length ? `<div class="tabela-wrap"><table class="t"><thead><tr><th>Curva</th><th>Anúncio</th><th class="n">Fat. 30d</th><th>Vigente</th><th>Cobre até</th><th>Ofertas ativas</th></tr></thead><tbody>${part.it.map(a => `<tr><td>${curvaTag(S.resumo, a.curva)}</td><td>${tid(a)}${a.protegido ? ' <span class="tagzinha fato">protegido</span>' : ''}</td><td class="n">${fatTxt(S.resumo, a.fat30)}</td><td>${a.vigente ? `${fmtR(a.vigente.preco)}<div class="mudo peq">${esc(a.vigente.nome)}</div>` : '—'}</td><td>${a.cobreAte ? datas(a) : '<span class="neg">DESCOBERTO</span>'}</td><td>${a.ofertas.map(o => `${esc(o.nome)} <span class="mudo peq">${esc(o.tipo)} · ${esc(o.status)}${o.rebate ? ' · rebate ' + fmtPct(o.meliPct) : ''} · até ${esc(brData(o.fim))}</span>`).join('<br>')}</td></tr>`).join('')}</tbody></table></div>${part.rod}` : `<div class="vazio-box">${esc(vazioFato(S.resumo, 'que nenhum anúncio participa de campanha', 'Nenhum anúncio com participação ativa nesta coleta.'))}</div>`}</div>`
  $('selDias').onchange = e => abaParticipando(e.target.value).catch(falha)   // sem skeleton: repintar o select tiraria o foco dele
}

// ── aba Relâmpago ───────────────────────────────────────────────────────────────────────────────────
async function abaRelampago() {
  const t = nova('relampago')
  const d = await carregar(t, `/api/promocoes/relampago?cliente=${C()}`)
  $('conteudo').innerHTML = `<div class="aviso-faixa">${d.avisos.map(esc).join('<br>')}${d.lightning_ignoradas ? `<br>${esc(d.lightning_ignoradas)} candidata(s) LIGHTNING ignorada(s) — nunca recomendadas.` : ''}</div>`
    + (d.itens.length ? `<div class="tabela-wrap"><table class="t"><thead><tr><th>Curva</th><th>Anúncio</th><th class="n">Fat. 30d</th><th>Slot(s) candidatos</th><th>Já no ar</th><th>Analista</th><th>Você</th></tr></thead><tbody>${d.itens.map(a => `<tr><td>${curvaTag(S.resumo, a.curva)}</td><td><b>${esc(a.titulo || a.item_id)}</b><div class="mudo peq">${esc(a.sku || 'sem SKU')} · ${esc(a.item_id)}</div></td><td class="n">${fatTxt(S.resumo, a.fat30)}</td>
      <td>${a.candidatos.map(c => `${esc(c.nome)}<div class="mudo peq">${fmtR(c.preco)} · rebate ${fmtPct(c.meliPct)} · MC ${a.custo.ok ? fmtPct(c.mcPct) : esc(a.custo.estado)} · piso ${fmtPct(a.piso)}${c.passaPiso ? ' · ≥ piso' : ''}</div>`).join('') || '—'}</td>
      <td>${a.vivas.map(v => `${esc(v.nome)} <span class="mudo peq">${esc(v.status)} · ${fmtR(v.preco)}</span>`).join('<br>') || '—'}</td>
      <td>${[a.sugerida ? esc(a.sugerida.motivo) : `<span class="mudo peq">${esc(a.motivoSemMarca || '—')}</span>`, ...a.marcadas.filter(m => !ehMarcaHumana(m)).map(m => `<span class="mudo peq">🤖 gravada na rodada de ${esc(m.por)}</span>`)].join('<br>')}</td><td>${a.marcadas.filter(ehMarcaHumana).map(m => `👤 ${esc(m.por)}`).join('<br>') || '—'}</td></tr>`).join('')}</tbody></table></div>`
      : `<div class="vazio-box">${coletaConcluida(S.resumo) ? 'Nenhum relâmpago SMART (com rebate) nesta coleta.' : `Sem leitura confiável (coleta ${esc(S.resumo?.coleta?.estado || 'ausente')}): refaça a coleta antes de concluir que não há relâmpago.`}</div>`)
}

// ── aba Regras por SKU ──────────────────────────────────────────────────────────────────────────────
async function abaRegras() {
  const t = nova('regras')
  const regras = await carregar(t, `/api/promocoes/regras-sku?cliente=${C()}`)
  const pg = pag50(regras, 'regras')
  pintar`<div class="secao"><h3>Nova regra</h3><div class="sub">Exceções de piso definidas por você. Quem não está aqui segue o piso padrão.</div>
    <form class="pr-form" id="formRegra"><label class="v">MLB (opcional)<input name="mlb" placeholder="MLB1234567890" maxlength="20"></label><label class="v">SKU (opcional)<input name="sku" maxlength="80"></label>
      <label class="v">Status<select name="tipo"><option value="Livre">Livre</option><option value="piso">N% (piso próprio)</option><option value="Revisar toda rodada">Revisar toda rodada</option></select></label>
      <label class="v">N (%)<input name="n" type="number" min="0" max="99" step="0.5" placeholder="só p/ piso próprio"></label>
      <label class="v col2">Nota<input name="nota" maxlength="500" placeholder="por que (ex.: fora de linha)"></label><div><button class="btn" id="btnSalvarRegra" type="submit">Salvar regra</button></div></form></div>
    <div class="secao"><h3>Regras ativas (${regras.length})</h3>
    ${regras.length ? `<div class="tabela-wrap"><table class="t"><thead><tr><th>MLB</th><th>SKU</th><th>Status</th><th>Nota</th><th>Por / quando</th><th></th></tr></thead><tbody>${pg.it.map(r => `<tr><td>${esc(r.mlb || '—')}</td><td>${esc(r.sku || '—')}</td><td><b>${esc(r.status)}</b></td><td>${esc(r.nota)}</td><td class="mudo peq">${esc(r.por)} · ${esc(brData(r.em))}</td><td><button class="btn-mini perigo" data-acao="rm-regra" data-mlb="${esc(r.mlb)}" data-sku="${esc(r.sku)}">Remover</button></td></tr>`).join('')}</tbody></table></div>${pg.rod}` : '<div class="vazio-box"><b>Nenhuma regra por SKU neste cliente.</b>Todos seguem o piso padrão; cadastre uma exceção no formulário acima.</div>'}</div>
    ${comoFunciona('Como funciona', '<ul><li><b>Livre</b> = fora de linha / queimar estoque: entra em QUALQUER campanha, MC não decide; entre as opções ganha a de melhor rebate.</li><li><b>N%</b> (ex.: 5%) = piso próprio de N% para o anúncio.</li><li><b>Revisar toda rodada</b> = o analista não decide: lembra você em toda rodada.</li><li>Regras governam ENTRADAS novas: nunca mexem em participação ativa.</li></ul>')}`
  $('formRegra').onsubmit = async ev => {
    ev.preventDefault(); if (!podeGravar()) return
    const f = new FormData(ev.target), tipo = f.get('tipo')
    const status = tipo === 'piso' ? `${String(f.get('n') || '').trim()}%` : tipo
    try { await api('/api/promocoes/regras-sku', { cliente: S.cliente, mlb: f.get('mlb'), sku: f.get('sku'), status, nota: f.get('nota'), por: quem() }); toast('Regra salva'); await aposGravar(abaRegras) } catch (e) { falha(e) }
  }
}

// ── aba Custos ──────────────────────────────────────────────────────────────────────────────────────
async function abaCustos() {
  const t = nova('custos'), foco = S.focoCusto
  S.focoCusto = ''                                     // o atalho de Elegíveis vale só para esta pintura: recarregar depois de vincular volta à ordem por faturamento
  // o vínculo custo ↔ anúncio vem de outra rota: se ela falhar, o resto da aba (importar, configuração) continua de pé
  const [d, v] = await Promise.all([carregar(t, `/api/promocoes/custos?cliente=${C()}`), carregar(t, `/api/custos/vinculos?cliente=${C()}`).catch(e => { if (e === OBSOLETA) throw e; return { erro: e } })])
  const c = d.config, p = d.percentuais
  const semC = pag50(d.sem_custo, 'sem_custo'), semSku = pag50(d.skus_sem_custo, 'skus_sem_custo')
  const custosLista = Array.isArray(d.skus_efetivos) ? d.skus_efetivos : d.skus_efetivos?.itens || d.skus || []
  const vinc = v.erro ? `<div class="secao"><h3>Custo ↔ anúncio</h3>${erroBloco(v.erro, 'data-acao="aba" data-k="custos"')}</div>` : secaoVinculos(v, { r: S.resumo, foco, mais: S.mais, custos: custosLista })
  pintar`${faixaPendCustos(d.custos_pendencias, S.cliente)}
    ${vinc}
    <div class="secao"><h3>Importar custos por SKU</h3><div class="sub">Cole uma linha por SKU: <code class="pr">SKU;custo</code> (aceita ; vírgula ou tab, e 12,50 ou 12.50). Reimportar atualiza.</div>
    <form class="pr-form" id="formCustos"><label class="v col2">Texto<textarea name="texto" placeholder="SKU-001;12,50&#10;SKU-002;8,90"></textarea></label><label class="v">Fonte<input name="fonte" maxlength="80" placeholder="ex.: planilha do cliente"></label><div><button class="btn" id="btnImportar" type="submit">Importar custos</button></div></form><div id="resImport"></div></div>
    <div class="secao"><h3>Configuração do cliente</h3><div class="sub">A execução ao vivo NÃO se liga por aqui — veja docs/promocoes-por-cliente.md.</div>
    <form class="pr-form" id="formConfig">${[['piso_mc', 'Piso de MC (%)', c.piso_mc, 'any'], ['piso_relampago', 'Piso do relâmpago (%)', c.piso_relampago, 'any'], ['imposto_pct', 'Imposto (%)', c.imposto_pct ?? '', 'any'], ['dias_vigia', 'Dias do vigia', c.dias_vigia, 1], ['janela_cobertura_dias', 'Janela de cobertura (dias)', c.janela_cobertura_dias, 1], ['execucao_max_itens', 'Máx. anúncios por execução', c.execucao_max_itens, 1]].map(([k, r, v, passo]) => `<label class="v">${esc(r)}<input name="${k}" type="number" step="${passo}" value="${esc(v)}"></label>`).join('')}
      <label class="v">Hedge de cobertura<select name="hedge_cobertura"><option value="1" ${c.hedge_cobertura ? 'selected' : ''}>ligado</option><option value="0" ${c.hedge_cobertura ? '' : 'selected'}>desligado</option></select></label><div><button class="btn" id="btnSalvarConfig" type="submit">Salvar configuração</button></div></form></div>
    <div class="secao"><h3>Elegíveis a rebate sem custo (${d.sem_custo.length})</h3><div class="sub">SKUs com campanha de rebate elegível e sem custo (ou sem tarifa/frete coletada): ficam como pendência (falta dado externo).</div>
    ${d.sem_custo.length ? `<div class="tabela-wrap"><table class="t"><thead><tr><th>SKU</th><th>Anúncios</th><th>Falta</th></tr></thead><tbody>${semC.it.map(s => `<tr><td>${esc(s.sku || '(sem SKU)')}</td><td>${s.itens.map(esc).join(', ')}</td><td>${esc((s.faltando || []).join(', '))}</td></tr>`).join('')}</tbody></table></div>${semC.rod}` : `<div class="vazio-box">${esc(vazioFato(S.resumo, 'que todo anúncio elegível tem custo', 'Nenhum anúncio elegível sem custo.'))}</div>`}</div>
    <div class="secao"><h3>SKUs sem custo cadastrado (${d.skus_sem_custo.length})</h3><div class="sub">Maiores faturamentos primeiro. Cole-os na importação acima com o custo.</div>${d.skus_sem_custo.length ? `<div class="tabela-wrap"><table class="t"><thead><tr><th>SKU</th><th class="n">Anúncios</th><th class="n">Fat. 30d</th></tr></thead><tbody>${semSku.it.map(s => `<tr><td>${esc(s.sku)}</td><td class="n">${esc(s.anuncios)}</td><td class="n">${fmtR(s.fat30)}</td></tr>`).join('')}</tbody></table></div>${semSku.rod}` : `<div class="vazio-box">${esc(vazioFato(S.resumo, 'que todos os SKUs têm custo', 'Todos os SKUs têm custo.'))}</div>`}</div>
    ${secaoCustos(d, S.cliente)}
    ${comoFunciona('Como funciona: de onde vem a MC', `<ul><li>MC = preço − (comissão − rebate) − frete − custo − imposto; rebate = meli% × preço <b>original</b>.</li><li>Custo do anúncio vence: vínculo manual, SKU igual, SKU normalizado ou herdado de outro anúncio do mesmo produto (seções acima); sem ele, vale o fallback percentual de <i>custos_cliente</i> (${p ? `CMV ${fmtPct(p.cmv_pct)}, comissão ${fmtPct(p.comissao_pct)}, imposto ${fmtPct(p.imposto_pct)}` : '<b>não cadastrado</b>'}); sem nenhum dos dois: <b>SEM CUSTO</b> — nada é recomendado nem estimado.</li></ul>`)}`
  // atalho "Vincular custo" de Elegíveis: foco no campo do anúncio; fora da lista, diz por quê (nunca some em silêncio)
  if (foco && !v.erro) {
    const f = $('cvFoco'), corte = (v.totais?.anuncios_sem_custo || 0) > (v.anuncios_sem_custo || []).length     // a lista para em 500, por faturamento
    if (f) { f.scrollIntoView?.({ block: 'center' }); f.focus() } else toast(`${foco} não está em "Anúncios sem custo" (encerrado, inativo, já com custo${corte ? ' ou fora dos 500 primeiros por faturamento' : ''}): use o campo "ID do anúncio" num custo sem anúncio.`)
  }
  $('formCustos').onsubmit = async ev => {
    ev.preventDefault(); if (!podeGravar()) return
    const f = new FormData(ev.target)
    try { const r = await api('/api/promocoes/custos/importar', { cliente: S.cliente, texto: f.get('texto'), fonte: f.get('fonte'), por: quem() }); toast(`${r.importados} custo(s) importado(s)`); await aposGravar(abaCustos)
      const box = $('resImport'); if (r.total_rejeitadas && box) box.innerHTML = `<div class="aviso-faixa">${esc(r.total_rejeitadas)} linha(s) rejeitada(s): ${r.rejeitadas.slice(0, 5).map(x => `linha ${esc(x.linha)} (${esc(x.motivo)})`).join('; ')}</div>` } catch (e) { falha(e) }
  }
  $('formConfig').onsubmit = async ev => {
    ev.preventDefault(); if (!podeGravar()) return
    const o = {}; new FormData(ev.target).forEach((v, k) => { o[k] = v })
    try { await api('/api/promocoes/config', { cliente: S.cliente, ...o, por: quem() }); toast('Configuração salva'); await aposGravar(abaCustos) } catch (e) { falha(e) }
  }
}

// ── aba Interrogatório ──────────────────────────────────────────────────────────────────────────────
async function abaInterrogatorio() {
  const t = nova('interrogatorio')
  const d = await carregar(t, `/api/promocoes/interrogatorio?cliente=${C()}`)
  const form = (i) => `<form class="pr-form frmAprend" data-item="${esc(i.item_id)}" data-sku="${esc(i.sku)}" data-padrao="${esc(i.codigo)}" data-contexto="${esc(i.pergunta)}">
      <label class="v">O que fazer com a resposta<select name="acao"><option value="nota">só registrar (nota)</option><option value="ignorar">IGNORAR este anúncio (não re-propor)</option><option value="regra_sku">virar regra por SKU</option></select></label>
      <label class="v">Regra (se for regra por SKU)<input name="parametro" placeholder='Livre, 15% ou Revisar toda rodada'></label>
      <label class="v col2">Resposta do dono (fiel)<textarea name="resposta" required maxlength="2000"></textarea></label><div><button class="btn" type="submit">Registrar aprendizado</button></div></form>`
  const apr = pag50(d.aprendizados, 'aprendizados')
  pintar(`<div class="secao"><h3>${esc(d.resumoTexto)}</h3>
    ${d.grupos.length ? d.grupos.map(g => `<div class="pr-q"><h4>${esc(g.titulo)} <span class="tagzinha">${esc(g.n)}</span> <span class="mudo peq">${g.tipo === 'ele_marcou' ? 'você marcou, eu não marcaria' : 'eu marcaria, você não marcou'}</span></h4>${g.itens.slice(0, 30).map(i => `<div class="perg">${esc(i.pergunta)}<div class="mudo peq">${esc(i.sku || '')} · ${esc(i.item_id)} · ${esc(i.explicacao || '')}</div><details class="evid"><summary>Responder</summary>${form(i)}</details></div>`).join('')}${g.n > 30 ? `<div class="mudo peq">+ ${g.n - 30} no mesmo padrão</div>` : ''}</div>`).join('') : `<div class="vazio-box">${d.revisaoFeita ? '<b>Sem divergências abertas.</b>Você e o analista concordam nesta rodada.' : '<b>Ainda sem revisão sua.</b>Marque ou aprove sugestões em Elegíveis — sem isso não há o que comparar.'}</div>`}</div>`
    + (d.lembretes.length ? `<div class="secao"><h3>Lembretes — "Revisar toda rodada" (${d.lembretes.length})</h3><div class="tabela-wrap"><table class="t"><thead><tr><th>Anúncio</th><th>Nota</th><th class="n">Candidatas</th></tr></thead><tbody>${d.lembretes.map(l => `<tr><td><b>${esc(l.titulo || l.item_id)}</b><div class="mudo peq">${esc(l.sku || 'sem SKU')} · ${esc(l.item_id)}</div></td><td>${esc(l.nota)}</td><td class="n">${esc(l.candidatas)}</td></tr>`).join('')}</tbody></table></div></div>` : '')
    + `<div class="secao"><h3>Aprendizados (${d.aprendizados.length})</h3>${d.aprendizados.length ? `<div class="tabela-wrap"><table class="t"><thead><tr><th>Quando</th><th>Padrão</th><th>Escopo</th><th>Resposta</th><th>Efeito</th><th></th></tr></thead><tbody>${apr.it.map(a => `<tr class="${a.ativo ? '' : 'mudo'}"><td>${esc(brData(a.em))}<div class="mudo peq">${esc(a.por)}</div></td><td>${esc(a.padrao)}</td><td>${esc(a.escopo_tipo)} ${esc(a.escopo_valor)}</td><td>${esc(a.resposta)}</td><td>${esc(a.acao)} ${esc(a.parametro)}</td><td>${a.ativo ? `<button class="btn-mini perigo" data-acao="off-aprend" data-id="${esc(a.id)}">Desativar</button>` : 'inativo'}</td></tr>`).join('')}</tbody></table></div>${apr.rod}` : '<div class="vazio-box">Nenhum aprendizado registrado.</div>'}</div>`
    + comoFunciona('Como funciona', '<ul><li>Compara o que você marcou (ou aprovou) com o que o analista marcaria, agrupado por padrão — nunca uma pergunta por linha.</li><li>Cada resposta vira <b>aprendizado</b> do cliente e vale como regra nas próximas rodadas (não re-pergunta).</li></ul>'))
  document.querySelectorAll('.frmAprend').forEach(fm => { fm.onsubmit = async ev => {
    ev.preventDefault(); if (!podeGravar()) return
    const f = new FormData(fm), acao = f.get('acao'), item = fm.dataset.item
    const body = { cliente: S.cliente, padrao: fm.dataset.padrao, contexto: fm.dataset.contexto, resposta: f.get('resposta'), acao, parametro: f.get('parametro'), por: quem(),
      escopo_tipo: acao === 'nota' ? 'item' : acao === 'regra_sku' && fm.dataset.sku ? 'sku' : 'item', escopo_valor: acao === 'regra_sku' && fm.dataset.sku ? fm.dataset.sku : item }
    try { await api('/api/promocoes/aprendizados', body); toast('Aprendizado registrado'); await aposGravar(abaInterrogatorio) } catch (e) { falha(e) }   // aprendizado IGNORAR/regra muda a rodada: recarrega também o resumo/invariante
  } })
}

// ── aba Plano ───────────────────────────────────────────────────────────────────────────────────────
// idAlvo = plano que o dono pediu (select / plano recém-gerado): S.planoId SÓ muda depois que ele foi lido e está prestes a ser pintado; se a leitura falhar, a tela e S.planoId seguem no plano antigo
async function abaPlano(idAlvo) {
  const t = nova('plano'), alvo = idAlvo === undefined ? S.planoId : idAlvo
  const [planos, atual] = await Promise.all([carregar(t, `/api/promocoes/planos?cliente=${C()}`), carregar(t, `/api/promocoes/plano?cliente=${C()}${alvo ? '&id=' + enc(alvo) : ''}`)])
  const p = atual.plano, r = S.resumo
  S.planoId = p ? p.id : ''
  // execução interrompida (erro do job ou queda do polling) neste plano: o botão fica desabilitado até recarregar o plano
  const bloq = p && S.execBloq && S.execBloq.cli === S.cliente && S.execBloq.id === p.id ? S.execBloq : null
  let corpo = ''
  if (!p) corpo = '<div class="vazio-box"><b>Nenhum plano gerado.</b>Marque campanhas ou aprove sugestões em Elegíveis e gere o plano — ele é sempre um dry-run: só mostra as chamadas.</div>'
  else {
    const e = p.resumo, ex = p.resultado, itens = pag50(p.itens, 'plano')
    corpo = `<div class="pr-bloco"><div class="linha"><b>${esc(p.id)}</b><span class="selo ${estadoSelo(p)}">${esc(p.estado)}${p.expirado ? ' · EXPIRADO' : ''}</span><span class="mudo">criado ${esc(brHora(p.criado_em))} · expira ${esc(brHora(p.expira_em))} (24h)</span>${p.aprovado_por ? `<span class="mudo">aprovado por ${esc(p.aprovado_por)}</span>` : ''}</div>
      <div class="n-acoes mt-2">${esc(e.entrar)} entrada(s) (${esc(e.hedge)} de hedge) · ${esc(e.pular)} pulada(s) · ${esc(e.ignorar)} ignorada(s) · ${esc(e.anuncios)} anúncio(s) · <b>nenhuma saída de campanha — o sistema nunca sai</b></div>
      ${Object.keys(e.por_motivo || {}).length ? `<div class="mudo peq">${Object.entries(e.por_motivo).map(([k, v]) => `${esc(k)}: ${esc(v)}`).join(' · ')}</div>` : ''}
      <div class="pr-acoes mt-2">${p.estado === 'dry-run' && !p.expirado && e.entrar ? `<button class="btn" data-plano="${esc(p.id)}" data-acao="plano-aprovar">Aprovar plano</button>` : ''}<a class="btn btn-fantasma" href="/api/promocoes/exportar.csv?cliente=${C()}&tipo=plano&id=${enc(p.id)}">Exportar CSV</a></div></div>
    <div class="tabela-wrap"><table class="t"><thead><tr><th>Ação</th><th>Anúncio</th><th>Campanha</th><th>Motivo</th><th>Chamada</th></tr></thead><tbody>${itens.it.map(i => `<tr><td><span class="acao-${esc(i.acao)}">${esc(i.acao)}</span>${i.hedge ? '<div class="mudo peq">hedge</div>' : ''}</td><td><b>${esc(i.sku || i.item_id)}</b><div class="mudo peq">${esc(i.item_id)} · ${esc(i.origem)}</div></td><td>${esc(i.campanha)}<div class="mudo peq">${esc(i.pid)}</div></td><td>${esc(i.detalhe)}${i.vivo ? `<div class="mudo peq">vivo: ${fmtR(i.vivo.preco)} · MC ${fmtPct(i.vivo.mcPct)}</div>` : ''}</td><td>${i.chamada ? `<details class="evid"><summary>Chamada exata</summary><code class="pr-plano-it">${esc(i.chamada.metodo)} ${esc(i.chamada.caminho)}<br>${esc(JSON.stringify(i.chamada.corpo))}</code></details>` : '<span class="mudo">— nenhuma chamada —</span>'}</td></tr>`).join('')}</tbody></table></div>${itens.rod}`
    if (p.estado === 'aprovado' || p.estado === 'executado') corpo += !p.execucao_habilitada
      ? `<div class="pr-bloco travado"><b>Execução DESLIGADA para este cliente (padrão).</b><div class="mudo">Duas chaves precisam estar abertas ao mesmo tempo: <code class="pr">execucao_habilitada = 1</code> neste cliente e confirmação explícita a cada execução. Não há botão para ligar a chave 1 nesta tela: siga docs/promocoes-por-cliente.md (primeira execução supervisionada, 1 anúncio). Enquanto isso, o plano acima é a lista exata para você executar à mão no painel.</div></div>`
      : `<div class="pr-bloco perigo"><b>Execução LIGADA neste cliente — dinheiro vivo.</b><div class="mudo">NÃO TESTADA EM PRODUÇÃO: a primeira execução deve ser supervisionada, com 1 anúncio (limite atual: ${esc(r.execucao.max_itens)}). "Entrou" só com prova; o ML leva ~${esc(p.espera_propagacao_min)} min para propagar.</div>
        ${bloq ? `<div class="pr-bloco perigo" role="alert"><b>${esc(bloq.aviso || 'Execução em andamento ou interrompida.')}</b><div class="mudo">A execução pode ter enviado chamadas ao Mercado Livre: confira a Auditoria e o painel do ML antes de repetir. "Executar" fica desabilitado até você recarregar o plano.</div><div class="pr-acoes mt-2"><button class="btn" data-plano="${esc(p.id)}" data-acao="plano-recarregar">Recarregar plano</button></div></div>` : ''}
        ${botaoExecutar(p, bloq) === 'oculto' ? (p.estado === 'aprovado' && p.expirado ? '<div class="mudo mt-2">Plano EXPIRADO: gere um novo plano e aprove-o para executar.</div>' : '') : `<div class="pr-acoes mt-2"><button class="btn btn-perigo" data-plano="${esc(p.id)}" data-acao="plano-executar" ${botaoExecutar(p, bloq) === 'desabilitado' ? 'disabled' : ''}>Executar este plano</button></div>`}</div>`
    // falha pós-claim (interrompida/erro) fica visível ENQUANTO o plano estiver nesse estado, não só no toast: motivo, o que saiu e o que conferir
    if (ex) corpo += (ex.interrompido || ex.erro || p.estado === 'executado_parcial' || p.estado === 'erro' ? `<div class="pr-bloco perigo" role="alert"><b>${p.estado === 'erro' ? 'Execução com ERRO' : 'Execução INTERROMPIDA'} — ${ex.resumo.chamadas ? `${esc(ex.resumo.chamadas)} chamada(s) ENVIADA(S) ao Mercado Livre` : 'nenhuma chamada enviada'}.</b>${ex.interrompido || ex.erro ? `<div>${esc(ex.interrompido || ex.erro)}</div>` : ''}<div class="mudo">${ex.resumo.chamadas ? 'Pode haver chamadas já gravadas no ML: confira a Auditoria e o painel (/items/{id}/prices) antes de qualquer nova tentativa; "Sincronizar" lê o estado.' : 'Confira a Auditoria; gere um novo plano se for repetir.'}</div></div>` : '') + `<div class="pr-bloco"><b>Resultado da execução</b> <span class="mudo">${esc(brHora(p.executado_em))} · por ${esc(ex.por)}</span><div class="n-acoes mt-2">${esc(ex.resumo.entrou_provado)} entrou (provado) · ${esc(ex.resumo.sem_prova_ainda)} sem prova ainda · ${esc(ex.resumo.incertas)} incerta(s) · ${esc(ex.resumo.recusadas)} recusada(s) · ${esc(ex.resumo.nao_enviadas)} não enviada(s)</div><div class="mudo peq">${esc(ex.resumo.nota)}</div>
      <div class="tabela-wrap"><table class="t"><thead><tr><th>Anúncio</th><th>Campanha</th><th>HTTP</th><th>Estado</th><th>Resposta / motivo</th></tr></thead><tbody>${ex.chamadas.map(c => `<tr><td>${esc(c.item_id)}</td><td>${esc(c.campanha || c.pid)}</td><td>${esc(c.status_http ?? '—')}</td><td>${esc(c.estado_final)}${c.estado_final === 'enviado_sem_prova_ainda' || c.estado_final === 'incerto_conferir' ? '<div class="mudo peq">2xx ≠ entrou: espere a propagação e sincronize</div>' : ''}</td><td class="mudo peq">${esc(c.resposta || '—')}</td></tr>`).join('')}</tbody></table></div>
      ${ex.sync ? `<div class="n-acoes">Sync de ${esc(brHora(ex.sync.em))}: ${esc(ex.sync.entrou)} entrou · ${esc(ex.sync.nao_provado)} não provado(s)${ex.sync.sem_leitura ? ` · <b class="neg">${esc(ex.sync.sem_leitura)} SEM leitura (a leitura falhou: não é veredito, sincronize de novo)</b>` : ''} ${ex.sync.suspeito ? `· <b class="neg">${esc(ex.sync.aviso)}</b>` : ''}</div>` : ''}
      <div class="pr-acoes mt-2"><button class="btn" data-plano="${esc(p.id)}" data-acao="plano-sync">Sincronizar (só leitura; espera ${esc(p.espera_propagacao_min)} min)</button></div></div>`
  }
  pintar`<div class="pr-filtros"><button class="btn" data-acao="plano-gerar">Gerar plano (dry-run)</button>${planos.length ? `<select id="selPlano" aria-label="Planos">${planos.map(x => `<option value="${esc(x.id)}" ${p && x.id === p.id ? 'selected' : ''}>${esc(brHora(x.criado_em))} · ${esc(x.estado)} · ${esc(x.resumo.entrar ?? 0)} entrada(s)</option>`).join('')}</select>` : ''}</div>
    ${corpo}
    ${comoFunciona('Como funciona', '<ul><li>Marcar não executa. O plano re-busca cada anúncio AO VIVO e mostra a chamada exata (offer_id vivo).</li><li>Ignora o que já participa; pula relâmpago SMART (só painel), LIGHTNING e campanha sem rebate; MC negativa só com ordem direta ou SKU "Livre".</li><li>Pre-check por margem: candidato vivo abaixo do aprovado não entra; acima entra. Hedge: entra em todas as campanhas equivalentes.</li><li>O plano expira em 24h e <b>nunca</b> contém saída de campanha.</li></ul>')}`
  // troca de plano: S.planoId só muda dentro do abaPlano, depois da leitura. Se ela falhar a tela segue no plano antigo — o select volta a ele e aprovar/executar ficam desabilitados até recarregar a aba
  if ($('selPlano')) $('selPlano').onchange = async e => {
    try { await abaPlano(e.target.value) } catch (x) {
      if (x === OBSOLETA) return
      if ($('selPlano')) $('selPlano').value = S.planoId
      document.querySelectorAll('[data-acao="plano-aprovar"],[data-acao="plano-executar"]').forEach(b => { b.disabled = true })
      toast(`Não consegui abrir o plano escolhido (${x.message}). A tela segue no plano ${S.planoId}: aprovar/executar desabilitados — reabra a aba Plano.`, true)
    }
  }
}

// ── aba Auditoria ───────────────────────────────────────────────────────────────────────────────────
async function abaAuditoria() {
  const t = nova('auditoria')
  const l = await carregar(t, `/api/promocoes/auditoria?cliente=${C()}&limite=300`)
  const pg = pag50(l, 'auditoria')
  $('conteudo').innerHTML = `<div class="pr-filtros"><a class="btn btn-fantasma" href="/api/promocoes/exportar.csv?cliente=${C()}&tipo=auditoria">Exportar CSV</a><span class="mudo">todo evento fica registrado: coleta, marcas, plano, execução, sync, config</span></div>`
    + (l.length ? `<div class="tabela-wrap"><table class="t"><thead><tr><th>Quando</th><th>Evento</th><th>Anúncio</th><th>Campanha</th><th>Autor</th><th>Detalhe</th></tr></thead><tbody>${pg.it.map(a => `<tr><td>${esc(brHora(a.em))}</td><td><b>${esc(a.evento)}</b></td><td>${esc(a.item_id)}</td><td>${esc(a.pid)}</td><td>${esc(a.autor)}</td><td class="mudo peq">${esc(a.detalhe)}${a.depois ? `<div>${esc(JSON.stringify(a.depois).slice(0, 220))}</div>` : ''}</td></tr>`).join('')}</tbody></table></div>${pg.rod}` : '<div class="vazio-box"><b>Sem eventos ainda.</b>A primeira coleta abre o histórico deste cliente.</div>')
}

// ── vínculo custo ↔ anúncio (aba Custos) ───────────────────────────────────────────────────────────
// "por" = o nome do perfil (ps_perfil_por, o mesmo da tela do cliente e do vínculo de tarefa); sem ele, "Seu nome" do topo; sem os dois, pergunta
const lerPerfil = () => { try { return localStorage.getItem('ps_perfil_por') || '' } catch { return '' } }
function perguntarNome() {
  let d = document.getElementById('dlgPor')
  if (!d) {
    d = document.createElement('dialog'); d.className = 'dlg'; d.id = 'dlgPor'
    d.innerHTML = `<form method="dialog"><h2>Quem está vinculando?</h2><p class="mudo">O nome fica registrado junto do vínculo (auditoria).</p>
      <label class="campo">Seu nome<input name="por" required maxlength="80" autocomplete="name" placeholder="Nome e sobrenome"></label>
      <div class="dlg-rodape"><button class="btn" type="button" data-fecha>Cancelar</button><button class="btn" type="submit" value="sim">Confirmar</button></div></form>`
    d.querySelector('[data-fecha]').onclick = () => d.close('nao')
    document.body.append(d)
  }
  const f = d.querySelector('form'); f.reset(); d.returnValue = ''; d.showModal()
  return new Promise(r => d.addEventListener('close', () => r(d.returnValue === 'sim' ? f.elements.por.value.trim() : ''), { once: true }))
}
async function porVinculo() {
  const n = (lerPerfil() || quem() || await perguntarNome()).trim()
  if (n) try { localStorage.setItem('ps_perfil_por', n) } catch { /* sem armazenamento: só não lembra o nome */ }
  return n
}
// Confirmar / Não é este (candidato ou vínculo automático da tabela), Vincular por ID (custo sem anúncio) ou por custo escolhido (anúncio sem custo), Desvincular (só o manual).
// O servidor valida tudo de novo (anúncio do cliente, custo vigente) e responde sem eco; depois recarrega o resumo (KPI Sem custo) e a aba.
async function acaoVinculo(a, el) {
  const campo = () => el.closest('.pr-vinc')?.querySelector('input')
  let item = el.dataset.item || '', sku = el.dataset.sku || ''
  if (a === 'cv-manual' && !(item = normMlb(campo()?.value))) return toast('Informe o ID do anúncio no formato MLB123456789.', true)
  if (a === 'cv-escolher' && !(sku = String(campo()?.value || '').trim())) return toast('Escolha um custo da lista (digite para buscar o SKU).', true)
  if (a === 'cv-desvincular') {
    const o = { titulo: `Desvincular o custo de ${item}?`, texto: `O anúncio deixa de usar o custo ${sku} escolhido à mão; volta a valer o SKU igual, normalizado ou herdado, se houver.`, rotuloOk: 'Desvincular', perigo: true }
    if (!(await (window.PS?.confirmar ? window.PS.confirmar(o) : Promise.resolve(confirm(o.titulo))))) return
  }
  const por = await porVinculo(); if (!por) return toast('Informe seu nome: o vínculo fica registrado com ele.', true)
  const cli = S.cliente
  const r = a === 'cv-recusar' ? await api('/api/custos/recusar', { cliente: cli, item_id: item, sku_custo: sku, por })
    : a === 'cv-desvincular' ? await api('/api/custos/desvincular', { cliente: cli, item_id: item, por })
    : await api('/api/custos/vincular', { cliente: cli, item_id: item, sku_custo: sku, por })
  toast(a === 'cv-recusar' ? `Não é este: ${r.sku_custo} não volta a ser sugerido para ${r.item_id}`
    : a === 'cv-desvincular' ? (r.removidos ? `Vínculo manual desfeito: ${r.item_id}` : `${r.item_id} não tinha vínculo manual`)
    : `Custo vinculado: ${r.sku_custo} → ${r.item_id}`)
  if (cli === S.cliente) return aposGravar(abaCustos)
}

// ── ações (delegação) ───────────────────────────────────────────────────────────────────────────────
document.addEventListener('click', async ev => {
  const el = ev.target.closest('[data-acao]'); if (!el || el.disabled) return
  const a = el.dataset.acao
  // gravar exige "Seu nome" (autoria) e nenhum job em andamento neste cliente; a prévia do analista só espera o job
  if ((GRAVAM.has(a) && !podeGravar()) || (a === 'analista-previa' && bloqueadoPorJob())) return
  try { await executarAcao(a, el) } catch (e) { falha(e) }   // await aqui: erro/obsoleta de qualquer ação (inclusive de "return abaX()") cai no falha
})
// 409 'numeros_mudaram' (outra aba/rodada recalculou a sugestão desde que a tela carregou): nada foi aprovado — o aviso fica em vermelho e a tela recarrega com os números novos
async function aprovarItens(itens) {
  try { const d = desfechoAprovacao(await api('/api/promocoes/aprovar-analista', { cliente: S.cliente, itens, por: quem() })); toast(d.msg, d.ruim) } catch (e) { toast(e.message, true) }
  return aposGravar(abaElegiveis)
}
async function executarAcao(a, el) {
    if (a === 'abrir') return abrir(el.dataset.c, 'elegiveis')
    if (a === 'escolher') return escolher()
    if (a === 'aba') return mostrarAba(el.dataset.k)
    if (a === 'mais') { S.mais[el.dataset.k] = (S.mais[el.dataset.k] || 50) + 50; return ABA_FN[S.aba]() }
    // Próxima ação "Aprovar sugestões": abre Elegíveis (se preciso) e já pede a confirmação em linha
    if (a === 'ir-aprovar') { if (S.aba !== 'elegiveis' || !$('fQ')) await mostrarAba('elegiveis'); return $('btnAprovarTodas') ? executarAcao('aprovar-todas', el) : undefined }
    if (a === 'det') { const tr = el.closest('tr').nextElementSibling; tr.hidden = !tr.hidden; el.textContent = tr.hidden ? 'Detalhes' : 'Fechar'; el.setAttribute('aria-expanded', String(!tr.hidden)); S.abertos[tr.hidden ? 'delete' : 'add'](el.dataset.item); return }
    if (a === 'pag') { S.f.pagina = Number(el.dataset.p) || 1; return abaElegiveis() }
    // atalho da célula SEM CUSTO (Elegíveis): abre a aba Custos com o anúncio no topo de "Anúncios sem custo" e o foco no campo "Escolher custo"
    if (a === 'vincular-custo') { S.focoCusto = el.dataset.item || ''; return mostrarAba('custos') }
    if (a.startsWith('cv-')) return acaoVinculo(a, el)
    if (a === 'marcar') {
      const det = el.closest('tr.det'), ordem = !!det?.querySelector('.chkOrdem')?.checked
      const v = el.dataset.v, marcado = v === '1' ? true : v === '0' ? false : null
      await api('/api/promocoes/marcar', { cliente: S.cliente, item_id: el.dataset.item, pid: el.dataset.pid, marcado, ordem_direta: ordem, por: quem() })
      toast(marcado === true ? 'Marcada — só entra no plano depois de aprovado' : marcado === false ? 'Recusada — o analista não re-sugere' : 'Decisão limpa')
      return aposGravar(abaElegiveis)
    }
    if (a === 'aprovar') return aprovarItens([parDoBotao(el.dataset)])   // o servidor barra par recusado: só diz "aprovada" se aprovou
    // "aprovar todas": confirmação em linha (não confirm()) com a contagem e o escopo — a rota aprova as pendentes de TODO o cliente, não só as filtradas; a contagem já exclui o que a recusa do dono barra
    if (a === 'aprovar-todas') {
      const n = S.resumo?.kpis?.sugeridas || 0, barr = S.resumo?.kpis?.sugeridas_barradas || 0
      if (!n) return toast(barr ? `Nenhuma sugestão aprovável: ${barr} barrada(s) por recusa/bloqueio seu.` : 'Nenhuma sugestão pendente para aprovar.')
      $('confTodas').innerHTML = `<div class="aviso" role="group" aria-label="Confirmar aprovação das sugestões"><b>${esc(textoAprovarTodas(n, filtrosAtivos(S.f), barr))}</b><div class="pr-acoes mt-2"><button class="btn" data-acao="aprovar-todas-ok">Confirmar: aprovar ${esc(n)}</button><button class="btn btn-fantasma" id="btnCancelarTodas" data-acao="aprovar-todas-nao">Cancelar</button></div></div>`
      return $('btnCancelarTodas').focus()
    }
    if (a === 'aprovar-todas-nao') { $('confTodas').innerHTML = ''; return $('btnAprovarTodas').focus() }
    if (a === 'aprovar-todas-ok') {
      $('confTodas').innerHTML = ''; $('btnAprovarTodas').focus()
      return aprovarItens(S.resumo?.sugestoes_pendentes || [])          // a lista que a contagem mostrou, com os números de cada sugestão
    }
    if (a === 'protegido') { await api('/api/promocoes/protegido', { cliente: S.cliente, item_id: el.dataset.item, protegido: el.dataset.v === '1', por: quem() }); toast('Atualizado'); return aposGravar(abaElegiveis) }
    // "aplicar analista": confirmação em linha ANTES de gravar, avisando quantas aprovações 🤖 do dono estão em risco (a rodada nova revoga as de números diferentes)
    if (a === 'analista-aplicar') {
      $('confTodas').innerHTML = `<div class="aviso" role="group" aria-label="Confirmar aplicação do analista"><b>${esc(textoAplicar(S.resumo?.kpis?.aprovadas_analista))}</b><div class="pr-acoes mt-2"><button class="btn" data-acao="analista-aplicar-ok">Confirmar: aplicar analista</button><button class="btn btn-fantasma" id="btnCancelarTodas" data-acao="aprovar-todas-nao">Cancelar</button></div></div>`
      return $('btnCancelarTodas').focus()
    }
    if (a === 'analista-previa' || a === 'analista-aplicar-ok') {
      const aplicar = a === 'analista-aplicar-ok', antes = S.resumo?.kpis?.aprovadas_analista
      if (aplicar) $('confTodas').innerHTML = ''
      const r = await api('/api/promocoes/analista', { cliente: S.cliente, aplicar, por: quem() })
      if (aplicar) await aposGravar(abaElegiveis); else await abaElegiveis()
      // revogadas: o que o servidor informar; senão a queda das aprovações 🤖 no resumo recarregado
      const depois = S.resumo?.kpis?.aprovadas_analista, rev = Number.isFinite(Number(r.aprovacoes_revogadas)) ? Number(r.aprovacoes_revogadas) : aplicar && antes > depois ? antes - depois : 0
      toast(`${aplicar ? 'Gravado' : 'Prévia'}: ${r.recomendacoes.length} recomendação(ões), ${r.vigias.cobertura.alertas.length} alerta(s) de cobertura, ${r.vigias.rebatePior.length} rebate-pior · invariante ${r.invariante.ok ? 'VERDE' : 'VERMELHO'}`
        + (rev ? ` · ⚠ ${rev} aprovação(ões) 🤖 REVOGADA(S) por mudança de preço/MC%: aprove de novo` : ''), !r.invariante.ok || rev > 0)
      return
    }
    if (a === 'rm-regra') { if (!confirm('Remover esta regra? O anúncio volta ao piso padrão.')) return; await api('/api/promocoes/regras-sku', { cliente: S.cliente, mlb: el.dataset.mlb, sku: el.dataset.sku, por: quem() }, 'DELETE'); toast('Regra removida'); return aposGravar(abaRegras) }   // a regra (Revisar toda rodada…) muda a rodada: recarrega resumo/invariante
    if (a === 'off-aprend') { await api('/api/promocoes/aprendizados/desativar', { cliente: S.cliente, id: Number(el.dataset.id), por: quem() }); return aposGravar(abaInterrogatorio) }
    if (a === 'plano-gerar') {
      const cli = S.cliente
      if (S.aba !== 'plano') await mostrarAba('plano')   // vindo da Próxima ação: o resultado é pintado na aba Plano
      const { job } = await api('/api/promocoes/plano', { cliente: cli, por: quem() }); toast(`Gerando o dry-run de ${cli} (lê as ofertas ao vivo — só GET)…`)
      const j = await acompanhar(job, 'planejando', cli); if (j.estado === 'erro') throw new Error(`${cli}: ${j.erro}`)
      if (cli !== S.cliente) return toast(`Plano de ${cli} gerado — abra o cliente para vê-lo.`)   // não mexe no S.planoId de outro cliente
      return abaPlano(j.resultado.id)   // S.planoId só muda dentro do abaPlano, depois do plano novo ser lido
    }
    // aprovar/executar/sincronizar/recarregar agem sobre o plano que o BOTÃO carrega (data-plano = o plano pintado), nunca sobre um S.planoId que pode ter mudado
    const planoDoBotao = () => { const id = el.dataset.plano || S.planoId; if (!id) throw new Error('plano não identificado: reabra a aba Plano'); return id }
    if (a === 'plano-aprovar') { const id = planoDoBotao(); if (!confirm(`Aprovar o plano ${id}? Aprovar NÃO executa: apenas habilita a execução (que continua travada).`)) return; await api('/api/promocoes/plano/aprovar', { cliente: S.cliente, id, por: quem() }); toast('Plano aprovado'); return abaPlano(id) }
    if (a === 'plano-recarregar') {
      if (bloqueadoPorJob()) return
      const id = planoDoBotao(), b = S.execBloq; if (b && b.cli === S.cliente && b.id === id) S.execBloq = null
      try { return await abaPlano(id) } catch (e) { S.execBloq = b; throw e }   // só libera o "Executar" se o plano recarregou
    }
    if (a === 'plano-executar') {
      const cli = S.cliente, id = planoDoBotao()
      if (S.execBloq && S.execBloq.cli === cli && S.execBloq.id === id) return toast('Recarregue o plano antes de executar de novo.', true)
      if (prompt(`EXECUÇÃO AO VIVO do plano ${id} (${cli}) em conta de dinheiro real. Digite EXECUTAR para confirmar (primeira vez: 1 anúncio, supervisionado):`) !== 'EXECUTAR') return toast('Execução cancelada.')
      const bq = S.execBloq = { cli, id, aviso: '' }   // travado até a execução terminar; se algo falhar, só um plano recarregado destrava
      let iniciou = false, ok = false
      try {
        const { job } = await api('/api/promocoes/plano/executar', { cliente: cli, id, confirmar: true, por: quem() }); iniciou = true
        const j = await acompanhar(job, 'executando', cli); if (j.estado === 'erro') throw new Error(j.erro)
        if (!j.resultado) throw new Error('a execução terminou sem resultado')   // sem resultado não se sabe o que saiu: falha fechada (bloqueia até recarregar o plano)
        const d = desfechoExecucao(cli, j.resultado); ok = true; toast(d.msg, d.ruim)   // enviada | interrompida | erro | nada enviado, pelo resultado real
      } catch (e) {
        if (!iniciou) { if (S.execBloq === bq) S.execBloq = null; falha(e) }   // recusada na porta: nenhuma chamada saiu
        else {
          bq.aviso = `Falha ao executar/acompanhar o plano de ${cli}: ${e.message}.`
          document.querySelectorAll('[data-acao="plano-executar"]').forEach(b => { b.disabled = true })
          toast(`${bq.aviso} A execução pode ter enviado chamadas: confira a Auditoria e o painel do ML antes de repetir.`, true)
        }
      }
      if (ok && S.execBloq === bq) S.execBloq = null
      if (cli === S.cliente) await abaPlano(id).catch(falha)   // qualquer desfecho: recarrega o plano para mostrar o estado real
      return
    }
    if (a === 'plano-sync') { const id = planoDoBotao(), s = await api('/api/promocoes/plano/sync', { cliente: S.cliente, id, por: quem() }); toast(s.suspeito ? s.aviso : `Sync: ${s.entrou} entrou, ${s.nao_provado} não provado(s)${s.sem_leitura ? `, ${s.sem_leitura} SEM leitura (falhou: sincronize de novo)` : ''}`, !!s.suspeito || !!s.sem_leitura); return abaPlano(id) }
}
$('btnColetar').onclick = coletar
iniciar()
