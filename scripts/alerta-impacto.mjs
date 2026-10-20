// AVISO DE ESTOQUE E PREÇO com impacto em R$ ao grupo do Mercado Livre (pedido do David, 14/10/2026). Texto e decisão: o MESMO pipeline dos gatilhos (src/lib/gatilhos.js →
// lote 'imediato': só cfg.urgente.tipos, impacto = previsão da regra do plano do item ou a mesma fórmula sobre o diagnóstico, 1 mensagem/dia com até 5 pontos, dedupe de 7 dias
// com piora, liberação automática pela regra registrada). Este script NÃO tem regra própria: só roda o pipeline sobre o universo e grava a prévia, ou envia o que foi aprovado.
//
// PADRÃO = PRÉVIA SÓ LEITURA: data/db.sqlite aberto READONLY e copiado para o banco em MEMÓRIA (PS_DB_MEMORIA=1, padrão do exemplos-etapa3); o urgente é SIMULADO ligado
// (urgente.na_hora_ligado = true só em memória); o grupo de quem ainda não tem WhatsApp configurado é lido da base Clientes do Notion (só leitura). Nada é enviado nem gravado
// no banco real. Grava <saida>/previa-AAAA-MM-DD.json (o que sairia AGORA) e .txt (mensagens com destino mascarado + pulados com motivo).
//   node scripts/alerta-impacto.mjs [--saida <pasta>]
// ENVIO (só depois de o David aprovar a prévia, NO MESMO DIA e dentro da janela 07:00–21:00): pelo pipeline dos gatilhos no banco real — avaliar → enviar({ tipo: 'imediato',
// confirmar: true, hash }) → lote gravado em gatilho_lote, recibo do n8n pela rota de recibo, livro de registro pelo tick do servidor (como o automático). Antes de cada envio,
// reconfere: sha256 do texto aprovado, cliente Ativo e não prospect, grupo (o MESMO do arquivo; quem não tinha grupo configurado ganha o da central pela regra automática),
// canal não desligado de propósito, integração ML, primeira coleta completa, cabeçalho do PRÓPRIO cliente e o hash do texto remontado agora (409 = mudou: pula). 5 s entre envios.
//   node scripts/alerta-impacto.mjs --enviar --confirmar --arquivo <previa.json> [--por "David do Valle"]
// RELATÓRIO do que saiu (só leitura): lotes de gatilho_lote (urgente e plano semanal) com itens, impacto e recibos, e o relatório focado do dia (data/relatorio-foco-envios.json).
//   node scripts/alerta-impacto.mjs --relatorio [--desde AAAA-MM-DD] [--saida <pasta>]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

