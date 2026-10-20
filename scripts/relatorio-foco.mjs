// RELATÓRIO FOCADO ao grupo do Mercado Livre de cada cliente (pedido do David, 14/10/2026: «estoque e ruptura, tarefas que nós fizemos e geração de resultado»).
// Texto: montarRelatorioFoco (src/lib/plano-semana-texto.js); dados: relatorioFoco (src/lib/gatilhos-real.js) — o MESMO caminho do lote semanal, nunca um segundo motor.
//
// PADRÃO = PRÉVIA SÓ LEITURA: abre data/db.sqlite READONLY, copia as linhas dos clientes candidatos para o banco em MEMÓRIA do db.js (PS_DB_MEMORIA=1, o padrão do
// exemplos-etapa3) e grava <saida>/previa-AAAA-MM-DD.json (o que pode sair) e .txt (todas as mensagens, com cabeçalho interno e destino mascarado). Nada é enviado.
//   node scripts/relatorio-foco.mjs [--saida <pasta>]
// ENVIO (só depois de o David aprovar a prévia): manda EXATAMENTE os textos do arquivo (não regera), um por cliente, ao n8n (/webhook/place-gatilhos, tipo 'teste' — o
// n8n não devolve recibo), 5 s entre envios. A prévia só vale NO DIA em que foi gerada. Antes de cada POST, reconfere na central de agora: status elegível, não prospect,
// grupo/ligado/liberado (o MESMO portão da prévia), destino igual ao do arquivo e integração ML; e no texto: sha256 igual ao gravado, cabeçalho do PRÓPRIO cliente e o
// auditor do relatório de novo (nomes internos lidos do banco real, readonly). Idempotente por lote_id (foco-AAAAMMDD-<slug>) em data/relatorio-foco-envios.json E no
// livro (ref foco:<lote_id>). Cada envio com HTTP 2xx vira 'relatorio_enviado' no livro do cliente como «aceito pelo n8n, sem recibo de entrega» (só o sha256; nunca destino).
//   node scripts/relatorio-foco.mjs --enviar --confirmar --arquivo <previa.json>
// Universo: clientes da central com status elegível (config/gatilhos.json → status_elegiveis), não prospect, com grupo do ML válido (…@g.us) na notificacao_json, WhatsApp
// ligado e liberado por líder (gatilhos.podeEnviar) e integração ML de fato (integracaoMlAtiva). Ordem dos motivos de pulo: sem_grupo → canal_desligado → nao_liberado →
// sem_integracao:<motivo> → sem_dados → bloqueado (auditor) → sem_conteudo → conferir (aviso interno: segura até a equipe conferir) → erro.
// Nota: este envio é manual e aprovado pelo David (como o de 13/10); ele NÃO consulta gatilhos.inicio_envios (que vale para os lotes dos gatilhos).
process.env.PS_DB_MEMORIA = '1'      // o motor roda em memória; data/db.sqlite só é aberto readonly (prévia) ou direto, para o livro (envio)
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
const { ROOT, env } = await import('../src/lib/env.js')
const { WHATS, notificacaoDe, lerConfig } = await import('../src/lib/gatilhos.js')

const CFG = lerConfig()
export const SAIDA_PADRAO = '/private/tmp/claude-501/-Users-davidvallejr/21ae2e63-2042-44b5-8fd0-58d5b00f4a31/scratchpad/foco'
export const REGISTRO = join(ROOT, 'data', 'relatorio-foco-envios.json')
export const INTERVALO_MS = 5000
export const RESUMO_LIVRO = 'Relatório de estoque, ações e resultados aceito pelo n8n para o grupo do Mercado Livre (sem recibo de entrega)'
const BANCO = join(ROOT, 'data', 'db.sqlite')
const sha = s => createHash('sha256').update(String(s), 'utf8').digest('hex')
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const ehProspecto = c => /^\s*\[Comercial\]/i.test(String(c ?? ''))
export const slug = c => norm(c).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'cliente'
export const loteId = (data, cliente) => `foco-${String(data).replace(/-/g, '')}-${slug(cliente)}`
export const mascarar = d => `…${String(d).slice(-9)}`            // «…12345@g.us»: o txt nunca leva o grupo inteiro
const { cabecalhosFoco } = await import('../src/lib/plano-semana-texto.js')
// o MESMO portão na prévia e no envio (gatilhos.podeEnviar: sem_canal / nao_liberado): grupo do ML válido, WhatsApp ligado e liberado por líder → { destino, rotulo } | { motivo }
export function portao(json) {
  const n = notificacaoDe(json, CFG), w = n.canais.whatsapp
  return !WHATS.test(w.destino) ? { motivo: 'sem_grupo' } : !w.ligado ? { motivo: 'canal_desligado' } : !n.liberado_por ? { motivo: 'nao_liberado' } : { destino: w.destino, rotulo: n.rotulo }
}

