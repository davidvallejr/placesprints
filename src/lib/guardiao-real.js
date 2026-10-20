// Agente Smith G0 — fiação com banco do raio-X e da pauta (núcleo PURO em guardiao.js). Só leitura do que já existe: central, conexão ML, change-log de preço (com o executor do
// origemPreco e a medição do Merovíngio, medirMarco), tarefas e atas, custos, F9 (caixa/lucro), contrato e risco. Escrita local só em preco_decisao (1 clique «decisão do cliente»)
// e conta_canal (lojas do mesmo dono), prévia por padrão, confirmar === true grava, `por` = líder/consultor, registro no livro. Nada chama o ML; nada muda plano ou texto ao cliente.
// Isolamento: toda consulta por cliente = ?.
import { db, hojeLocal, agora as agoraDb } from './db.js'
import { diaLocal } from './preco-historico.js'
import { origemPreco } from './gatilhos.js'
import { atividadePreco } from './gatilhos-real.js'
import { medirMarco } from './impacto-tarefas.js'
import { relatorioDoCliente } from './relatorios-ciclo-real.js'
import { nomesInternos } from './relatorio-brief-real.js'
import { TOKENS } from './render-dossie.js'
import { raioX, pautaReuniao, pautaTexto, pautaHtml, auditarPauta, marcosDeRegistro, compromissosDaAta, decisorDe, addDias, CANAIS_CONTA, DECISORES } from './guardiao.js'

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const dia10 = v => (/^\d{4}-\d{2}-\d{2}/.test(String(v ?? '')) ? String(v).slice(0, 10) : '')
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const json = (s, d) => { try { return JSON.parse(s) } catch { return d } }
const tabela = (h, t) => !!h.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t)
const umaOuNull = (h, t, sql, ...a) => (tabela(h, t) ? h.prepare(sql).get(...a) : null)
const LIMIAR_PRECO = 3        // config/atribuicao.json → preco.limiar_confundidor_pct (o mesmo do confundidor e do marco do desenho § 3.3)
const RX_PRECO_TAREFA = /pre[cç]o|valores|velores/i
const ehAta = t => (t.tipo_demanda === 'Reunião de Alinhamento' || /reuni[aã]o/i.test(t.titulo)) && String(t.conteudo || '').length > 200