export function lerArgs(argv) {
  const tem = f => argv.includes(f), val = f => { const i = argv.indexOf(f), v = i >= 0 ? argv[i + 1] || '' : ''; return v.startsWith('--') ? '' : v }
  const saida = val('--saida') || SAIDA_PADRAO
  if (tem('--relatorio')) return { modo: 'relatorio', desde: val('--desde'), saida }
  if (!tem('--enviar') && !tem('--confirmar') && !tem('--arquivo')) return { modo: 'previa', saida }
  if (!(tem('--enviar') && tem('--confirmar') && val('--arquivo'))) return { erro: 'o envio exige --enviar --confirmar --arquivo <previa.json> (nada foi enviado)' }
  return { modo: 'enviar', arquivo: val('--arquivo'), por: val('--por') || 'David do Valle' }
}
export const SAIDA_PADRAO = '/private/tmp/claude-501/-Users-davidvallejr/21ae2e63-2042-44b5-8fd0-58d5b00f4a31/scratchpad/alerta'
const FOCO_PREVIAS = '/private/tmp/claude-501/-Users-davidvallejr/21ae2e63-2042-44b5-8fd0-58d5b00f4a31/scratchpad/foco'
export const INTERVALO_MS = 5000
const ARGS = lerArgs(process.argv.slice(2)), PRINCIPAL = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (!PRINCIPAL || ARGS.modo !== 'enviar') process.env.PS_DB_MEMORIA = '1'     // prévia e relatório: o motor roda em memória; o banco real só é aberto READONLY
const { ROOT } = await import('../src/lib/env.js')
const { WHATS, lerConfig, validarConfig, impactoDaLinha } = await import('../src/lib/gatilhos.js')
const { faixaImpacto, dividirMensagem, lerCfgRelatorio } = await import('../src/lib/plano-semana-texto.js')
const BANCO = join(ROOT, 'data', 'db.sqlite'), REGISTRO_FOCO = join(ROOT, 'data', 'relatorio-foco-envios.json')
const CFG = lerConfig()
const sha = s => createHash('sha256').update(String(s), 'utf8').digest('hex')
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const ehProspecto = c => /^\s*\[Comercial\]/i.test(String(c ?? ''))
const parse = (s, pad) => { try { return JSON.parse(s || '') ?? pad } catch { return pad } }
export const mascarar = d => `…${String(d).slice(-9)}`
const brl = v => `R$ ${Math.round(v).toLocaleString('pt-BR')}`
export const porMotivo = l => l.reduce((m, p) => { const k = String(p.motivo).split(':')[0]; m[k] = (m[k] || 0) + 1; return m }, {})
// estado do WhatsApp na central AGORA (notificacao_json cru): configurado e ligado | desligado de propósito | grupo inválido | sem configuração (a regra automática lê a central)
export function whatsDe(json) {
  const w = parse(json, {})?.canais?.whatsapp, d = typeof w?.destino === 'string' ? w.destino.trim() : ''
  return !d ? { estado: 'auto' } : !WHATS.test(d) ? { estado: 'grupo_invalido' } : w.ligado === true ? { estado: 'ligado', destino: d } : { estado: 'canal_desligado' }
}

// ── banco real READONLY → banco em MEMÓRIA do db.js (linhas dos candidatos + tabelas globais pequenas). Copia gatilho_cliente e gatilho_lote: dedupe e teto do dia reais ──
function copiar(db, real, cand) {
  const GLOBAIS = ['sync_estado', 'analistas_oficiais', 'usuarios_notion', 'prestadores'], PULAR = new Set(['registro_cliente'])
  const cols = (h, t) => h.prepare(`PRAGMA table_info("${t}")`).all().map(c => c.name)
  const tabsReal = new Set(real.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name)), lista = JSON.stringify(cand)
  db.transaction(() => {
    for (const { name: t } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
      if (!tabsReal.has(t) || PULAR.has(t)) continue
      const cr = new Set(cols(real, t)), comuns = cols(db, t).filter(c => cr.has(c)); if (!comuns.length) continue
      const sel = `SELECT ${comuns.map(c => `"${c}"`).join(',')} FROM "${t}"`
      const rows = comuns.includes('cliente') ? real.prepare(`${sel} WHERE cliente IN (SELECT value FROM json_each(?))`).all(lista) : GLOBAIS.includes(t) ? real.prepare(sel).all() : []
      const ins = db.prepare(`INSERT OR IGNORE INTO "${t}" (${comuns.map(c => `"${c}"`).join(',')}) VALUES (${comuns.map(() => '?').join(',')})`)
      for (const r of rows) ins.run(...comuns.map(c => r[c]))
    }
  })()
}

// itens de um lote (linhas de gatilho_cliente) → [{ tipo, rotulo, produtos, impacto }]; títulos pelo meli_item do cliente
function itensDoLote(h, cliente, ids) {
  const selG = h.prepare('SELECT id, tipo, itens_json FROM gatilho_cliente WHERE id = ? AND cliente = ?'), selT = h.prepare('SELECT titulo FROM meli_item WHERE cliente = ? AND item_id = ?')
  return ids.map(id => selG.get(id, cliente)).filter(Boolean).map(r => {
    const its = parse(r.itens_json, []).filter(x => x && !x.avisado), imp = impactoDaLinha(its)     // avisado:true = dito há pouco, ficou fora do texto
    return { tipo: r.tipo, rotulo: CFG.gatilhos[r.tipo]?.rotulo || r.tipo, produtos: its.slice(0, 5).map(x => selT.get(cliente, String(x.id ?? x.item_id ?? ''))?.titulo || '').filter(Boolean), n_produtos: its.length, impacto: imp }
  })
}

