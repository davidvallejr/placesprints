// Respostas dos clientes ao relatório semanal (pedido do David, 13/10/2026): coleta de FEEDBACK DE PRODUTO, não um segundo motor — nada aqui decide ação, prioridade ou texto
// ao cliente. Lê os grupos de WhatsApp do Mercado Livre pelo n8n (POST {PLACE_GATILHOS_URL}/webhook/place-respostas, mesma autenticação de gatilhos-envio.postar) e guarda
// SÓ a mensagem do cliente que responde a uma NOSSA mensagem-âncora (plano do Merovíngio ou a pergunta do relatório): citou a âncora = 'certa'; na janela da PERGUNTA (o plano
// só conta por citação), sem cara de pedido operacional e falando do relatório ou listando assuntos = 'provavel'. Todo o resto (conversa com o consultor, mídia, apagada,
// figurinha, mensagem nossa) é contado e descartado. Privacidade: o jid do grupo nunca é gravado (sha256 16), o do participante nem em hash; do autor fica só o 1º nome;
// texto ≤ 2000 só da mensagem que passou no filtro, com menção @número e telefone mascarados; descartar apaga texto/nome/temas (lápide).
// Puro: handle, envio (criarEnvio), relógio, validarPor e estado entram por fábrica (o autoteste usa :memory: e stub); fiação real em respostas-relatorio-real.js.
// Regras e listas: config/respostas-relatorio.json · desenho e contrato: docs/respostas-relatorio.md
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './env.js'

export const lerConfig = () => JSON.parse(readFileSync(join(ROOT, 'config', 'respostas-relatorio.json'), 'utf-8'))
export const STATUS = ['novo', 'revisado', 'descartado', 'implementar']

export const SCHEMA_FEEDBACK = `
CREATE TABLE IF NOT EXISTS feedback_relatorio (      -- 1 linha = 1 mensagem do cliente que respondeu a uma âncora nossa (idempotente por msg_id)
  msg_id TEXT PRIMARY KEY,
  cliente TEXT NOT NULL,
  grupo_hash TEXT NOT NULL,                          -- sha256(jid do grupo) 16 hex: o jid nunca é gravado
  autor_hash TEXT NOT NULL DEFAULT '',               -- vazio: sem uso hoje (sha256 sem sal do telefone é reversível); se precisar, HMAC com segredo local
  autor_nome TEXT NOT NULL DEFAULT '',               -- só o 1º nome do pushName (≤ 30)
  texto TEXT NOT NULL,                               -- ≤ 2000, só da mensagem que passou no filtro
  recebido_em TEXT NOT NULL,                         -- ISO
  ancora_id TEXT NOT NULL,
  ancora_tipo TEXT NOT NULL CHECK (ancora_tipo IN ('relatorio','pergunta')),
  relacao TEXT NOT NULL CHECK (relacao IN ('citou','janela')),
  confianca TEXT NOT NULL CHECK (confianca IN ('certa','provavel')),
  temas_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'novo' CHECK (status IN ('novo','revisado','descartado','implementar')),
  nota_interna TEXT NOT NULL DEFAULT '',
  status_por TEXT NOT NULL DEFAULT '', status_em TEXT NOT NULL DEFAULT '',
  coletado_em TEXT NOT NULL,
  origem TEXT NOT NULL DEFAULT 'whatsapp' CHECK (origem IN ('whatsapp','equipe'))   -- 'equipe' = feedback curado em conversa (perfil-informacao.js; sem grupo/autor, recebido_em = o dia)
);
CREATE INDEX IF NOT EXISTS ix_feedback_cli ON feedback_relatorio (cliente, recebido_em);
CREATE TABLE IF NOT EXISTS feedback_coleta (         -- estado da coleta por cliente
  cliente TEXT PRIMARY KEY,
  ultima_coleta TEXT NOT NULL DEFAULT '',            -- ISO da última leitura que deu certo
  ultimo_ts INTEGER NOT NULL DEFAULT 0,              -- epoch s da mensagem mais nova lida
  ancoras_json TEXT NOT NULL DEFAULT '[]'            -- âncoras vistas nos últimos dias_apos_ancora: [{ id, tipo, ts, g }] (g = grupo_hash)
);`

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const str = v => typeof v === 'string' ? v.trim() : ''
const ehProspecto = c => /^\s*\[Comercial\]/i.test(c)
export const hash16 = s => createHash('sha256').update(String(s), 'utf8').digest('hex').slice(0, 16)
const RX_GRUPO = /^[0-9-]{5,40}@g\.us$/
const RX_URL = /https?:\/\/\S+|www\.\S+/gi
const deacc = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
// texto comparável: sem acento, caixa, link, pontuação e emoji; espaço nas pontas para casar «início de palavra» com ' palavra'
export const norm = s => ` ${deacc(s).replace(RX_URL, ' ').replace(/[^a-z0-9]+/g, ' ').trim()} `
const escRx = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// ponytail: casa pelo INÍCIO da palavra ("anuncio" pega "anúncios"); item terminado em "$" casa a palavra inteira ("envio$" não pega "enviou"); um nome que começa como
// palavra da lista ("Adson" × "ads") passa — a confiança fica 'provavel' e a equipe revisa
const rxLista = (lista, flags = '') => lista.length ? new RegExp(` (?:${lista.map(p => p.endsWith('$') ? escRx(norm(p.slice(0, -1)).trim()) + '(?= )' : escRx(norm(p).trim())).join('|')})`, flags) : /(?!)/
const RX_EMOJI = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\u200D\uFE0F]/gu
const SO_TEMA = ['elogio', 'critica', 'duvida']                     // temas que não são ASSUNTO: não contam como item de lista («Top, show» não é lista de interesses)

