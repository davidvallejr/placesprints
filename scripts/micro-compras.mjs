// MICRO-RELATÓRIO DE COMPRAS ao grupo do Mercado Livre (pedido do David, 15/10/2026: «tudo que depende de solicitação do cliente, um micro relatório simples em linhas com o MLB,
// título, preço de venda e o quanto iremos perder de faturamento se o ciclo de compras não acontecer… por WhatsApp»; e «não precisa esperar entrar no plano»).
// Itens DIRETO do diagnóstico do dia (itensMicroCompras: ruptura / abaixo do ponto + «pedir agora / até dd/mm» da previsão de compras), sem depender de ação no plano,
// aprovação ou Notion; texto montarMicroCompras (src/lib/plano-semana-texto.js). Envio pelo MESMO pipeline dos gatilhos (lote 'compras' em gatilho_lote, recibo do n8n,
// livro pelo tick do servidor, teto de 1/dia, produtos ditos → gatilho_avisado). Este script não tem regra própria.
//
// PADRÃO = PRÉVIA SÓ LEITURA (molde do alerta-impacto): data/db.sqlite READONLY → banco em MEMÓRIA (PS_DB_MEMORIA=1); grupo de quem não tem WhatsApp configurado lido da
// base Clientes do Notion (só leitura, regra automática). Grava <saida>/previa-AAAA-MM-DD[-ignorar-24h].json e .txt (destino mascarado). Nada é enviado nem gravado no banco real.
//   node scripts/micro-compras.mjs [--ignorar-24h] [--saida <pasta>]
// Regra das 24 h: cliente que recebeu aviso de estoque nas últimas 24 h com os MESMOS produtos e sem piora (gatilho_avisado) é pulado (motivo avisado_24h); --ignorar-24h não pula.
// ENVIO (aprovado, mesmo dia, 07:00–21:00): node scripts/micro-compras.mjs --enviar --confirmar --arquivo <previa.json> [--por "David do Valle"]
//   reconfere sha256, cliente Ativo/não prospect, grupo igual ao do arquivo, canal, janela, cabeçalho, a regra das 24 h (salvo prévia --ignorar-24h) e o hash do texto
//   remontado agora (mudou = pula); depois enviar({ tipo: 'compras', confirmar: true, hash, compor }) — sem passar por aprovação de ação do plano. 5 s entre envios.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

export const SAIDA_PADRAO = '/private/tmp/claude-501/-Users-davidvallejr/21ae2e63-2042-44b5-8fd0-58d5b00f4a31/scratchpad/micro'
export const INTERVALO_MS = 5000
export function lerArgs(argv) {
  const tem = f => argv.includes(f), val = f => { const i = argv.indexOf(f), v = i >= 0 ? argv[i + 1] || '' : ''; return v.startsWith('--') ? '' : v }
  if (!tem('--enviar') && !tem('--confirmar') && !tem('--arquivo')) return { modo: 'previa', saida: val('--saida') || SAIDA_PADRAO, ignorar24: tem('--ignorar-24h') }
  if (!(tem('--enviar') && tem('--confirmar') && val('--arquivo'))) return { erro: 'o envio exige --enviar --confirmar --arquivo <previa.json> (nada foi enviado)' }
  return { modo: 'enviar', arquivo: val('--arquivo'), por: val('--por') || 'David do Valle' }
}
const ARGS = lerArgs(process.argv.slice(2)), PRINCIPAL = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (!PRINCIPAL || ARGS.modo !== 'enviar') process.env.PS_DB_MEMORIA = '1'
const { ROOT } = await import('../src/lib/env.js')
const { WHATS, lerConfig, piorou } = await import('../src/lib/gatilhos.js')
const { faixaImpacto, dividirMensagem, lerCfgRelatorio, itensMicroCompras, montarMicroCompras } = await import('../src/lib/plano-semana-texto.js')
const { auditarTexto } = await import('../src/lib/relatorio-seguro.js')
// mesmos helpers do alerta-impacto (copiados: importar aquele script ligaria o banco em memória pelo efeito colateral dele)
export const mascarar = d => `…${String(d).slice(-9)}`
export const porMotivo = l => l.reduce((m, p) => { const k = String(p.motivo).split(':')[0]; m[k] = (m[k] || 0) + 1; return m }, {})
const parse = (s, pad) => { try { return JSON.parse(s || '') ?? pad } catch { return pad } }
export function whatsDe(json) {
  const w = parse(json, {})?.canais?.whatsapp, d = typeof w?.destino === 'string' ? w.destino.trim() : ''
  return !d ? { estado: 'auto' } : !WHATS.test(d) ? { estado: 'grupo_invalido' } : w.ligado === true ? { estado: 'ligado', destino: d } : { estado: 'canal_desligado' }
}
const BANCO = join(ROOT, 'data', 'db.sqlite'), CFG = lerConfig()
const sha = s => createHash('sha256').update(String(s), 'utf8').digest('hex')
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const ehProspecto = c => /^\s*\[Comercial\]/i.test(String(c ?? ''))
const brl = v => `R$ ${Math.round(v).toLocaleString('pt-BR')}`