export function textoPrevia(p) {
  // o total soma pontos com prazos diferentes (zerado 7 d, ruptura = prazo de reposição, compra = prazo + folga): a prévia diz isso (achado de 14/10)
  const dd = [...new Set(p.itens.flatMap(x => x.itens.map(i => i.impacto?.dias)).filter(Number.isFinite))].sort((a, b) => a - b)
  const tot = p.total ? ` · total em jogo ${faixaImpacto(p.total)}${dd.length > 1 ? ` (soma de prazos diferentes por ponto: ${dd.join(', ')} dias)` : dd.length ? ` em ${dd[0]} dias` : ''}` : ''
  const cab = `PRÉVIA (só leitura; NADA foi enviado) · Aviso de estoque e preço com impacto · ${p.data} ${p.hora}\nSairiam agora: ${p.itens.length} mensagem(ns)${tot} · itens por tipo ${JSON.stringify(p.por_tipo)}\n` +
    `Pulados: ${p.pulados.length} ${JSON.stringify(porMotivo(p.pulados))}\nEnvio (aprovado, mesmo dia, 07:00–21:00): node scripts/alerta-impacto.mjs --enviar --confirmar --arquivo <este .json>\n${'='.repeat(100)}`
  const msgs = p.itens.map((x, k) => `──────── ${k + 1}/${p.itens.length} · ${x.cliente}${x.rotulo !== x.cliente ? ` (rótulo «${x.rotulo}»)` : ''} · destino ${mascarar(x.destino)}${x.auto ? ' (grupo da central, regra automática)' : ''} · ${x.caracteres} caracteres · ${x.n_partes} mensagem(ns) ────────\n` +
    x.itens.map(i => `  ITEM ${i.tipo}: ${i.produtos.slice(0, 3).join(' | ')}${i.n_produtos > 3 ? ` (+${i.n_produtos - 3})` : ''} · impacto ${i.impacto ? `${brl(i.impacto.c)} a ${brl(i.impacto.b)} em ${i.impacto.dias} d (${i.impacto.fonte})` : 'sem número'}`).join('\n') +
    `${x.resto ? `\n  + ${x.resto} ponto(s) para o próximo aviso` : ''}\n  TOTAL ${x.total ? `${brl(x.total.c)} a ${brl(x.total.b)}` : '—'}\n\n${x.texto}`)
  const pul = p.pulados.length ? `${'='.repeat(100)}\nPULADOS\n` + p.pulados.map(x => `• ${x.cliente}: ${x.motivo}`).join('\n') : ''
  return [cab, ...msgs, pul].filter(Boolean).join('\n\n') + '\n'
}