const compilados = new WeakMap()
function preparar(cfg) {
  if (compilados.has(cfg)) return compilados.get(cfg)
  const O = cfg.operacional, T = cfg.temas
  const P = {
    texto: new Set(cfg.tipos_texto),
    janela: { pergunta: cfg.ancoras.pergunta.janela_h * 3600, relatorio: cfg.ancoras.relatorio.janela_h * 3600 },
    pergunta: cfg.ancoras.pergunta.comeca.map(p => norm(p).trim()),
    relatorio: rxLista(cfg.ancoras.relatorio.contem),
    saudacoes: O.saudacoes.map(s => norm(s).trim()).sort((a, b) => b.length - a.length),
    saudG: rxLista(O.saudacoes, 'g'),
    naoVoc: new Set(O.nao_vocativo.map(s => norm(s).trim())),
    pedido: rxLista(O.pedido), objeto: rxLista(O.objeto), frases: rxLista(O.frases), porFavor: rxLista(O.por_favor),
    opiniao: rxLista(cfg.opiniao), todosTemas: rxLista(Object.values(T).flat()),
    assuntos: rxLista(Object.entries(T).filter(([k]) => !SO_TEMA.includes(k)).flatMap(([, l]) => l)),
    lista: cfg.lista_curta, verbos: rxLista(cfg.lista_curta.verbos || []),
    temas: Object.entries(T).map(([k, l]) => [k, rxLista(l)]), criticaG: rxLista(T.critica || [], 'g'),
  }
  // vocativo: «Gi,» / «Gi!» / «Gi:» ou nome seguido de saudação («Gi bom dia, …»)
  P.voc = new RegExp(`^([a-z]{2,15})(?:\\s*[,!:]|\\s+(?:${P.saudacoes.map(escRx).join('|')})(?![a-z0-9]))`)
  compilados.set(cfg, P); return P
}

// âncora = mensagem NOSSA (deMim) com o plano do Merovíngio ('relatorio') ou a pergunta do relatório ('pergunta'); a pergunta vence quando as duas casam
export function tipoAncora(texto, cfg) {
  const P = preparar(cfg), n = norm(texto).trim()
  if (P.pergunta.some(p => p && n.startsWith(p))) return 'pergunta'
  return P.relatorio.test(` ${n} `) ? 'relatorio' : ''
}

// começo da mensagem sem emoji, pontuação e saudações («Bom dia! 😊 Gi, coloca…» → «gi, coloca…»), sem acento e em caixa baixa
function inicio(texto, P) {
  let s = deacc(texto).replace(RX_EMOJI, '').trim().replace(/^[\s!,.;:]+/, '')
  for (let mudou = true; mudou;) {
    mudou = false
    for (const sd of P.saudacoes) if (s.startsWith(sd) && !/[a-z0-9]/.test(s[sd.length] || '')) { s = s.slice(sd.length).replace(/^[\s!,.;:]+/, ''); mudou = true; break }
  }
  return s
}