export function lerArgs(argv) {
  const tem = f => argv.includes(f), val = f => { const i = argv.indexOf(f), v = i >= 0 ? argv[i + 1] || '' : ''; return v.startsWith('--') ? '' : v }
  if (!tem('--enviar') && !tem('--confirmar') && !tem('--arquivo')) return { modo: 'previa', saida: val('--saida') || SAIDA_PADRAO }
  if (!(tem('--enviar') && tem('--confirmar') && val('--arquivo'))) return { erro: 'o envio exige --enviar --confirmar --arquivo <previa.json> (nada foi enviado)' }
  return { modo: 'enviar', arquivo: val('--arquivo') }
}

// central: [{ cliente, status, notificacao_json }]; integracao(c) → { ok, motivo }. Inativo e prospect nem entram no universo (não são «pulados»).
export function universo(central, { integracao, status = CFG.status_elegiveis }) {
  const st = new Set(status.map(norm)), alvos = [], pulados = []
  for (const r of central || []) {
    if (!r?.cliente || ehProspecto(r.cliente) || !st.has(norm(r.status))) continue
    const { destino, motivo } = portao(r.notificacao_json)
    if (motivo) { pulados.push({ cliente: r.cliente, motivo }); continue }
    let i; try { i = integracao(r.cliente) } catch { i = null }
    if (!i?.ok) { pulados.push({ cliente: r.cliente, motivo: `sem_integracao:${i?.motivo || 'integracao_indisponivel'}` }); continue }
    alvos.push({ cliente: r.cliente, destino })
  }
  return { alvos, pulados }
}

// alvos → itens da prévia; gerar(c) = relatorioFoco(c, { hoje }). Nada é gravado aqui.
export function montarPrevia(alvos, { gerar, data }) {
  const itens = [], pulados = []
  for (const { cliente, destino } of alvos) {
    let r; try { r = gerar(cliente) } catch (e) { pulados.push({ cliente, motivo: `erro:${String(e?.name || 'Error')}` }); continue }
    if (!r?.disponivel) { pulados.push({ cliente, motivo: `sem_dados:${r?.motivo || 'diagnostico_indisponivel'}` }); continue }
    if (r.bloqueado) { pulados.push({ cliente, motivo: `bloqueado:${r.motivo}`, conferir: r.conferir }); continue }
    if (!r.tem_conteudo) { pulados.push({ cliente, motivo: 'sem_conteudo', conferir: r.conferir }); continue }
    if (r.conferir?.length) { pulados.push({ cliente, motivo: 'conferir', conferir: r.conferir }); continue }       // aviso interno: segura o envio até a equipe conferir
    itens.push({ cliente, rotulo: r.rotulo, destino, lote_id: loteId(data, cliente), texto: r.texto, hash: sha(r.texto), secoes: r.secoes, conferir: r.conferir, nota_interna: r.nota_interna || [], chars: r.texto.length })
  }
  return { itens, pulados }
}

export const porMotivo = pulados => pulados.reduce((m, p) => { const k = p.motivo.split(':')[0]; m[k] = (m[k] || 0) + 1; return m }, {})

export function textoPrevia(p) {
  const cab = `PRÉVIA (só leitura; NADA foi enviado) · Relatório de estoque, ações e resultados · ${p.data}\nA enviar: ${p.itens.length} · Pulados: ${p.pulados.length} ${JSON.stringify(porMotivo(p.pulados))}\n` +
    `Envio, só depois de aprovado e NO MESMO DIA: node scripts/relatorio-foco.mjs --enviar --confirmar --arquivo <este .json>\n${'='.repeat(100)}`
  const msgs = p.itens.map((x, k) => `──────── ${k + 1}/${p.itens.length} · ${x.cliente}${x.rotulo !== x.cliente ? ` (rótulo «${x.rotulo}»)` : ''} · destino ${mascarar(x.destino)} · ${x.chars} caracteres ────────\n` +
    `Seções com conteúdo: ${x.secoes.filter(s => s.conteudo).map(s => s.chave).join(', ') || '—'}${x.secoes.some(s => !s.conteudo) ? ` · sem conteúdo: ${x.secoes.filter(s => !s.conteudo).map(s => s.chave).join(', ')}` : ''}${x.secoes.some(s => s.chave === 'tarefas') ? '' : ' · 🛠️ fora (zero tarefa confirmada)'}\n` +
    x.conferir.map(c => `CONFERIR (interno, não vai ao cliente): ${c}\n`).join('') + `\n${x.texto}`)
  const pul = p.pulados.length ? `${'='.repeat(100)}\nPULADOS\n` + p.pulados.map(x => `• ${x.cliente}: ${x.motivo}${x.conferir?.length ? ` (${x.conferir.join('; ')})` : ''}`).join('\n') : ''
  return [cab, ...msgs, pul].filter(Boolean).join('\n\n') + '\n'
}