async function previa({ saida }) {
  const { default: Database } = await import('better-sqlite3')
  const { db, hojeLocal } = await import('../src/lib/db.js')
  if (db.name !== ':memory:') throw new Error('abriu o banco real em escrita')
  await import('../src/lib/promocoes-db.js')
  const GR = await import('../src/lib/gatilhos-real.js')
  const real = new Database(BANCO, { readonly: true, fileMustExist: true })
  const st = new Set(CFG.status_elegiveis.map(norm))
  const ativos = real.prepare('SELECT cliente, status_cs AS status, notificacao_json FROM clientes_central').all().filter(r => r.cliente && !ehProspecto(r.cliente) && st.has(norm(r.status)))
  const comMl = new Set([...real.prepare('SELECT DISTINCT cliente FROM meli_contas').all(), ...real.prepare('SELECT DISTINCT cliente FROM meli_coleta_dia').all()].map(r => r.cliente))
  const cand = ativos.filter(r => comMl.has(r.cliente)).map(r => r.cliente), pulados = ativos.filter(r => !comMl.has(r.cliente)).map(r => ({ cliente: r.cliente, motivo: 'sem_integracao:sem_conexao_ml' }))
  const antes = new Map(ativos.map(r => [r.cliente, whatsDe(r.notificacao_json)]))
  copiar(db, real, cand); real.close()
  // o urgente SIMULADO ligado (só em memória): o resto do config é o real
  const c0 = JSON.parse(JSON.stringify(lerConfig())); c0.urgente.na_hora_ligado = true
  const g = GR.criarGatilhosReal({ cfg: validarConfig(c0), envio: null, clienteCanonico: nome => cand.find(c => c === nome) || '' })
  const auto = await g.autoLiberar({ gravar: true })                         // em memória: o grupo da central de quem não tinha WhatsApp configurado (Notion só leitura)
  const semGrupo = new Set(auto.sem_grupo), naoLido = new Map(auto.nao_lidos.map(x => [x.cliente, x.motivo]))
  const itens = [], data = hojeLocal(), R = lerCfgRelatorio()
  for (const c of [...cand].sort((a, b) => a.localeCompare(b, 'pt-BR'))) {
    const w = antes.get(c)
    if (w.estado === 'canal_desligado' || w.estado === 'grupo_invalido') { pulados.push({ cliente: c, motivo: w.estado }); continue }
    const i = g.integracao(c); if (!i.ok) { pulados.push({ cliente: c, motivo: `sem_integracao:${i.motivo}` }); continue }
    if (w.estado === 'auto' && semGrupo.has(c)) { pulados.push({ cliente: c, motivo: 'sem_grupo_ml_na_central' }); continue }
    if (w.estado === 'auto' && naoLido.has(c)) { pulados.push({ cliente: c, motivo: `central_nao_lida:${naoLido.get(c)}` }); continue }
    let l
    try { await g.avaliar(c); l = g.montarLote(c, 'imediato', { gravar: false }) } catch (e) { pulados.push({ cliente: c, motivo: `erro:${String(e?.name || 'Error')}` }); continue }
    const e = g.elegivel(c, { tipo: 'imediato' })
    if (!e.ok && e.motivo !== 'fora_da_janela') { pulados.push({ cliente: c, motivo: e.motivo }); continue }
    if (l.bloqueado) { pulados.push({ cliente: c, motivo: `bloqueado:${l.motivo}` }); continue }
    if (l.vazio || !l.texto_final) { pulados.push({ cliente: c, motivo: 'nada_de_estoque_ou_preco_agora' }); continue }
    if (l.teto_dia) { pulados.push({ cliente: c, motivo: 'teto_diario' }); continue }
    const n = g.notificacao(c)
    itens.push({ cliente: c, rotulo: g.rotulo(c), destino: n.canais.whatsapp.destino, auto: w.estado === 'auto', fora_da_janela: !e.ok, lote_id: l.id, hash: l.hash, sha256: sha(l.texto_final), texto: l.texto_final,
      caracteres: l.texto_final.length, n_partes: dividirMensagem(l.texto_final, { max: R.whatsapp_max_caracteres, continua: R.continua }).length, total: l.total || null, resto: l.resto || 0,
      itens: itensDoLote(db, c, l.itens.map(x => x.id)) })
  }
  itens.sort((a, b) => (b.total?.b ?? 0) - (a.total?.b ?? 0))
  const por_tipo = itens.flatMap(x => x.itens).reduce((m, i) => { m[i.tipo] = (m[i.tipo] || 0) + 1; return m }, {})
  const soma = k => itens.reduce((t, x) => t + (x.total?.[k] ?? 0), 0)
  const p = { gerado_em: new Date().toISOString(), data, hora: new Date().toLocaleTimeString('pt-BR', { timeZone: CFG.fuso_padrao, hour: '2-digit', minute: '2-digit' }), modo: 'previa',
    simulado: 'urgente.na_hora_ligado = true só em memória; nada enviado nem gravado no banco real', auto_liberacao: { preenchidos: auto.preenchidos, sem_grupo: auto.sem_grupo, nao_lidos: auto.nao_lidos },
    total: itens.some(x => x.total) ? { c: soma('c'), b: soma('b') } : null, por_tipo, itens, pulados }
  mkdirSync(saida, { recursive: true })
  const arq = join(saida, `previa-${data}.json`), txt = join(saida, `previa-${data}.txt`)
  writeFileSync(arq, JSON.stringify(p, null, 1)); writeFileSync(txt, textoPrevia(p))
  console.log(JSON.stringify({ data, sairiam: itens.length, total: p.total ? faixaImpacto(p.total) : null, por_tipo, pulados: porMotivo(pulados), auto_liberados: auto.preenchidos.length, json: arq, txt }, null, 1))
}