// vocativo a uma pessoa («Gi, coloca…», «Bom dia! 😊 Ana: …», «Gi bom dia, …») ou menção «@5511…» em qualquer lugar: a palavra do vocativo não pode ser saudação,
// «pessoal», resposta curta ou palavra de opinião/tema
function vocativo(texto, P) {
  if (/(^|\s)@\+?\d{6,}/.test(texto)) return true
  const w = inicio(texto, P).match(P.voc)?.[1]
  return !!w && !P.naoVoc.has(w) && !P.opiniao.test(` ${w} `) && !P.todosTemas.test(` ${w} `)
}

// pedido operacional ao consultor: vocativo/menção, texto de compartilhamento do ML, só link, pedido + produto/link/código MLB; e, quando a mensagem NÃO fala do relatório,
// verbo de pedido no começo («Coloca no Full…», «Pode subir…»), «por favor» ou pergunta («…já está ativa?»)
export function operacional(texto, cfg) {
  const P = preparar(cfg), n = norm(texto), link = /https?:\/\/|www\./i.test(texto)
  if (vocativo(texto, P) || P.frases.test(n)) return true
  if (link && n.replace(/ /g, '').length < 2) return true
  if (P.pedido.test(n) && (P.objeto.test(n) || link || /\bmlb-?\d/i.test(texto))) return true
  // ponytail: resposta legítima com cara de pedido e sem falar do relatório («Pode ver o estoque?») fica de fora — a citação sempre pega
  return !P.opiniao.test(n) && (P.pedido.test(` ${norm(inicio(texto, P)).trim().split(' ')[0]} `) || P.porFavor.test(n) || String(texto).includes('?'))
}

// resposta curta em lista («Vendas, Estoque, reposição, compras»): só na janela da pergunta; ao menos `min_itens` itens são ASSUNTO de relatório (temas, sem elogio/crítica/
// dúvida, ou vocabulário do relatório) e nenhum item tem verbo de conversa — «Bom dia, Gi», «Ok, vou ver», «Bom dia, chegou a mercadoria» não são lista
function listaCurta(texto, P) {
  const t = String(texto).trim(), L = P.lista
  if (!t || t.length > L.max_chars || /https?:\/\/|www\.|\?/i.test(t)) return false
  const itens = t.split(/[,;\n]|\se\s/i).map(x => norm(x).trim()).filter(Boolean)
  return itens.length >= L.min_itens && itens.every(x => x.split(' ').length <= L.max_palavras_item && !P.verbos.test(` ${x} `))
    && itens.filter(x => P.assuntos.test(` ${x} `) || P.opiniao.test(` ${x} `)).length >= L.min_itens
}

export function opiniao(texto, tipo, cfg) {
  const P = preparar(cfg), n = norm(texto).replace(P.saudG, ' ')
  return P.opiniao.test(` ${n} `) || (tipo === 'pergunta' && listaCurta(texto, P))
}

// temas determinísticos (ordem do config); crítica e dúvida leem o texto inteiro, os outros leem o texto sem as frases de crítica e sem a palavra negada («não gostei»,
// «nem útil» não são elogio)
export function temasDe(texto, cfg) {
  const P = preparar(cfg), n = norm(texto).replace(P.saudG, ' '), semCritica = ` ${n.replace(P.criticaG, ' ').replace(/ (?:nao|nada|nem) [a-z0-9]+(?= )/g, ' ')} `
  return P.temas.filter(([k, rx]) => k === 'critica' ? rx.test(n) : k === 'duvida' ? rx.test(n) || String(texto).includes('?') : rx.test(semCritica)).map(([k]) => k)
}