// regra das 24 h: TODOS os produtos ditos já estão na memória de estoque das últimas 24 h e nenhum piorou → { pula: true }. avisados: [{ item_id, snap_json, enviado_em }]
export function avisado24h(avisar, avisados, agoraMs = Date.now()) {
  const desde = new Date(agoraMs - 86_400_000).toISOString(), m = new Map(avisados.filter(r => r.enviado_em >= desde).map(r => [String(r.item_id), JSON.parse(r.snap_json || '{}')]))
  return avisar.length > 0 && avisar.every(a => m.has(String(a.id)) && !piorou('estoque', a.snap || {}, m.get(String(a.id))))
}

// composer por cliente (fontes injetadas): diagnóstico do DIA + previsão de compras → itens → texto. Memo por cliente (montarLote roda 2–3 vezes no envio)
export function criarCompor({ diagnostico, compras, rotulo, alg }) {
  const memo = new Map()
  return c => {
    if (memo.has(c)) return memo.get(c)
    const diag = diagnostico(c), r = itensMicroCompras(diag, diag?.disponivel ? compras(c, diag) : null, { limiares: alg.limiares, ciclo_dias: alg.compras.ciclo_compra_dias })
    const rot = rotulo(c), tituloOk = t => !auditarTexto(String(t || ''), { permitidos: [c, rot] }).length
    const m = r.disponivel ? montarMicroCompras({ rotulo: rot, itens: r.itens, folga: alg.limiares.estoque_seguranca_dias, tituloOk }) : { texto: '', motivo: `sem_dados:${r.motivo}` }
    const out = { ...m, motivo: m.motivo || (m.texto ? '' : 'nada_de_compras'), n_candidatos: r.itens?.length ?? 0 }
    memo.set(c, out); return out
  }
}

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

export function textoPrevia(p) {
  const cab = `PRÉVIA (só leitura; NADA foi enviado) · Micro-relatório de compras · ${p.data} ${p.hora}${p.ignorar_24h ? ' · regra das 24 h IGNORADA' : ''}\n` +
    `Sairiam: ${p.itens.length} mensagem(ns) · ${p.n_itens} linha(s) de produto · total em jogo ${p.total ? `${brl(p.total.c)} a ${brl(p.total.b)}` : '—'}\n` +
    `Pulados: ${p.pulados.length} ${JSON.stringify(porMotivo(p.pulados))}${p.ignorar_24h ? '' : ` · pularia pela regra das 24 h: ${p.pulados.filter(x => x.motivo === 'avisado_24h').length}`}\n` +
    `Envio (aprovado, mesmo dia, 07:00–21:00): node scripts/micro-compras.mjs --enviar --confirmar --arquivo <este .json>\n${'='.repeat(100)}`
  const msgs = p.itens.map((x, k) => `──────── ${k + 1}/${p.itens.length} · ${x.cliente}${x.rotulo !== x.cliente ? ` (rótulo «${x.rotulo}»)` : ''} · destino ${mascarar(x.destino)}${x.auto ? ' (grupo da central, regra automática)' : ''} · ${x.caracteres} caracteres · ${x.n_partes} mensagem(ns) · ${x.n} linha(s)${x.resto ? ` + ${x.resto}` : ''} · total ${x.total ? `${brl(x.total.c)} a ${brl(x.total.b)}` : '—'}${x.avisado_24h ? ' · avisado nas últimas 24 h (mesmos produtos, sem piora)' : ''} ────────\n\n${x.texto}`)
  const pul = p.pulados.length ? `${'='.repeat(100)}\nPULADOS\n` + p.pulados.map(x => `• ${x.cliente}: ${x.motivo}${x.total ? ` (total ${brl(x.total.c)} a ${brl(x.total.b)})` : ''}`).join('\n') : ''
  return [cab, ...msgs, pul].filter(Boolean).join('\n\n') + '\n'
}

