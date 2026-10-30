// PLANO DE CICLO DE COMPRAS ao TIME no canal do cliente no Discord (pedido do David, 30/10/2026: «traz os planos de ciclos no Discord de cada cliente pro consultor saber
// o que falar e explica os dados — compras, reposição, data de ruptura na previsão — e a estratégia que fará a recuperação de receita»).
// Projeção, nunca segundo motor: os MESMOS itens do micro-relatório de compras (itensMicroCompras sobre o diagnóstico + preverCompras) e as ações do plano já abertas
// para esses anúncios. Canal INTERNO (o cliente não vê). Grava em consultor_aviso (tipo interno_imediato, chave ciclo_compras) e entrega pelo enviarInterno do n8n.
//   node scripts/ciclos-discord.mjs [--cliente "<nome>"]                → PRÉVIA (nada sai): <scratchpad>/ciclos-discord-AAAA-MM-DD.txt
//   node scripts/ciclos-discord.mjs --enviar --confirmar [--cliente "<nome>"]
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
const argv = process.argv.slice(2), tem = f => argv.includes(f), val = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] || '' : '' }
const ENVIAR = tem('--enviar') && tem('--confirmar'), SO = val('--cliente')
const SAIDA = '/private/tmp/claude-501/-Users-davidvallejr/21ae2e63-2042-44b5-8fd0-58d5b00f4a31/scratchpad/micro'

const { db, hojeLocal, agora, log } = await import('../src/lib/db.js')
const { diagnosticarConta, algoritmo } = await import('../src/lib/diagnostico-conta.js')
const { comprasDoCliente } = await import('../src/lib/gatilhos-real.js')
const { itensMicroCompras } = await import('../src/lib/plano-semana-texto.js')
const { lerConfig } = await import('../src/lib/gatilhos.js')
const { SCHEMA_CONSULTOR, dividirDiscord, mencoesTime, comMencoes, lerTime, semMarcacao, RESERVA_MENCAO } = await import('../src/lib/consultor-discord.js')

const L = algoritmo.limiares, folga = L.estoque_seguranca_dias, hoje = hojeLocal(), CFG = lerConfig()
const sha = s => createHash('sha256').update(String(s), 'utf8').digest('hex').slice(0, 16)
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const brl = v => 'R$ ' + Math.round(Number(v) || 0).toLocaleString('pt-BR')
const dm = iso => `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}`
const mais = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const nome = t => String(t || '').replace(/\s+/g, ' ').trim().split(' ').slice(0, 8).join(' ')
const faixa = (c, b) => brl(c) === brl(b) ? brl(b) : `${brl(c)} a ${brl(b)}`

const st = new Set(CFG.status_elegiveis.map(norm)), comMl = new Set(db.prepare('SELECT DISTINCT cliente FROM meli_contas').all().map(r => r.cliente))
const clientes = db.prepare('SELECT cliente, status_cs FROM clientes_central').all()
  .filter(r => r.cliente && !/^\s*\[Comercial\]/i.test(r.cliente) && st.has(norm(r.status_cs)) && comMl.has(r.cliente) && (!SO || r.cliente === SO)).map(r => r.cliente).sort((a, b) => a.localeCompare(b, 'pt-BR'))
const acoesDe = db.prepare("SELECT item_id, titulo, status FROM acoes_plano WHERE cliente = ? AND status IN ('proposta','aprovada','distribuida')")