// ── envio do que foi APROVADO, pelo pipeline dos gatilhos no banco real (sem regerar texto: o hash precisa bater) ──
// desfazer(c, json): devolve o notificacao_json de antes quando a liberação automática foi gravada e o envio NÃO saiu (achado de 14/10: o pulado ficava liberado no banco real)
export async function enviarItens({ previa, hoje, g, centralDe, horaOk, por, esperar = ms => new Promise(r => setTimeout(r, ms)), intervaloMs = INTERVALO_MS, status = CFG.status_elegiveis, desfazer = () => {} }) {
  const enviados = [], pulados = [], st = new Set(status.map(norm)), pula = (cliente, motivo) => pulados.push({ cliente, motivo })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(previa?.data || '')) || !Array.isArray(previa?.itens)) throw new Error('arquivo de prévia inválido')
  if (previa.data !== hoje) throw new Error('prévia vencida (é de outro dia): gere de novo; nada foi enviado')
  let postou = false
  for (const x of previa.itens) {
    const c = typeof x?.cliente === 'string' ? x.cliente.trim() : '', texto = typeof x?.texto === 'string' ? x.texto : ''
    if (!c || ehProspecto(c) || !texto.trim() || texto.length > 8000 || !WHATS.test(String(x.destino)) || !/^[0-9a-f]{16}$/.test(String(x.hash))) { pula(c, 'item_invalido'); continue }
    if (sha(texto) !== x.sha256) { pula(c, 'hash_divergente'); continue }
    const row = centralDe(c)
    if (!row || !st.has(norm(row.status))) { pula(c, 'status_inelegivel'); continue }
    const w = whatsDe(row.notificacao_json)
    if (w.estado === 'canal_desligado' || w.estado === 'grupo_invalido') { pula(c, w.estado); continue }
    if (w.estado === 'ligado' && w.destino !== x.destino) { pula(c, 'destino_divergente'); continue }
    // janela, cabeçalho e hash conferidos ANTES de gravar qualquer coisa no banco real; a liberação automática só é gravada logo antes do envio e desfeita se ele não sair
    if (!horaOk(c)) { pula(c, 'fora_da_janela'); continue }
    if (!texto.startsWith(`Oi, time ${g.rotulo(c)}!`)) { pula(c, 'cabecalho_divergente'); continue }
    let r, liberou = false
    try {
      await g.avaliar(c)
      if (g.montarLote(c, 'imediato', { gravar: false }).hash !== x.hash) { pula(c, 'hash_divergente'); continue }
      if (w.estado === 'auto') {                                                // a regra automática grava o grupo da central (o MESMO da prévia)
        liberou = (await g.autoLiberar({ so: [c] })).preenchidos.includes(c)
        if (!liberou || g.notificacao(c).canais.whatsapp.destino !== x.destino) throw Object.assign(new Error('destino'), { motivo: 'destino_divergente' })
      }
      if (postou) await esperar(intervaloMs)
      r = await g.enviar({ cliente: c, tipo: 'imediato', por, confirmar: true, hash: x.hash }); postou = true
    } catch (e) { r = { ok: false, pulo: e?.motivo || (e?.status === 409 ? 'hash_divergente' : `erro:${String(e?.name || 'Error')}`) } }
    if (!r?.ok) { if (liberou) desfazer(c, row.notificacao_json); pula(c, r?.pulo || `falhou:${r?.motivo || r?.estado || 'erro'}`); continue }
    enviados.push({ cliente: c, lote_id: r.lote_id, estado: r.estado })
  }
  return { enviados, pulados }
}