async function previa({ saida, ignorar24 }) {
  const { default: Database } = await import('better-sqlite3')
  const { db, hojeLocal } = await import('../src/lib/db.js')
  if (db.name !== ':memory:') throw new Error('abriu o banco real em escrita')
  await import('../src/lib/promocoes-db.js')
  const GR = await import('../src/lib/gatilhos-real.js')
  const { diagnosticarConta, algoritmo } = await import('../src/lib/diagnostico-conta.js')
  const real = new Database(BANCO, { readonly: true, fileMustExist: true })
  const st = new Set(CFG.status_elegiveis.map(norm))
  const ativos = real.prepare('SELECT cliente, status_cs AS status, notificacao_json FROM clientes_central').all().filter(r => r.cliente && !ehProspecto(r.cliente) && st.has(norm(r.status)))
  const comMl = new Set([...real.prepare('SELECT DISTINCT cliente FROM meli_contas').all(), ...real.prepare('SELECT DISTINCT cliente FROM meli_coleta_dia').all()].map(r => r.cliente))
  const cand = ativos.filter(r => comMl.has(r.cliente)).map(r => r.cliente), pulados = ativos.filter(r => !comMl.has(r.cliente)).map(r => ({ cliente: r.cliente, motivo: 'sem_integracao:sem_conexao_ml' }))
  const antes = new Map(ativos.map(r => [r.cliente, whatsDe(r.notificacao_json)]))
  copiar(db, real, cand); real.close()
  const g = GR.criarGatilhosReal({ envio: null, clienteCanonico: nome => cand.find(c => c === nome) || '' })
  const auto = await g.autoLiberar({ gravar: true })                             // em memória: grupo da central de quem não tinha WhatsApp configurado
  const semGrupo = new Set(auto.sem_grupo), naoLido = new Map(auto.nao_lidos.map(x => [x.cliente, x.motivo]))
  const compor = criarCompor({ diagnostico: diagnosticarConta, compras: (c, diag) => GR.comprasDoCliente(c, { diag }), rotulo: c => g.rotulo(c), alg: algoritmo })
  const selAvisado = db.prepare("SELECT item_id, snap_json, enviado_em FROM gatilho_avisado WHERE cliente = ? AND familia = 'estoque'")
  const itens = [], data = hojeLocal(), R = lerCfgRelatorio()
  for (const c of [...cand].sort((a, b) => a.localeCompare(b, 'pt-BR'))) {
    const w = antes.get(c)
    if (w.estado === 'canal_desligado' || w.estado === 'grupo_invalido') { pulados.push({ cliente: c, motivo: w.estado }); continue }
    const i = g.integracao(c); if (!i.ok) { pulados.push({ cliente: c, motivo: `sem_integracao:${i.motivo}` }); continue }
    if (w.estado === 'auto' && semGrupo.has(c)) { pulados.push({ cliente: c, motivo: 'sem_grupo_ml_na_central' }); continue }
    if (w.estado === 'auto' && naoLido.has(c)) { pulados.push({ cliente: c, motivo: `central_nao_lida:${naoLido.get(c)}` }); continue }
    const e = g.elegivel(c, { tipo: 'compras', manual: true })                    // o MESMO portão do envio confirmado (canal, integração, início, primeira coleta)
    if (!e.ok) { pulados.push({ cliente: c, motivo: e.motivo }); continue }
    let l
    try { l = g.montarLote(c, 'compras', { gravar: false, compor }) } catch (err) { pulados.push({ cliente: c, motivo: `erro:${String(err?.name || 'Error')}` }); continue }
    if (l.bloqueado) { pulados.push({ cliente: c, motivo: `bloqueado:${l.motivo}` }); continue }
    if (l.vazio) { pulados.push({ cliente: c, motivo: l.motivo || 'nada_de_compras', ...(l.total ? { total: l.total } : {}) }); continue }
    if (l.teto_dia) { pulados.push({ cliente: c, motivo: 'teto_diario' }); continue }
    const m = compor(c), a24 = avisado24h(m.avisar, selAvisado.all(c))
    if (a24 && !ignorar24) { pulados.push({ cliente: c, motivo: 'avisado_24h', total: l.total }); continue }
    itens.push({ cliente: c, rotulo: g.rotulo(c), destino: g.notificacao(c).canais.whatsapp.destino, auto: w.estado === 'auto', hash: l.hash, sha256: sha(l.texto_final), texto: l.texto_final,
      caracteres: l.texto_final.length, n_partes: dividirMensagem(l.texto_final, { max: R.whatsapp_max_caracteres, continua: R.continua }).length, total: l.total, n: l.n, resto: l.resto, avisado_24h: a24,
      produtos: m.avisar.map(x => x.id) })
  }
  itens.sort((a, b) => (b.total?.b ?? 0) - (a.total?.b ?? 0))
  const soma = k => itens.reduce((t, x) => t + (x.total?.[k] ?? 0), 0)
  const p = { gerado_em: new Date().toISOString(), data, hora: new Date().toLocaleTimeString('pt-BR', { timeZone: CFG.fuso_padrao, hour: '2-digit', minute: '2-digit' }), modo: 'previa', ignorar_24h: !!ignorar24,
    total: itens.length ? { c: soma('c'), b: soma('b') } : null, n_itens: itens.reduce((t, x) => t + x.n, 0), itens, pulados }
  mkdirSync(saida, { recursive: true })
  const base = join(saida, `previa-${data}${ignorar24 ? '-ignorar-24h' : ''}`)
  writeFileSync(`${base}.json`, JSON.stringify(p, null, 1)); writeFileSync(`${base}.txt`, textoPrevia(p))
  console.log(JSON.stringify({ data, ignorar_24h: !!ignorar24, clientes: itens.length, linhas: p.n_itens, total: p.total ? faixaImpacto(p.total) : null, pulados: porMotivo(pulados),
    pularia_por_24h: pulados.filter(x => x.motivo === 'avisado_24h').length, json: `${base}.json`, txt: `${base}.txt` }, null, 1))
}