// ── texto ao consultor (puro sobre os itens) ──
function montar(c, itens, compras, acoes) {
  const porId = new Map((compras?.itens || []).map(x => [String(x.id), x]))
  const l = [...itens].sort((a, b) => (['A', 'B'].includes(a.curva) ? 0 : 1) - (['A', 'B'].includes(b.curva) ? 0 : 1) || (b.impacto?.b ?? -1) - (a.impacto?.b ?? -1)).slice(0, 8)
  const com = itens.filter(i => i.impacto?.b > 0), total = com.length ? { c: com.reduce((t, i) => t + i.impacto.c, 0), b: com.reduce((t, i) => t + i.impacto.b, 0) } : null
  const zerados = l.filter(i => i.estoque === 0), premissa = l.some(i => (porId.get(i.id)?.lead_time?.fonte || 'premissa') === 'premissa')
  const linhas = l.map(i => {
    const p = porId.get(i.id), v = p?.vendas_dia_28d, q = p?.quanto_pedir, rupt = i.estoque === 0 ? '**já sem estoque**' : i.cobertura != null ? `ruptura prevista **${dm(mais(hoje, i.cobertura))}** (~${i.cobertura} dias)` : 'ruptura: —'
    const pedir = i.origem === 'pedir_ate' && i.pedir_ate ? `pedir até **${dm(i.pedir_ate)}**` : '**pedir agora**'
    const qt = q ? `${q.conservador === q.base ? q.base : `${q.conservador}–${q.base}`} un (cobre ${q.cobre_dias} dias)` : 'quantidade: —'
    const perdaDia = i.estoque === 0 && p?.receita_28d ? ` · parado perde ~${brl(p.receita_28d / 28)}/dia` : ''
    return `• **${nome(i.titulo)}** (${i.id}${i.curva ? ` · curva ${i.curva}` : ''}${i.full ? ' · Full' : ''}${i.preco != null ? ` · ${brl(i.preco)}` : ''})\n` +
      `  Estoque ${i.estoque ?? '—'} un · vende ${v != null ? String(Math.round(v * 10) / 10).replace('.', ',') : '—'} un/dia · ${rupt}\n` +
      `  Compra: ${pedir} · ${qt} · reposição ${i.lead} dias${(p?.lead_time?.fonte || 'premissa') === 'premissa' ? ' (premissa)' : ''}\n` +
      `  Em jogo: ${i.impacto?.b > 0 ? `−${faixa(i.impacto.c, i.impacto.b)} em ${i.impacto.dias} dias` : 'sem perda estimada se pedir no prazo'}${perdaDia}`
  })
  const ids = new Set(l.map(i => i.id)), plano = acoes.filter(a => ids.has(String(a.item_id))).slice(0, 4).map(a => `• ${String(a.titulo).replace(/\s*·\s*PS-[0-9a-f]+$/i, '')} (${a.status})`)
  const est = [
    `1. **Confirmar com o cliente:** estoque fora do ML e pedido já feito ao fornecedor (o sistema não vê nenhum dos dois)${premissa ? `; perguntar o **prazo real do fornecedor** — hoje usamos ${L.lead_time_reposicao_dias} dias de premissa` : ''}.`,
    `2. **Fechar a data do pedido** pela coluna «pedir»: quem está em «pedir agora» já passou do ponto (prazo + ${folga} dias de folga).`,
    zerados.length ? `3. **Enquanto não chega:** nos ${zerados.length} anúncio(s) sem estoque, segurar Ads/promoção (gasto sem venda) e puxar o tráfego para anúncios do cliente que têm estoque.` : '3. **Enquanto não chega:** não acelerar Ads/promoção nos itens perto da ruptura; a verba vai para quem tem estoque.',
    `4. **Quando chegar:** reativar, enviar ao Full quando for o caso e conferir o anúncio no ar — a recuperação começa no dia em que o estoque volta.`,
  ]
  const txt = [
    `**🛒 Arquiteto · plano de ciclo de compras · ${c} · Mercado Livre · ${dm(hoje)}**`,
    `Para o consultor conduzir a conversa de compras com o cliente (o cliente não vê este canal).${total ? `\n💰 **Receita a proteger:** ${faixa(total.c, total.b)} nos próximos ${[...new Set(com.map(i => i.impacto.dias))].join('/')} dias se a reposição não acontecer${itens.length > l.length ? ` (todos os ${itens.length} produtos; abaixo os 8 maiores)` : ''}.` : ''}`,
    `**📦 Produtos do ciclo (${l.length}${itens.length > l.length ? ` de ${itens.length}` : ''})**\n` + linhas.join('\n'),
    `**🔁 Estratégia de recuperação de receita**\n` + est.join('\n') + (plano.length ? `\nNo plano para esses anúncios:\n${plano.join('\n')}` : ''),
    `_Oráculo · ritmo médio dos últimos 28 dias; quantidade = conservador–base (base com tendência e datas comerciais); estimativa, não promessa. Detalhe em /cliente › Empresa do cliente › Compras._`,
  ].join('\n\n')
  return { texto: semMarcacao(txt), total, n: l.length }
}