async function enviarArquivo({ arquivo, por }) {
  const previaJson = JSON.parse(readFileSync(arquivo, 'utf-8'))
  const { db, hojeLocal } = await import('../src/lib/db.js')
  if (db.name === ':memory:') throw new Error('o envio precisa do banco real')
  db.pragma('busy_timeout = 30000')
  const { criarGatilhosReal } = await import('../src/lib/gatilhos-real.js')
  const { horaNoFuso } = await import('../src/lib/relatorio-envio.js')
  const { dentroDaJanela } = await import('../src/lib/gatilhos.js')
  const selCentral = db.prepare('SELECT status_cs AS status, notificacao_json FROM clientes_central WHERE cliente = ?'), nomes = db.prepare('SELECT cliente FROM clientes_central').all().map(r => r.cliente)
  const g = criarGatilhosReal({ clienteCanonico: nome => nomes.find(c => c === nome) || '' })      // config REAL, envio REAL (n8n)
  const horaOk = c => { const n = g.notificacao(c); return dentroDaJanela(horaNoFuso(Date.now(), n.fuso), { janela: CFG.janela, silencio: n.silencio }) }
  const desfazer = (c, json) => db.prepare('UPDATE clientes_central SET notificacao_json = ? WHERE cliente = ?').run(json, c)
  const r = await enviarItens({ previa: previaJson, hoje: hojeLocal(), g, centralDe: c => selCentral.get(c) || null, horaOk, por, desfazer })
  console.log(JSON.stringify({ enviados: r.enviados.length, pulados: porMotivo(r.pulados), detalhe: r }, null, 1))   // sem segredo, sem destino
}

// produtos citados no 📦 do relatório focado: distintos pelo nome (o focado resolve o nome contra a conta inteira; nome repetido = anúncios diferentes, separados pelo MLB do
// link) e a soma dos «e mais N» (pode repetir produto de outra lista do bloco: fica separada). Achado de 14/10: a tabela contava LINHAS (repetia produto, ignorava «e mais N»)
export function produtosEstoque(texto) {
  const ls = (String(texto).split('📦 *Estoque e ruptura*\n')[1]?.split('\n\n')[0] || '').split('\n'), nomes = new Map()
  let e_mais = 0
  ls.forEach((l, k) => {
    const em = /^• e mais (\d+)/.exec(l); if (em) { e_mais += Number(em[1]); return }
    if (!l.startsWith('• ')) return
    const nome = l.slice(2).split(': ')[0].replace(/ \(Full\)$/, '').trim().toLowerCase(), mlb = /^\s+https?:\/\/\S*?MLB-?(\d+)/.exec(ls[k + 1] || '')?.[1]
    const s = nomes.get(nome) || nomes.set(nome, new Set()).get(nome); if (mlb) s.add(mlb)
  })
  return { nomeados: [...nomes.values()].reduce((t, s) => t + Math.max(1, s.size), 0), e_mais }
}