// ── envio do que foi APROVADO, pelo pipeline dos gatilhos no banco real (sem regerar texto: o hash precisa bater) ──
export async function enviarItens({ previa, hoje, g, compor, centralDe, horaOk, por, avisados = () => [], esperar = ms => new Promise(r => setTimeout(r, ms)), intervaloMs = INTERVALO_MS, status = CFG.status_elegiveis, desfazer = () => {} }) {
  const enviados = [], pulados = [], st = new Set(status.map(norm)), pula = (cliente, motivo) => pulados.push({ cliente, motivo })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(previa?.data || '')) || !Array.isArray(previa?.itens)) throw new Error('arquivo de prévia inválido')
  if (previa.data !== hoje) throw new Error('prévia vencida (é de outro dia): gere de novo; nada foi enviado')
  let postou = false
  for (const x of previa.itens) {
    const c = typeof x?.cliente === 'string' ? x.cliente.trim() : '', texto = typeof x?.texto === 'string' ? x.texto : ''
    if (!c || ehProspecto(c) || !texto.trim() || texto.length > 2000 || !WHATS.test(String(x.destino)) || !/^[0-9a-f]{16}$/.test(String(x.hash))) { pula(c, 'item_invalido'); continue }
    if (sha(texto) !== x.sha256) { pula(c, 'hash_divergente'); continue }
    const row = centralDe(c)
    if (!row || !st.has(norm(row.status))) { pula(c, 'status_inelegivel'); continue }
    const w = whatsDe(row.notificacao_json)
    if (w.estado === 'canal_desligado' || w.estado === 'grupo_invalido') { pula(c, w.estado); continue }
    if (w.estado === 'ligado' && w.destino !== x.destino) { pula(c, 'destino_divergente'); continue }
    if (!horaOk(c)) { pula(c, 'fora_da_janela'); continue }
    if (!texto.startsWith(`Oi, time ${g.rotulo(c)}!`)) { pula(c, 'cabecalho_divergente'); continue }
    let r, liberou = false
    try {
      const l = g.montarLote(c, 'compras', { gravar: false, compor })
      if (l.hash !== x.hash) { pula(c, 'hash_divergente'); continue }
      if (!previa.ignorar_24h && avisado24h(compor(c).avisar || [], avisados(c))) { pula(c, 'avisado_24h'); continue }
      if (w.estado === 'auto') {
        liberou = (await g.autoLiberar({ so: [c] })).preenchidos.includes(c)
        if (!liberou || g.notificacao(c).canais.whatsapp.destino !== x.destino) throw Object.assign(new Error('destino'), { motivo: 'destino_divergente' })
      }
      if (postou) await esperar(intervaloMs)
      r = await g.enviar({ cliente: c, tipo: 'compras', por, confirmar: true, hash: x.hash, compor }); postou = true
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
  const GR = await import('../src/lib/gatilhos-real.js')
  const { diagnosticarConta, algoritmo } = await import('../src/lib/diagnostico-conta.js')
  const { horaNoFuso } = await import('../src/lib/relatorio-envio.js')
  const { dentroDaJanela } = await import('../src/lib/gatilhos.js')
  const selCentral = db.prepare('SELECT status_cs AS status, notificacao_json FROM clientes_central WHERE cliente = ?'), nomes = db.prepare('SELECT cliente FROM clientes_central').all().map(r => r.cliente)
  const selAvisado = db.prepare("SELECT item_id, snap_json, enviado_em FROM gatilho_avisado WHERE cliente = ? AND familia = 'estoque'")
  const g = GR.criarGatilhosReal({ clienteCanonico: nome => nomes.find(c => c === nome) || '' })      // config REAL, envio REAL (n8n)
  const compor = criarCompor({ diagnostico: diagnosticarConta, compras: (c, diag) => GR.comprasDoCliente(c, { diag }), rotulo: c => g.rotulo(c), alg: algoritmo })
  const horaOk = c => { const n = g.notificacao(c); return dentroDaJanela(horaNoFuso(Date.now(), n.fuso), { janela: CFG.janela, silencio: n.silencio }) }
  const desfazer = (c, json) => db.prepare('UPDATE clientes_central SET notificacao_json = ? WHERE cliente = ?').run(json, c)
  const r = await enviarItens({ previa: previaJson, hoje: hojeLocal(), g, compor, centralDe: c => selCentral.get(c) || null, horaOk, por, desfazer, avisados: c => selAvisado.all(c) })
  console.log(JSON.stringify({ enviados: r.enviados.length, pulados: porMotivo(r.pulados), detalhe: r }, null, 1))   // sem segredo, sem destino
}

if (PRINCIPAL) {
  if (ARGS.erro) { console.error(ARGS.erro); process.exit(2) }
  await (ARGS.modo === 'enviar' ? enviarArquivo(ARGS) : previa(ARGS))
}