const resultados = []
for (const c of clientes) {
  const diag = diagnosticarConta(c); if (!diag?.disponivel) continue
  const compras = comprasDoCliente(c, { diag }), r = itensMicroCompras(diag, compras, { limiares: L, ciclo_dias: algoritmo.compras.ciclo_compra_dias })
  if (!r.disponivel || !r.itens.length) continue
  resultados.push({ cliente: c, ...montar(c, r.itens, compras, acoesDe.all(c)) })
}
resultados.sort((a, b) => (b.total?.b ?? 0) - (a.total?.b ?? 0))

if (!ENVIAR) {
  mkdirSync(SAIDA, { recursive: true })
  const arq = join(SAIDA, `ciclos-discord-${hoje}.txt`)
  writeFileSync(arq, `PRÉVIA (nada enviado) · ${resultados.length} cliente(s)\n\n` + resultados.map(r => `════ ${r.cliente} · ${r.texto.length} caracteres\n${r.texto}`).join('\n\n'))
  console.log(JSON.stringify({ clientes: resultados.map(r => ({ cliente: r.cliente, produtos: r.n, em_jogo: r.total ? faixa(r.total.c, r.total.b) : '—' })), arquivo: arq }, null, 1))
  process.exit(0)
}

// ── envio: destino lido da central (Webhook ML + Discord ID Consultor ML), menções do time, 1 linha por cliente por dia em consultor_aviso ──
const { env } = await import('../src/lib/env.js')
const { criarEnvio } = await import('../src/lib/gatilhos-envio.js')
const { buscarDestinos } = await import('../src/lib/gatilhos-destinos-notion.js')
db.exec(SCHEMA_CONSULTOR)
const envio = criarEnvio({ env, agora, webhook: CFG.webhook, log }), time = lerTime(), cfgC = CFG.consultor
const ins = db.prepare("INSERT OR IGNORE INTO consultor_aviso (id, cliente, tipo, chave, dia, texto, partes_json, hash, estado, criado_em) VALUES (?, ?, 'interno_imediato', 'ciclo_compras', ?, ?, ?, ?, 'montado', ?)")
const upd = db.prepare('UPDATE consultor_aviso SET estado = ?, motivo = ?, tentado_em = ?, enviado_em = ?, mencao = ? WHERE id = ?')
const saida = []
for (const r of resultados) {
  const id = sha(`consultor|${r.cliente}|ciclo_compras|${hoje}`), ja = db.prepare('SELECT estado FROM consultor_aviso WHERE id = ?').get(id)
  if (['enviado', 'entregue'].includes(ja?.estado)) { saida.push({ cliente: r.cliente, estado: 'ja_enviado_hoje' }); continue }
  const d = await buscarDestinos(r.cliente), dest = d.achado ? d.destinos.interno : null
  if (!dest?.discord) { saida.push({ cliente: r.cliente, estado: 'sem_webhook_ml', motivo: d.motivo || '' }); continue }
  const partes = dividirDiscord(r.texto, (cfgC?.discord_max_chars || 1900) - RESERVA_MENCAO), m = mencoesTime(time, dest.consultor)
  ins.run(id, r.cliente, hoje, r.texto, JSON.stringify(partes), sha(r.texto), agora())
  const res = await envio.enviarInterno({ lote: { id, tipo: 'interno_imediato', cliente: r.cliente, assunto: `Plano de ciclo de compras · ${dm(hoje)}/${hoje.slice(0, 4)}` }, destino: dest.discord, partes: comMencoes(partes, m.prefixo), mencionar: m.users, mencionarCargos: m.roles })
  upd.run(res.estado, res.motivo || '', agora(), res.estado === 'enviado' ? agora() : '', m.users.length ? 1 : 0, id)
  saida.push({ cliente: r.cliente, estado: res.estado, motivo: res.motivo || '', partes: partes.length, consultor_marcado: m.users.length > 0 })
  await new Promise(ok => setTimeout(ok, 1500))
}
console.log(JSON.stringify(saida, null, 1))   // sem webhook nem id