// ── relatório do que SAIU (só leitura): gatilho_lote (urgente e plano semanal) + o relatório focado do dia ──
async function relatorio({ desde, saida }) {
  const { default: Database } = await import('better-sqlite3')
  const { hojeLocal } = await import('../src/lib/db.js')
  const h = new Database(BANCO, { readonly: true, fileMustExist: true })
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(String(desde)) ? desde : hojeLocal()
  const hora = iso => iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: CFG.fuso_padrao, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
  const lotes = h.prepare("SELECT * FROM gatilho_lote WHERE dia >= ? AND estado <> 'montado' ORDER BY criado_em").all(dia).map(l => {
    const itens = itensDoLote(h, l.cliente, parse(l.itens_ids_json, [])), com = itens.filter(i => i.impacto)
    return { cliente: l.cliente, tipo: l.tipo, dia: l.dia, enviado: hora(l.enviado_em || l.tentado_em), estado: l.estado, motivo: l.motivo, origem: l.origem, por: l.por, canais: parse(l.canais_json, []),
      recibos: Object.fromEntries(Object.entries(parse(l.recibos_json, {})).map(([k, v]) => [k, v?.estado || ''])), caracteres: l.texto_final.length, itens,
      total: com.length ? { c: com.reduce((t, i) => t + i.impacto.c, 0), b: com.reduce((t, i) => t + i.impacto.b, 0) } : null }
  })
  const reg = existsSync(REGISTRO_FOCO) ? JSON.parse(readFileSync(REGISTRO_FOCO, 'utf-8')) : {}
  const previaFoco = d => { const f = join(FOCO_PREVIAS, `previa-${d}.json`); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf-8')) : null }
  const livro = h.prepare("SELECT ref FROM registro_cliente WHERE tipo = 'relatorio_enviado' AND ref = ?")
  const foco = Object.entries(reg).filter(([, v]) => String(new Date(v.enviado_em).toLocaleDateString('sv-SE', { timeZone: CFG.fuso_padrao })) >= dia).map(([lote_id, v]) => {
    const d = new Date(v.enviado_em).toLocaleDateString('sv-SE', { timeZone: CFG.fuso_padrao }), x = previaFoco(d)?.itens?.find(i => i.cliente === v.cliente && sha(i.texto) === v.hash)
    return { cliente: v.cliente, enviado: hora(v.enviado_em), estado: 'aceito pelo n8n (sem recibo de entrega)', no_livro: !!livro.get(`foco:${lote_id}`), caracteres: x?.chars ?? null,
      secoes: x ? x.secoes.filter(s => s.conteudo).map(s => s.chave) : null, produtos_estoque: x ? produtosEstoque(x.texto) : null, conferido_com_previa: !!x }
  }).sort((a, b) => a.enviado.localeCompare(b.enviado))
  h.close()
  const out = { gerado_em: new Date().toISOString(), desde: dia, gatilhos: { lotes: lotes.length, por_tipo: lotes.reduce((m, l) => { m[l.tipo] = (m[l.tipo] || 0) + 1; return m }, {}), lista: lotes },
    relatorio_focado: { enviados: foco.length, lista: foco } }
  mkdirSync(saida, { recursive: true })
  const arq = join(saida, `relatorio-${dia}.json`); writeFileSync(arq, JSON.stringify(out, null, 1))
  const txt = [`ENVIADOS desde ${dia} (só leitura)`, `Avisos dos gatilhos (gatilho_lote): ${lotes.length}`, ...lotes.map(l => `• ${l.enviado} · ${l.cliente} · ${l.tipo} · ${l.estado}${l.motivo ? ` (${l.motivo})` : ''} · recibos ${JSON.stringify(l.recibos)} · ${l.itens.map(i => `${i.tipo}${i.impacto ? ` ${brl(i.impacto.c)}–${brl(i.impacto.b)}` : ''}`).join('; ')}${l.total ? ` · total ${brl(l.total.c)}–${brl(l.total.b)}` : ''}`),
    '', `Relatório focado (estoque, ações e resultados): ${foco.length}`, ...foco.map(f => `• ${f.enviado} · ${f.cliente} · ${f.estado}${f.no_livro ? ' · no livro' : ''}${f.secoes ? ` · seções ${f.secoes.join(', ')} · estoque: ${f.produtos_estoque.nomeados} produto(s) com nome${f.produtos_estoque.e_mais ? ` + ${f.produtos_estoque.e_mais} em «e mais N»` : ''} · ${f.caracteres} caracteres` : ''}`)].join('\n') + '\n'
  writeFileSync(arq.replace(/\.json$/, '.txt'), txt)
  console.log(txt + `\n${arq}`)
}

if (PRINCIPAL) {
  if (ARGS.erro) { console.error(ARGS.erro); process.exit(2) }
  await (ARGS.modo === 'enviar' ? enviarArquivo(ARGS) : ARGS.modo === 'relatorio' ? relatorio(ARGS) : previa(ARGS))
}