export function dadosGuardiao(cliente, { hoje = hojeLocal(), medirMax = 10, h = db } = {}) {
  const de90 = addDias(hoje, -90)
  const cc = h.prepare('SELECT * FROM clientes_central WHERE cliente = ?').get(cliente) || {}
  const central = { status: cc.status_cs || '', canais: json(cc.canais_json, []), canais_cs: json(cc.canais_cs_json, []), vencimentos: json(cc.vencimentos_json, {}),
    health_score: cc.health_score ?? null, hs_classificacao: cc.hs_classificacao || '', rotulo: json(cc.notificacao_json, {})?.rotulo || '' }
  const conta = umaOuNull(h, 'meli_contas', 'SELECT nickname, erro FROM meli_contas WHERE cliente = ?', cliente)
  const ultima = umaOuNull(h, 'meli_coleta_dia', 'SELECT MAX(dia) d FROM meli_coleta_dia WHERE cliente = ?', cliente)?.d || ''
  const ml = { conectado: !!conta, ultima_coleta: ultima }

  const tarefas = h.prepare('SELECT id, titulo, processo, status, tipo_demanda, data_inicio, prazo, data_conclusao, last_edited, descricao, conteudo FROM tarefas WHERE cliente = ? AND arquivada = 0').all(cliente)
  const diaDe = t => dia10(t.data_conclusao) || dia10(t.prazo) || dia10(t.data_inicio) || diaLocal(t.last_edited)
  const canalDoProcesso = p => (/shopee/i.test(p) ? 'shopee' : /amazon/i.test(p) ? 'amazon' : /tiktok/i.test(p) ? 'tiktok' : /magalu/i.test(p) ? 'magalu' : /mercado|\bml\b/i.test(p) ? 'ml' : '')

  // contas: cadastro manual + contas numeradas citadas nas tarefas («Shopee 1», «Shopee 2»)
  const contas_canal = tabela(h, 'conta_canal') ? h.prepare('SELECT canal, conta, nome_loja, grupo, por, em FROM conta_canal WHERE cliente = ? ORDER BY canal, conta').all(cliente) : []
  const nProc = new Map(); for (const t of tarefas) if (/^[\p{L} ]+\s\d$/u.test(t.processo.trim())) nProc.set(t.processo.trim(), (nProc.get(t.processo.trim()) || 0) + 1)
  const contas_tarefas = [...nProc].map(([processo, n]) => ({ processo, n })).sort((a, b) => a.processo.localeCompare(b.processo))

  // custos
  const cj = umaOuNull(h, 'custos_cliente', 'SELECT custos_json, atualizado_em FROM custos_cliente WHERE cliente = ?', cliente)
  const pc = cj ? Object.values(json(cj.custos_json, {})).filter(v => v != null && v !== '').length : 0
  const agg = (t, col) => umaOuNull(h, t, `SELECT COUNT(*) n, MAX(${col}) em FROM ${t} WHERE cliente = ?`, cliente) || { n: 0, em: '' }
  const custos = { percentuais: { n: pc, em: cj?.atualizado_em || '' }, sku_promo: agg('promo_custos_sku', 'atualizado_em'), erp: agg('erp_custos_sku', 'recebido_em'), vinculo: agg('custo_vinculo', 'em'),
    pedido_em: umaOuNull(h, 'acoes_plano', "SELECT MIN(criado_em) d FROM acoes_plano WHERE cliente = ? AND regra IN ('cadastrar_custos','anuncio_cadastrar_custos')", cliente)?.d || '',
    informacoes: tabela(h, 'cliente_informacoes') ? h.prepare('SELECT titulo, secao, editado_em FROM cliente_informacoes WHERE cliente = ?').all(cliente).filter(i => /precific|custo/i.test(norm(i.titulo))) : [] }
  const temCusto = !!(custos.sku_promo.n || custos.erp.n || custos.vinculo.n || custos.percentuais.n)
  const custoDesde = [custos.sku_promo.em, custos.erp.em, custos.percentuais.em].map(dia10).filter(Boolean).sort()[0] || ''

  // decisões marcadas (1 clique)
  const marcas = new Map((tabela(h, 'preco_decisao') ? h.prepare('SELECT ref, decisor, por, em FROM preco_decisao WHERE cliente = ?').all(cliente) : []).map(r => [r.ref, r]))

  // marcos de preço do ML (change-log) com o executor (origemPreco) e a medição do Merovíngio nas mais recentes
  let marcosMl = []
  if (ml.conectado && tabela(h, 'meli_item_mudanca')) {
    const muds = h.prepare(`SELECT m.item_id, m.dia, m.de, m.para, m.variacao_pct, m.fonte, i.titulo FROM meli_item_mudanca m LEFT JOIN meli_item i ON i.cliente = m.cliente AND i.item_id = m.item_id
      WHERE m.cliente = ? AND m.campo = 'preco' AND m.fonte IN ('coleta','webhook','acomp','ofertas') AND m.dia >= ? AND m.dia <= ? AND ABS(COALESCE(m.variacao_pct, 0)) >= ? ORDER BY m.dia DESC, m.item_id LIMIT 40`).all(cliente, de90, hoje, LIMIAR_PRECO)
    let at = null
    const ext = muds.filter(m => ['coleta', 'webhook'].includes(m.fonte))
    if (ext.length) { const ds = ext.map(m => m.dia).sort(); try { at = atividadePreco(cliente, [...new Set(ext.map(m => m.item_id))], { de: addDias(ds[0], -2), ate: addDias(ds.at(-1), 1) }) } catch { at = null } }
    marcosMl = muds.map((m, k) => {
      const mk = { ref: `ml:${m.item_id}:${m.dia}`, fonte: 'ml', canal: 'ml', item_id: m.item_id, dia: m.dia, produto: m.titulo || 'anúncio sem título lido', de_c: Number.isFinite(Number(m.de)) ? Math.round(Number(m.de) * 100) : null,
        para_c: Number.isFinite(Number(m.para)) ? Math.round(Number(m.para) * 100) : null, variacao_pct: m.variacao_pct, direcao: m.variacao_pct > 0 ? 'alta' : 'baixa', executor: origemPreco(m, at), contexto: [], indicio_cliente: false }
      if (k < medirMax) { try { mk.medicao = medirMarco(cliente, m.item_id, m.dia, { tipo: 'Atualizar Preços', hoje }) } catch { mk.medicao = null } }
      return mk
    })
  }
  const precoT = tarefas.filter(t => t.status === 'concluida' && (RX_PRECO_TAREFA.test(t.tipo_demanda) || RX_PRECO_TAREFA.test(t.titulo)) && !ehAta(t))
    .map(t => ({ ...t, dia: diaDe(t), canal: canalDoProcesso(t.processo) })).filter(t => t.dia <= hoje)
  const atas = tarefas.filter(ehAta).map(t => ({ id: t.id, dia: diaDe(t), titulo: t.titulo, processo: t.processo, canal: canalDoProcesso(t.processo), texto: t.conteudo })).filter(a => a.dia && a.dia <= hoje)
  const canalCentral = { SHO: 'shopee', AMZ: 'amazon', TTK: 'tiktok', MGL: 'magalu', ML: 'ml' }[central.canais[0]] || 'canal'
  const reg = marcosDeRegistro({ tarefasPreco: precoT, atas, de: de90, ate: hoje }).map(m => ({ ...m, canal_sem_serie: m.canal && m.canal !== 'ml' ? m.canal : !ml.conectado ? m.canal || canalCentral : '' }))
  const marcos = [...marcosMl, ...reg].sort((a, b) => b.dia.localeCompare(a.dia))
    .map(m => ({ ...m, custo_conhecido: temCusto && !!custoDesde && custoDesde <= m.dia, decisao: decisorDe(m, marcas.get(m.ref)) }))

  // promessas das atas (90 d), mais recentes primeiro, sem repetir a mesma frase
  const vistos = new Set(), promessas = []
  for (const a of atas.filter(a => a.dia >= de90).sort((x, y) => y.dia.localeCompare(x.dia))) for (const p of compromissosDaAta(a.texto)) { const k = norm(p.frase); if (!vistos.has(k)) { vistos.add(k); promessas.push({ ...p, dia: a.dia, ata: a.id }) } }

  // Ads
  const gasto = ml.conectado ? umaOuNull(h, 'meli_ads_item', "SELECT COUNT(*) n, SUM(custo) c FROM meli_ads_item WHERE cliente = ? AND periodo = 'atual'", cliente) : null
  const adsT = tarefas.filter(t => t.status === 'concluida' && /\bads\b/i.test(`${t.tipo_demanda} ${t.titulo}`)).map(diaDe).filter(x => x && x >= de90 && x <= hoje).sort()
  const ads = { gasto_28d_c: gasto?.n ? Math.round((gasto.c || 0) * 100) : null, tarefas_90d: adsT.length, ultima_tarefa: adsT.at(-1) || '' }

  // F9: caixa e lucro por produto (só com ML; o lucro só interessa com custo)
  let caixa = { disponivel: false, motivo: 'sem dados de pedidos do canal (sem integração de vendas)' }, margem = []
  if (ml.conectado) {
    try { const r = relatorioDoCliente(cliente, 'caixa', { hoje }); caixa = r.disponivel ? { disponivel: true, linhas: r.secoes[0]?.linhas || [] } : { disponivel: false, motivo: r.motivo } } catch { caixa = { disponivel: false, motivo: 'relatório de caixa indisponível nesta leitura' } }
    if (temCusto) { try { const r = relatorioDoCliente(cliente, 'lucro', { hoje }); margem = (r.secoes || []).find(s => s.chave === 'produto')?.linhas || [] } catch { margem = [] } }
  }

  // contrato, risco, execução
  const contrato = umaOuNull(h, 'contrato_cliente', 'SELECT inicio, fim, valor_mensal_centavos FROM contrato_cliente WHERE cliente = ?', cliente)
  const risco = tabela(h, 'risco_cliente') ? h.prepare("SELECT motivo, desde FROM risco_cliente WHERE cliente = ? AND estado = 'aberto' ORDER BY desde").all(cliente) : []
  const conc = tarefas.filter(t => t.status === 'concluida').map(diaDe).filter(x => x && x <= hoje)
  const porMes = new Map(); for (const x of conc) if (x >= addDias(hoje, -150).slice(0, 7)) porMes.set(x.slice(0, 7), (porMes.get(x.slice(0, 7)) || 0) + 1)
  const tar = { concluidas: tarefas.filter(t => t.status === 'concluida').length, nao_iniciadas: tarefas.filter(t => t.status === 'nao_iniciada').length,
    por_mes: [...porMes].sort().map(([mes, n]) => ({ mes, n })), ultima_conclusao: conc.sort().at(-1) || '',
    dependencia: tarefas.filter(t => t.status === 'dependencia_cliente').map(t => ({ titulo: t.titulo, desde: diaLocal(t.last_edited) })) }
  const promo = ml.conectado && tabela(h, 'meli_item_mudanca') ? h.prepare("SELECT COUNT(*) n FROM meli_item_mudanca WHERE cliente = ? AND campo = 'preco' AND fonte = 'promo' AND dia >= ?").get(cliente, de90).n : 0

  return { cliente, hoje, central, ml, contas_canal, contas_tarefas, custos, margem, marcos, promo_mudancas: promo, ads, caixa, promessas, atas_n: atas.length, contrato, risco, tarefas: tar }
}