// envia os itens APROVADOS do arquivo. deps: hoje ('AAAA-MM-DD' local; prévia de outro dia = recusada inteira); centralDe(c) → { status, notificacao_json } | null (central
// AGORA); integracao(c) → { ok, motivo }; auditar(texto, { cliente, rotulo }) → violações; jaNoLivro(ref) → bool; registro {lote_id → …} + salvarRegistro(registro) (a cada
// envio); enviar({ lote_id, rotulo, assunto, texto, destino }) → { estado, motivo }; livro { registrar }; esperar(ms). → { enviados, pulados }
export async function enviarPrevia({ previa, hoje, centralDe, integracao, auditar, jaNoLivro = () => false, registro, salvarRegistro, enviar, livro, status = CFG.status_elegiveis,
  esperar = ms => new Promise(r => setTimeout(r, ms)), intervaloMs = INTERVALO_MS, agora = () => new Date().toISOString() }) {
  const enviados = [], pulados = [], data = String(previa?.data || ''), st = new Set(status.map(norm))
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !Array.isArray(previa?.itens)) throw new Error('arquivo de prévia inválido')
  if (data !== hoje) throw new Error('prévia vencida (é de outro dia): gere de novo; nada foi enviado')
  let postou = false
  const pula = (cliente, motivo) => { pulados.push({ cliente, motivo }) }
  for (const x of previa.itens) {
    const cliente = typeof x?.cliente === 'string' ? x.cliente.trim() : '', texto = typeof x?.texto === 'string' ? x.texto : ''
    if (!cliente || ehProspecto(cliente) || !texto.trim() || texto.length > 4000 || !WHATS.test(String(x.destino))) { pula(cliente, 'item_invalido'); continue }
    const lote_id = loteId(data, cliente), ref = `foco:${lote_id}`
    if (registro[lote_id] || jaNoLivro(ref)) { pula(cliente, 'ja_enviado'); continue }
    if (sha(texto) !== x.hash) { pula(cliente, 'hash_divergente'); continue }
    const row = centralDe(cliente)
    if (!row || !st.has(norm(row.status))) { pula(cliente, 'status_inelegivel'); continue }
    const pt = portao(row.notificacao_json)
    if (pt.motivo) { pula(cliente, pt.motivo); continue }
    if (pt.destino !== x.destino) { pula(cliente, 'destino_divergente'); continue }
    let i; try { i = integracao(cliente) } catch { i = null }
    if (!i?.ok) { pula(cliente, `sem_integracao:${i?.motivo || 'integracao_indisponivel'}`); continue }
    const rotulo = pt.rotulo || cliente                                   // o rótulo de AGORA (o do relatório semanal): texto de outro cliente não passa
    if (!cabecalhosFoco(rotulo, data).some(h => texto.includes(`\n\n${h}\n\n`))) { pula(cliente, 'cabecalho_divergente'); continue }
    let viol; try { viol = auditar(texto, { cliente, rotulo }) } catch { viol = ['auditor_indisponivel'] }
    if (viol.length) { pula(cliente, 'bloqueado:conteudo'); continue }
    if (postou) await esperar(intervaloMs)
    postou = true
    const r = await enviar({ lote_id, rotulo, assunto: `Estoque, ações e resultados · ${data.split('-').reverse().join('/')}`, texto, destino: x.destino })
    if (r?.estado !== 'enviado') { pula(cliente, `falhou:${r?.motivo || 'erro'}`); continue }
    const em = agora(), hash = sha(texto)
    registro[lote_id] = { cliente, enviado_em: em, hash }; salvarRegistro(registro)          // gravado a cada envio: uma queda no meio não reenvia o que já saiu
    let livroOk = true
    // HTTP 2xx = o n8n ACEITOU (o webhook responde ao receber; tipo 'teste' não tem recibo): o livro diz isso, nunca «entregue no grupo»
    try { livro.registrar({ cliente, tipo: 'relatorio_enviado', ref, fato_em: em, resumo: RESUMO_LIVRO, dados: { lote_id, caracteres: texto.length, estado: 'enviado_n8n', recibo: false }, prova: `sha256:${hash}` }) } catch { livroOk = false }
    enviados.push({ cliente, lote_id, ...(livroOk ? {} : { livro: 'falhou' }) })
  }
  return { enviados, pulados }
}