// mensagem do n8n → forma fechada (fronteira de confiança); inválida = null
export function validarMensagem(x) {
  if (!x || typeof x !== 'object') return null
  let ts = Number(x.ts); if (ts > 1e12) ts = Math.floor(ts / 1000)            // ms por engano
  const m = { grupo: str(x.grupo), id: str(x.id).slice(0, 128), deMim: x.deMim === true, autor: str(x.autor).slice(0, 128), nome: str(x.nome).slice(0, 100),
    ts, tipo: str(x.tipo).slice(0, 40), texto: typeof x.texto === 'string' ? x.texto.slice(0, 4000) : '', cita_id: str(x.cita_id).slice(0, 128) }
  return m.id && Number.isFinite(ts) && ts > 0 ? m : null
}

// O FILTRO (puro): mensagens de UM grupo + âncoras já conhecidas desse grupo → o que guardar e as âncoras novas. Nunca guarda mensagem nossa, mídia, texto vazio,
// resposta a outra mensagem que não é âncora, mensagem fora da janela (âncora com janela_h 0 — o plano — só por citação), pedido operacional ou texto que não fala do
// relatório. Com várias âncoras abertas vale a primeira em que a mensagem passa, a pergunta antes do plano.
export function filtrar({ mensagens = [], ancorasPrevias = [], cfg }) {
  const P = preparar(cfg), ms = mensagens.filter(Boolean).slice().sort((a, b) => a.ts - b.ts)
  const ancoras = new Map(ancorasPrevias.map(a => [a.id, a])), novas = []
  for (const m of ms) if (m.deMim) { const tipo = tipoAncora(m.texto, cfg); if (tipo && !ancoras.has(m.id)) { const a = { id: m.id, tipo, ts: m.ts }; ancoras.set(m.id, a); novas.push(a) } }
  const abertas = [...ancoras.values()].filter(a => P.janela[a.tipo] > 0).sort((a, b) => (a.tipo !== 'pergunta') - (b.tipo !== 'pergunta') || b.ts - a.ts), guardar = []
  for (const m of ms) {
    if (m.deMim || !P.texto.has(m.tipo) || !m.texto.trim()) continue
    if (m.cita_id) { const a = ancoras.get(m.cita_id); if (a) guardar.push({ m, ancora: a, relacao: 'citou', confianca: 'certa' }); continue }   // citou outra coisa = conversa com outra pessoa
    if (operacional(m.texto, cfg)) continue
    const a = abertas.find(a => a.ts <= m.ts && m.ts - a.ts <= P.janela[a.tipo] && opiniao(m.texto, a.tipo, cfg))
    if (a) guardar.push({ m, ancora: a, relacao: 'janela', confianca: 'provavel' })
  }
  return { guardar, ancoras: novas, lidas: ms.length, ignoradas: ms.length - guardar.length }
}