export function raioXDoCliente(cliente, opts = {}) { const d = dadosGuardiao(cliente, opts); return { d, rx: raioX(d) } }

// pauta: JSON + texto + HTML (molde do dossiê) + auditoria (o mesmo crivo do texto ao cliente + culpa). PDF: quem chama passa o html ao gerarPdf.
export function pautaDoCliente(cliente, { data, hora = '16:00', hoje = hojeLocal(), rotulo = '' } = {}) {
  const { d, rx } = raioXDoCliente(cliente, { hoje })
  let nomes = []; try { nomes = nomesInternos(cliente) } catch { nomes = [] }
  const pauta = pautaReuniao(rx, d, { data, hora, rotulo: rotulo || d.central.rotulo, nomes })
  const texto = pautaTexto(pauta)
  return { pauta, texto, html: pautaHtml(pauta, { tokens: TOKENS }), auditoria: auditarPauta(texto, { nomesInternos: nomes, permitidos: [cliente, pauta.rotulo] }), rx }
}

// ── escrita local: decisão do preço (1 clique) e lojas do mesmo dono. Prévia por padrão; confirmar === true grava e registra no livro. Erros fixos (nunca ecoam o valor). ──
export function criarGuardiao({ h = db, livro = null, validarPor = () => '', agora = agoraDb, marcosDe = c => dadosGuardiao(c, { medirMax: 0, h }).marcos } = {}) {
  const txt = v => (typeof v === 'string' ? v.trim() : '')
  function decidir({ cliente, ref, decisor, por, confirmar = false } = {}) {
    if (!DECISORES.includes(decisor)) throw erro('decisor inválido: use cliente ou assessoria')
    const r = txt(ref); if (!r || r.length > 200) throw erro('referência da mudança de preço inválida')
    const marco = marcosDe(cliente).find(m => m.ref === r); if (!marco) throw erro('mudança de preço não encontrada para este cliente', 404)   // isolamento: só a lista do próprio cliente
    const quem = validarPor(txt(por), cliente); if (!quem) throw erro('informe o nome de um líder ou consultor', 403)
    const depois = decisorDe(marco, { decisor, por: quem, em: agora() })
    const out = { previa: confirmar !== true, cliente, ref: r, dia: marco.dia, produto: marco.produto, antes: marco.decisao, depois, medicao_inalterada: true,
      nota: 'A marcação muda só quem decidiu; a medição do efeito continua a mesma.' }
    if (confirmar !== true) return out
    const em = agora()
    h.prepare(`INSERT INTO preco_decisao (cliente, ref, decisor, por, em) VALUES (?,?,?,?,?) ON CONFLICT (cliente, ref) DO UPDATE SET decisor = excluded.decisor, por = excluded.por, em = excluded.em`).run(cliente, r, decisor, quem, em)
    try { livro?.registrar({ cliente, tipo: 'nota', ref: `preco_decisao:${r}:${em}`, fato_em: marco.dia, resumo: `Smith · mudança de preço de ${marco.dia} marcada como decisão ${decisor === 'cliente' ? 'do cliente' : 'da assessoria'} por ${quem}`, dados: { ref: r, decisor, por: quem } }) } catch { /* o livro nunca derruba a marcação */ }
    return { ...out, gravado: true, em }
  }
  function salvarConta({ cliente, canal, conta, nome_loja = '', grupo = '', por, remover = false, confirmar = false } = {}) {
    if (!CANAIS_CONTA.includes(canal)) throw erro('canal fora da lista permitida')
    const c = txt(conta), n = txt(nome_loja), g = txt(grupo)
    if (!c || c.length > 60 || n.length > 80 || g.length > 60) throw erro('conta, nome da loja ou grupo com tamanho inválido')
    const quem = validarPor(txt(por), cliente); if (!quem) throw erro('informe o nome de um líder ou consultor', 403)
    const atual = h.prepare('SELECT canal, conta, nome_loja, grupo FROM conta_canal WHERE cliente = ? AND canal = ? AND conta = ?').get(cliente, canal, c) || null
    const out = { previa: confirmar !== true, cliente, antes: atual, depois: remover === true ? null : { canal, conta: c, nome_loja: n, grupo: g } }
    if (confirmar !== true) return out
    if (remover === true) h.prepare('DELETE FROM conta_canal WHERE cliente = ? AND canal = ? AND conta = ?').run(cliente, canal, c)
    else h.prepare(`INSERT INTO conta_canal (cliente, canal, conta, nome_loja, grupo, por, em) VALUES (?,?,?,?,?,?,?) ON CONFLICT (cliente, canal, conta) DO UPDATE SET nome_loja = excluded.nome_loja, grupo = excluded.grupo, por = excluded.por, em = excluded.em`).run(cliente, canal, c, n, g, quem, agora())
    try { livro?.registrar({ cliente, tipo: 'nota', ref: `conta_canal:${canal}:${c}:${agora()}`, resumo: `Smith · loja ${remover === true ? 'removida' : 'cadastrada'}: ${canal} ${c} por ${quem}`, dados: { canal, conta: c, nome_loja: n, grupo: g, remover: remover === true } }) } catch { /* idem */ }
    return { ...out, gravado: true }
  }
  return { decidir, salvarConta }
}