// ── banco real READONLY → banco em MEMÓRIA do db.js (linhas dos clientes + tabelas globais pequenas): a prévia e o envio leem daqui; nada é gravado no real ──
async function memoria() {
  const { default: Database } = await import('better-sqlite3')
  const { db, hojeLocal } = await import('../src/lib/db.js')
  if (db.name !== ':memory:') throw new Error('abriu o banco real em escrita')
  await import('../src/lib/promocoes-db.js')                                   // módulos que criam tabelas no import, ANTES da cópia
  const GR = await import('../src/lib/gatilhos-real.js')
  const real = new Database(BANCO, { readonly: true, fileMustExist: true })
  return { db, hojeLocal, real, GR, copiar: cand => copiar(db, real, cand) }
}
function copiar(db, real, cand) {
  const GLOBAIS = ['sync_estado', 'analistas_oficiais', 'usuarios_notion', 'prestadores'], PULAR = new Set(['registro_cliente', 'gatilho_lote'])
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

async function previa({ saida }) {
  const { hojeLocal, real, GR: { relatorioFoco, integracaoMlReal }, copiar } = await memoria()
  const central = real.prepare('SELECT cliente, status_cs AS status, notificacao_json FROM clientes_central').all()
  copiar(universo(central, { integracao: () => ({ ok: true }) }).alvos.map(a => a.cliente))
  real.close()
  const data = hojeLocal(), u = universo(central, { integracao: integracaoMlReal })
  const m = montarPrevia(u.alvos, { gerar: c => relatorioFoco(c, { hoje: data }), data })
  const p = { gerado_em: new Date().toISOString(), data, modo: 'previa', itens: m.itens, pulados: [...u.pulados, ...m.pulados] }
  mkdirSync(saida, { recursive: true })
  const arq = join(saida, `previa-${data}.json`), txt = join(saida, `previa-${data}.txt`)
  writeFileSync(arq, JSON.stringify(p, null, 1)); writeFileSync(txt, textoPrevia(p))
  console.log(JSON.stringify({ data, a_enviar: p.itens.length, pulados: porMotivo(p.pulados), json: arq, txt }, null, 1))
}

// ── envio: só os textos aprovados do arquivo. Central e livro no banco real (aberto direto); nomes internos e integração ML pela cópia readonly em memória ──
async function enviarArquivo({ arquivo }) {
  const previaJson = JSON.parse(readFileSync(arquivo, 'utf-8'))
  const { hojeLocal, real, GR: { integracaoMlReal }, copiar } = await memoria()
  copiar((previaJson?.itens || []).map(x => x?.cliente).filter(c => typeof c === 'string')); real.close()
  const { default: Database } = await import('better-sqlite3')
  const { criarLivro } = await import('../src/lib/livro-registro.js')
  const { criarEnvio } = await import('../src/lib/gatilhos-envio.js')
  const { nomesInternos } = await import('../src/lib/relatorio-brief-real.js')
  const { auditarMensagem } = await import('../src/lib/plano-semana-texto.js')
  const { auditarTexto } = await import('../src/lib/relatorio-seguro.js')
  const h = new Database(BANCO, { fileMustExist: true }); h.pragma('busy_timeout = 30000')
  const selCentral = h.prepare('SELECT status_cs AS status, notificacao_json FROM clientes_central WHERE cliente = ?'), selLivro = h.prepare("SELECT 1 FROM registro_cliente WHERE tipo = 'relatorio_enviado' AND ref = ?")
  const envio = criarEnvio({ env, webhook: CFG.webhook })
  const registro = existsSync(REGISTRO) ? JSON.parse(readFileSync(REGISTRO, 'utf-8')) : {}
  const salvar = r => { writeFileSync(`${REGISTRO}.tmp`, JSON.stringify(r, null, 1)); renameSync(`${REGISTRO}.tmp`, REGISTRO) }
  const r = await enviarPrevia({ previa: previaJson, hoje: hojeLocal(), registro, salvarRegistro: salvar, livro: criarLivro({ handle: h, raiz: join(ROOT, 'data') }),
    centralDe: c => selCentral.get(c) || null, integracao: integracaoMlReal, jaNoLivro: ref => !!selLivro.get(ref),
    auditar: (texto, { cliente, rotulo }) => auditarMensagem(texto, auditarTexto, { nomesInternos: nomesInternos(cliente), permitidos: [cliente, rotulo] }),
    enviar: ({ lote_id, rotulo, assunto, texto, destino }) => envio.enviar({ lote: { id: lote_id, cliente: rotulo, tipo: 'teste', titulo: assunto, texto }, notificacao: { canais: { whatsapp: { ligado: true, destino } } } }) })
  h.close()
  console.log(JSON.stringify({ enviados: r.enviados.length, pulados: porMotivo(r.pulados), detalhe: r }, null, 1))   // sem segredo, sem destino
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = lerArgs(process.argv.slice(2))
  if (a.erro) { console.error(a.erro); process.exit(2) }
  await (a.modo === 'enviar' ? enviarArquivo(a) : previa(a))
}