const primeiroNome = s => (String(s ?? '').trim().split(/\s+/)[0] || '').replace(/[^\p{L}\p{M}'-]/gu, '').slice(0, 30)
// sem controle; menção do WhatsApp («@5511…») e telefone digitado mascarados — o número de ninguém vai para o banco nem para a resposta HTTP
const limpo = s => String(s).replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').replace(/@\+?\d{6,}/g, '@…').replace(/(?<![\w-])\+?\d[\d\s().-]{8,}\d/g, '[telefone]').trim().slice(0, 2000)
const parse = (s, pad) => { try { return JSON.parse(s || '') ?? pad } catch { return pad } }
// dia e HH:MM no fuso (Intl, sem dependência): en-CA dá AAAA-MM-DD
const noFuso = (ms, fuso) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map(x => [x.type, x.value])); return { dia: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}` } }

// deps: cfg, envio (criarEnvio: configurado(), postar(caminho, payload, { ler })), agora() ISO, validarPor(nome) → nome canônico de líder/consultor ou '',
//       estado { get, set } (sync_estado no real), clientesComGrupo?() → [{ cliente, grupo }] (padrão: clientes_central.notificacao_json.canais.whatsapp.destino @g.us),
//       ultimoEnvio?(cliente) → ISO do último plano que saiu (padrão: gatilho_lote.enviado_em), log(nivel, msg) — nunca jid nem texto
export function criarRespostas(h, { cfg = lerConfig(), envio = null, agora = () => new Date().toISOString(), validarPor = n => str(n), estado = null, clientesComGrupo = null, ultimoEnvio = null, log = () => {} } = {}) {
  h.exec(SCHEMA_FEEDBACK)
  const W = cfg.webhook, TEMAS = Object.keys(cfg.temas), dias = cfg.coleta.dias_apos_ancora
  const mem = new Map(), est = estado || { get: k => mem.get(k), set: (k, v) => mem.set(k, v) }
  const grupos = clientesComGrupo || (() => {
    let rows = []; try { rows = h.prepare("SELECT cliente, notificacao_json FROM clientes_central WHERE notificacao_json LIKE '%@g.us%'").all() } catch { return [] }
    return rows.map(r => ({ cliente: r.cliente, grupo: str(parse(r.notificacao_json, {})?.canais?.whatsapp?.destino) })).filter(x => RX_GRUPO.test(x.grupo))
  })
  const envioDe = ultimoEnvio || (c => { try { return h.prepare("SELECT MAX(enviado_em) e FROM gatilho_lote WHERE cliente = ? AND enviado_em <> ''").get(c)?.e || '' } catch { return '' } })
  const comGrupo = () => grupos().filter(x => x.cliente && !ehProspecto(x.cliente))
  const lerColeta = c => { const r = h.prepare('SELECT * FROM feedback_coleta WHERE cliente = ?').get(c); return { ultima_coleta: r?.ultima_coleta || '', ultimo_ts: r?.ultimo_ts || 0, ancoras: parse(r?.ancoras_json, []) } }
  const ins = h.prepare(`INSERT OR IGNORE INTO feedback_relatorio (msg_id, cliente, grupo_hash, autor_hash, autor_nome, texto, recebido_em, ancora_id, ancora_tipo, relacao, confianca, temas_json, coletado_em)
    VALUES (@msg_id, @cliente, @grupo_hash, @autor_hash, @autor_nome, @texto, @recebido_em, @ancora_id, @ancora_tipo, @relacao, @confianca, @temas_json, @coletado_em)`)
  const salvarColeta = h.prepare(`INSERT INTO feedback_coleta (cliente, ultima_coleta, ultimo_ts, ancoras_json) VALUES (?,?,?,?)
    ON CONFLICT(cliente) DO UPDATE SET ultima_coleta = excluded.ultima_coleta, ultimo_ts = excluded.ultimo_ts, ancoras_json = excluded.ancoras_json`)

  // um grupo de um cliente: filtra, grava (idempotente) e guarda as âncoras dos últimos `dias`
  const processar = h.transaction((cliente, grupo, msgs, em) => {
    const g = hash16(grupo), atual = lerColeta(cliente)
    const r = filtrar({ mensagens: msgs, ancorasPrevias: atual.ancoras.filter(a => a.g === g), cfg })
    let novas = 0
    for (const { m, ancora, relacao, confianca } of r.guardar) novas += ins.run({ msg_id: m.id, cliente, grupo_hash: g, autor_hash: '', autor_nome: primeiroNome(m.nome),   // ponytail: autor_hash sem uso — HMAC com segredo local quando houver
      texto: limpo(m.texto), recebido_em: new Date(m.ts * 1000).toISOString(), ancora_id: ancora.id, ancora_tipo: ancora.tipo, relacao, confianca, temas_json: JSON.stringify(temasDe(m.texto, cfg)), coletado_em: em }).changes
    const corte = Date.parse(em) / 1000 - dias * 86400
    const ancoras = [...atual.ancoras, ...r.ancoras.map(a => ({ ...a, g }))].filter(a => a.ts >= corte).sort((a, b) => b.ts - a.ts).slice(0, 50)
    salvarColeta.run(cliente, em, Math.max(atual.ultimo_ts, ...msgs.map(m => m.ts)), JSON.stringify(ancoras))
    return { lidas: r.lidas, guardadas: novas, repetidas: r.guardar.length - novas, ignoradas: r.ignoradas }
  })

  let ocupado = false
  // coleta: { clientes?: [nome canônico], por, origem: 'manual' | 'automatico' } → { ok, lidas, guardadas, repetidas, ignoradas, por_cliente } — nunca o jid nem o texto ignorado
  async function coletar({ clientes = null, por = '', origem = 'manual' } = {}) {
    const quem = origem === 'automatico' ? 'automático' : validarPor(str(por))
    if (!quem) throw erro('informe quem pede a coleta (líder ou consultor)', 403)
    const vazio = { lidas: 0, guardadas: 0, repetidas: 0, ignoradas: 0, por_cliente: [] }
    if (!envio?.configurado()) return { ok: false, estado: 'pendente', motivo: 'n8n_nao_configurado', ...vazio }
    if (ocupado) return { ok: false, estado: 'ocupado', motivo: 'coleta_em_andamento', ...vazio }
    ocupado = true
    try {
      const todos = comGrupo(), pedidos = clientes ? new Set(clientes) : null, por_cliente = []
      const vezes = new Map(); for (const x of todos) vezes.set(x.grupo, (vezes.get(x.grupo) || 0) + 1)
      const alvo = []
      for (const x of todos) if (!pedidos || pedidos.has(x.cliente)) (vezes.get(x.grupo) > 1 ? por_cliente.push({ cliente: x.cliente, estado: 'ignorado', motivo: 'grupo_compartilhado' }) : alvo.push(x))   // isolamento: grupo de 2 clientes não é lido
      if (pedidos) for (const c of pedidos) if (!todos.some(x => x.cliente === c)) por_cliente.push({ cliente: c, estado: 'ignorado', motivo: 'sem_grupo_ml' })
      const tam = Math.max(1, Math.min(60, W.grupos_por_chamada || 10)), paginas = Math.max(1, Math.min(5, W.paginas || 1))
      for (let i = 0; i < alvo.length; i += tam) {
        const lote = alvo.slice(i, i + tam), r = await envio.postar(W.caminho, { grupos: lote.map(x => x.grupo), paginas }, { ler: true })
        const lista = r.ok && Array.isArray(r.dados?.mensagens) ? r.dados.mensagens : null
        if (!lista) { const motivo = r.ok || r.erro === 'resposta_invalida' ? 'n8n_resposta_invalida' : `n8n_${r.status ?? r.erro ?? 'erro'}`; for (const x of lote) por_cliente.push({ cliente: x.cliente, estado: 'falhou', motivo }); continue }
        const porGrupo = new Map(lote.map(x => [x.grupo, []]))
        for (const bruto of lista) { const m = validarMensagem(bruto); if (m && porGrupo.has(m.grupo)) porGrupo.get(m.grupo).push(m) }   // grupo que não pedimos = descartado
        const em = agora()
        for (const x of lote) por_cliente.push({ cliente: x.cliente, estado: 'ok', ...processar(x.cliente, x.grupo, porGrupo.get(x.grupo), em) })
      }
      const soma = k => por_cliente.reduce((t, p) => t + (p[k] || 0), 0), tot = { lidas: soma('lidas'), guardadas: soma('guardadas'), repetidas: soma('repetidas'), ignoradas: soma('ignoradas') }
      log('info', `respostas ao relatório (${origem}, ${quem}): ${alvo.length} grupo(s), ${tot.lidas} lida(s), ${tot.guardadas} guardada(s), ${tot.ignoradas} ignorada(s)`)
      return { ok: !por_cliente.some(p => p.estado === 'falhou'), ...tot, por_cliente }
    } finally { ocupado = false }
  }

  // automático: 1×/dia a partir de cfg.coleta.hora (fuso do config), só para quem nunca foi lido ou teve âncora/plano enviado nos últimos `dias`; sem n8n não roda
  async function tick({ agoraMs = Date.parse(agora()) } = {}) {
    if (!envio?.configurado()) return { rodou: false, motivo: 'n8n_nao_configurado' }
    const { dia, hm } = noFuso(agoraMs, cfg.coleta.fuso)
    if (hm < cfg.coleta.hora) return { rodou: false, motivo: 'fora_da_hora' }
    if (est.get('feedback_tick_dia') === dia) return { rodou: false, motivo: 'ja_rodou_hoje' }
    est.set('feedback_tick_dia', dia)                              // ponytail: marca antes de rodar — n8n fora do ar = tenta de novo amanhã, sem martelar a cada 10 min
    const corte = agoraMs / 1000 - dias * 86400
    const alvo = comGrupo().filter(x => {
      const c = lerColeta(x.cliente); if (!c.ultima_coleta) return true
      return Math.max(0, ...c.ancoras.map(a => a.ts), (Date.parse(envioDe(x.cliente)) / 1000) || 0) >= corte
    }).map(x => x.cliente)
    if (!alvo.length) return { rodou: false, motivo: 'sem_ancora_recente' }
    return { rodou: true, ...(await coletar({ clientes: alvo, origem: 'automatico' })) }
  }

  // lista para a tela: status (padrão = tudo menos descartado) e tema (lista fechada); resumo por tema/cliente/status sobre o recorte de status
  function listar({ status = '', tema = '', cliente = '' } = {}) {
    if (status && !STATUS.includes(status)) throw erro('status inválido')
    if (tema && !TEMAS.includes(tema)) throw erro('tema inválido')
    const w = ["cliente NOT LIKE '[Comercial]%'", status ? 'status = @status' : "status <> 'descartado'"], p = status ? { status } : {}
    if (cliente) { w.push('cliente = @cliente'); p.cliente = cliente }
    const base = h.prepare(`SELECT msg_id, cliente, autor_nome, texto, recebido_em, ancora_tipo, relacao, confianca, temas_json, status, nota_interna, status_por, status_em, origem
      FROM feedback_relatorio WHERE ${w.join(' AND ')} ORDER BY recebido_em DESC`).all(p).map(({ temas_json, ...r }) => ({ ...r, temas: parse(temas_json, []) }))
    const por_tema = Object.fromEntries(TEMAS.map(t => [t, 0])), por_cliente = {}
    let sem_tema = 0
    for (const r of base) { r.temas.length ? r.temas.forEach(t => { if (t in por_tema) por_tema[t]++ }) : sem_tema++; por_cliente[r.cliente] = (por_cliente[r.cliente] || 0) + 1 }
    const por_status = Object.fromEntries(h.prepare("SELECT status, COUNT(*) n FROM feedback_relatorio WHERE cliente NOT LIKE '[Comercial]%' GROUP BY status").all().map(r => [r.status, r.n]))
    const itens = (tema ? base.filter(r => r.temas.includes(tema)) : base).slice(0, 500)
    const ult = h.prepare('SELECT MAX(ultima_coleta) u, COUNT(*) n FROM feedback_coleta').get()
    return { total: base.length, itens, resumo: { por_tema, sem_tema, por_cliente: Object.entries(por_cliente).map(([c, n]) => ({ cliente: c, n })).sort((a, b) => b.n - a.n), por_status },
      temas: TEMAS, status: STATUS, coleta: { configurado: !!envio?.configurado(), ultima: ult?.u || '', clientes_lidos: ult?.n || 0, clientes_com_grupo: comGrupo().length } }
  }

  // líder/consultor marca: { msg_id, status, nota?, por } — nota ausente mantém a atual. Descartar vira LÁPIDE: texto, 1º nome e temas apagados; a linha fica para a próxima
  // coleta não regravar a mensagem (INSERT OR IGNORE), e descartada não volta (409)
  function marcar({ msg_id, status, nota, por }) {
    const quem = validarPor(str(por)); if (!quem) throw erro('informe quem decide (líder ou consultor)', 403)
    if (!STATUS.includes(status)) throw erro('status inválido')
    if (nota !== undefined && nota !== null && typeof nota !== 'string') throw erro('nota inválida')
    const id = str(msg_id); if (!id || id.length > 128) throw erro('informe "msg_id"')
    const n = typeof nota === 'string' ? limpo(nota).slice(0, 500) : null
    const atual = h.prepare("SELECT status FROM feedback_relatorio WHERE msg_id = ? AND cliente NOT LIKE '[Comercial]%'").get(id)
    if (!atual) throw erro('resposta não encontrada', 404)
    if (atual.status === 'descartado' && status !== 'descartado') throw erro('resposta descartada não volta: o texto foi apagado', 409)
    const lapide = status === 'descartado' ? ", texto = '', autor_nome = '', autor_hash = '', temas_json = '[]'" : ''
    h.prepare(`UPDATE feedback_relatorio SET status = ?, nota_interna = COALESCE(?, nota_interna), status_por = ?, status_em = ?${lapide} WHERE msg_id = ?`).run(status, n, quem, agora(), id)
    return { ok: true, msg_id: id, status }
  }

  return { coletar, tick, listar, marcar, configurado: () => !!envio?.configurado() }
}
