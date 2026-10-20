// Entrega dos lotes de aviso ao cliente (docs/desenho-gatilhos-n8n.md seções 4 e 6). O n8n ENTREGA (WhatsApp, e-mail, Discord), não decide: recebe o texto final
// já auditado e devolve o recibo por canal. O Notion NÃO passa pelo n8n: reutiliza criarRelatorioNotion (destino, categoria, idempotência por título) como o alerta faz.
// HMAC-SHA256 nas duas direções (molde custos-webhook.js): x-place-ts + x-place-sig = HMAC(secret, ts + '.' + corpo cru), carimbo ±300 s, 401 sempre igual.
// Honestidade: sem PLACE_GATILHOS_URL/SECRET o lote fica 'pendente' com motivo fixo n8n_nao_configurado (nunca "enviado"). Número/e-mail/webhook saem no payload ao n8n e NUNCA no log.
// Puro: env, fetch, relógio e Notion entram por injeção (o autoteste usa stubs); a fiação real está em gatilhos-real.js.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { CATEGORIA } from './relatorio-seguro.js'
import { criarRelatorioNotion, decidirCategoria, classificarErro, rt } from './relatorio-notion.js'
import { TITULO, dividirMensagem, lerCfgRelatorio } from './plano-semana-texto.js'
import { RX_DISCORD } from './gatilhos-destinos-notion.js'

// canais ao cliente pelo n8n (12/10/2026): WhatsApp (grupo do Mercado Livre) e e-mail; o Discord do cliente é só da equipe e não recebe aviso ao cliente
export const CANAIS_N8N = ['whatsapp', 'email']
// título da página no Notion / assunto do e-mail: «Plano da semana · dd/mm/aaaa» ou «Ponto importante da conta · dd/mm/aaaa · HH:MM» (o lote diário e o título antigo acabaram em 12/10/2026)
const PREFIXOS_AVISO = Object.values(TITULO).map(t => `${t} · `)
export const tituloAvisoOk = t => { const s = String(t ?? ''), p = PREFIXOS_AVISO.find(x => s.startsWith(x)); return !!p && s.length > p.length && s.length <= 200 && !/[\r\n]/.test(s) }
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
// e-mail: as marcas do WhatsApp viram HTML (*negrito* → <b>, _itálico_ → <i>) depois do escape; o «_» de dentro de um link (…-_JM) não é marca (exige espaço ou início antes)
export const htmlDoTexto = t => esc(t).replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,:;!?])/gm, '$1<i>$2</i>').replace(/\n/g, '<br>')

// ── assinatura (as duas direções usam a MESMA forma: hex puro, sem prefixo "sha256=") ───────────────────────────────────
export const assinar = (secret, ts, corpo) => createHmac('sha256', Buffer.from(String(secret), 'utf8')).update(`${ts}.`).update(Buffer.isBuffer(corpo) ? corpo : Buffer.from(String(corpo ?? ''))).digest('hex')
const cab = (headers, nome) => { for (const [k, v] of Object.entries(headers || {})) if (k.toLowerCase() === nome) return Array.isArray(v) ? v[0] : v }
// segredo com menos de 32 caracteres vale como AUSENTE (x-place-key é força bruta online pelo túnel): o envio fica pendente/n8n_nao_configurado e as rotas HMAC negam tudo
export const SEGREDO_MIN = 32
export const segredoValido = s => String(s ?? '').length >= SEGREDO_MIN
const h256 = s => createHash('sha256').update(Buffer.from(String(s), 'utf8')).digest()
// → true com (a) x-place-key igual ao segredo (Header Auth do n8n Community, que não tem $env para calcular HMAC) ou (b) carimbo dentro da janela e assinatura HMAC igual;
// as duas comparações em tempo constante sobre sha256 (tamanho fixo: nem o comprimento do segredo vaza); qualquer outra coisa (sem segredo, ts inválido, hex errado) = false
export function verificarAssinatura({ secret, headers = {}, raw, agoraMs = Date.now(), janelaS = 300 }) {
  if (!segredoValido(secret)) return false
  const chave = cab(headers, 'x-place-key')
  if (chave !== undefined) return timingSafeEqual(h256(chave), h256(secret))
  const ts = String(cab(headers, 'x-place-ts') ?? ''), sig = String(cab(headers, 'x-place-sig') ?? '')
  if (!/^\d{1,12}$/.test(ts) || Math.abs(Math.floor(agoraMs / 1000) - Number(ts)) > janelaS) return false
  if (!/^[0-9a-f]{64}$/i.test(sig)) return false
  return timingSafeEqual(Buffer.from(assinar(secret, ts, raw), 'hex'), Buffer.from(sig, 'hex'))
}

// deps: env { PLACE_GATILHOS_URL, PLACE_GATILHOS_SECRET } (lidos a cada chamada), fetch, agora() ISO, webhook { caminho, caminho_teste, timeout_ms },
//       notion? { req } + destinos? { fontes, resolverPaginaCliente, acharInformacoesDb, invalidar } + estado (sync_estado) → canal Notion; sem eles o canal Notion falha com motivo fixo
//       notionCfg { icone, status_aberto, categoria }, log(nivel, msg)
export function criarEnvio({ env = {}, fetch = globalThis.fetch, agora = () => new Date().toISOString(), webhook = {}, notion = null, destinos = null, estado = null, notionCfg = {}, log = () => {} }) {
  const W = { caminho: '/webhook/place-gatilhos', caminho_teste: '/webhook/place-gatilhos-teste', timeout_ms: 15_000, ...webhook }
  const NC = { icone: '📣', status_aberto: ['pendente', 'em andamento'], categoria: CATEGORIA, ...notionCfg }
  const url = () => String(env.PLACE_GATILHOS_URL || '').replace(/\/$/, ''), secret = () => segredoValido(env.PLACE_GATILHOS_SECRET) ? String(env.PLACE_GATILHOS_SECRET) : ''
  const configurado = () => !!(url() && secret())
  if (env.PLACE_GATILHOS_SECRET && !secret()) log('aviso', `gatilhos: PLACE_GATILHOS_SECRET com menos de ${SEGREDO_MIN} caracteres é tratado como ausente (entrega fica pendente)`)
  const destinoN8n = (canal, d) => canal === 'whatsapp' ? String(d).replace(/^\+/, '') : d     // Evolution espera dígitos ou JID, sem '+'
  const nt = notion && destinos && estado ? criarRelatorioNotion({ notion, estado, fontes: destinos.fontes, resolverPaginaCliente: destinos.resolverPaginaCliente, acharInformacoesDb: destinos.acharInformacoesDb, invalidar: destinos.invalidar, agora }) : null

  // POST assinado ao n8n; nunca lança: { ok, status | erro }. Timeout = W.timeout_ms; quem chama decide o retry (não há retry aqui).
  // ler:true (coleta de respostas, respostas-relatorio.js) devolve também o corpo JSON em `dados`; corpo que não é JSON = { ok:false, erro:'resposta_invalida' }
  async function postar(caminho, payload, { ler = false } = {}) {
    const corpo = JSON.stringify(payload), ts = Math.floor(Date.parse(agora()) / 1000), ctl = new AbortController(), t = setTimeout(() => ctl.abort(), W.timeout_ms)
    try {
      // x-place-key = Header Auth do webhook no n8n Community (sem $env); x-place-ts/x-place-sig = HMAC para um n8n que saiba calcular (os dois vão sempre)
      const r = await fetch(url() + caminho, { method: 'POST', headers: { 'content-type': 'application/json', 'x-place-key': secret(), 'x-place-ts': String(ts), 'x-place-sig': assinar(secret(), ts, corpo) }, body: corpo, signal: ctl.signal })
      if (!ler || !r.ok) return { ok: r.ok, status: r.status }
      try { return { ok: true, status: r.status, dados: await r.json() } } catch (e) { return { ok: false, erro: e?.name === 'AbortError' ? 'timeout' : 'resposta_invalida' } }
    } catch (e) { return { ok: false, erro: e?.name === 'AbortError' ? 'timeout' : 'rede' } } finally { clearTimeout(t) }
  }
  const motivoHttp = r => r.ok ? '' : `n8n_${r.status ?? r.erro ?? 'erro'}`

  // ── Notion: página «Plano da semana · dd/mm/aaaa» / «Ponto importante da conta · dd/mm/aaaa · HH:MM» na base Informações do cliente; idempotente por título; só categoria/Status que JÁ existem ──
  async function entregarNotion({ lote }) {
    if (!nt) return { estado: 'falhou', motivo: 'notion_nao_configurado' }
    try {
      const d = await nt.destinoDe(lote.cliente)
      if (d.estado !== 'ok') return { estado: 'falhou', motivo: d.estado }                    // destino_compartilhado também barra: aviso automático nunca cai na base de outro cliente
      if (decidirCategoria(d.esquema, { categoria: NC.categoria }).estado !== 'ok') return { estado: 'falhou', motivo: 'categoria_ausente' }
      const titulo = lote.titulo
      if (!tituloAvisoOk(titulo)) return { estado: 'falhou', motivo: 'titulo_invalido' }
      const achadas = await nt.acharPorTitulo(d, titulo)
      if (achadas.length) return { estado: 'entregue', adotado: true, url: achadas[0].url, page_id: achadas[0].id }
      // o texto da mensagem (WhatsApp) vira parágrafos: sem as marcas *negrito* e _itálico_ do WhatsApp; a última linha (nota/assinatura) em cinza depois de um divisor
      const sem = l => l.replace(/\*/g, '').replace(/^_(.*)_$/, '$1'), bloco = (type, corpo) => ({ object: 'block', type, [type]: corpo })
      // UM parágrafo por bloco da mensagem (as linhas do bloco juntas; o rt parte em trechos ≤ 1900): o relatório didático passa de 100 linhas e o Notion recusa mais de
      // 100 blocos na criação da página — por linha, o fim (blocos pedidos, glossário) sumia sem aviso. ponytail: teto de 98 só por segurança (~20 parágrafos hoje)
      const pars = String(lote.texto).split(/\n\s*\n/).map(p => p.split('\n').filter(l => l.trim()).map(sem)).filter(p => p.length)
      const fim = pars.at(-1) || [], ultima = fim.pop() || ''; if (!fim.length) pars.pop()
      const blocos = [...pars.slice(0, 98).map(p => bloco('paragraph', { rich_text: rt(p.join('\n')) })), bloco('divider', {}), bloco('paragraph', { rich_text: rt(ultima, { color: 'gray' }) })]
      const pg = await nt.criar({ destino: d, titulo, blocos, validarTitulo: tituloAvisoOk, icone: NC.icone, categoria: NC.categoria, statusPreferido: NC.status_aberto })
      return { estado: 'entregue', adotado: false, url: pg.url, page_id: pg.id }
    } catch (e) {
      const c = classificarErro(e); log('erro', `gatilhos ${lote.cliente}: Notion ${c.codigo}`)
      return { estado: 'falhou', motivo: c.codigo }
    }
  }

  // ── um lote → canais do cliente. Devolve { estado: enviado | entregue | parcial | pendente | falhou, motivo, recibos } ──
  async function enviar({ lote, notificacao }) {
    const canais = notificacao?.canais || {}, n8n = CANAIS_N8N.filter(k => canais[k]?.ligado && canais[k]?.destino), temNotion = !!canais.notion?.ligado
    const recibos = {}, em = agora()
    if (temNotion) { const r = await entregarNotion({ lote }); recibos.notion = { estado: r.estado, em, ...(r.motivo ? { motivo: r.motivo } : {}), ...(r.url ? { url: r.url } : {}) } }
    if (!n8n.length) return !temNotion ? { estado: 'falhou', motivo: 'sem_canal', recibos } : { estado: recibos.notion.estado, motivo: recibos.notion.motivo || '', recibos }
    if (!configurado()) return { estado: 'pendente', motivo: 'n8n_nao_configurado', recibos }
    // whatsapp_partes (Etapa 3, 13/10/2026): o texto do WhatsApp acima de ~4.000 caracteres sai em partes, NA ORDEM, cortadas só entre parágrafos (dividirMensagem);
    // o fluxo n8n abre 1 envio por parte e devolve UM recibo do canal (entregue só se todas saíram). E-mail e Notion recebem o texto inteiro.
    const rel = lerCfgRelatorio()
    const payload = {
      lote_id: lote.id, cliente_rotulo: lote.cliente, tipo: lote.tipo, assunto: lote.titulo, texto: lote.texto, texto_html: htmlDoTexto(lote.texto), link: '',
      canais: Object.fromEntries(n8n.map(k => [k, { ligado: true, destino: destinoN8n(k, canais[k].destino) }])),
      whatsapp_partes: dividirMensagem(lote.texto, { max: rel.whatsapp_max_caracteres, continua: rel.continua }),
    }
    const r = await postar(W.caminho, payload)
    if (r.ok) return { estado: 'enviado', motivo: '', recibos }
    return { estado: recibos.notion?.estado === 'entregue' ? 'parcial' : 'falhou', motivo: motivoHttp(r), recibos }
  }

  // ── aviso INTERNO ao consultor (consultor-discord.js, 12/10/2026): o canal do cliente no Discord é da EQUIPE (o cliente não está lá). MESMO webhook do n8n, tipo
  // interno_semanal | interno_imediato, interno:true, só o canal discord (destino = «Webhook ML» da central, validado aqui de novo) e discord_partes (≤ 1900 caracteres cada,
  // na ordem; o Discord recusa > 2000). discord_mencionar = ids de USUÁRIO (o consultor) e discord_mencionar_cargos = ids de CARGO (os 3 do time, config/discord-time.json) que a
  // mensagem pode marcar: o n8n usa em allowed_mentions { parse: [], users, roles } — nenhum @everyone/@here, nenhum outro id. Só ids numéricos de 15 a 21 dígitos saem daqui.
  async function enviarInterno({ lote, destino, partes = [], mencionar = [], mencionarCargos = [] }) {
    if (!RX_DISCORD.test(String(destino || ''))) return { estado: 'pendente', motivo: 'sem_destino' }
    if (!configurado()) return { estado: 'pendente', motivo: 'n8n_nao_configurado' }
    const ids = l => (Array.isArray(l) ? l : []).map(String).filter(x => /^\d{15,21}$/.test(x))
    const r = await postar(W.caminho, { lote_id: lote.id, cliente_rotulo: lote.cliente, tipo: lote.tipo, interno: true, assunto: lote.assunto, texto: partes.join('\n'), texto_html: '', link: '',
      canais: { discord: { ligado: true, destino } }, discord_partes: partes, discord_mencionar: ids(mencionar), discord_mencionar_cargos: ids(mencionarCargos) })
    return r.ok ? { estado: 'enviado', motivo: '' } : { estado: 'falhou', motivo: motivoHttp(r) }
  }

  // ── teste de canal: payload FIXO do fluxo place-gatilhos-teste (o n8n monta a mensagem fixa "este é o canal de avisos da Place2u"); nenhum dado do cliente além do destino ──
  async function testar({ cliente, canal, destino }) {
    if (!CANAIS_N8N.includes(canal)) return { estado: 'nao_aplicavel', motivo: 'canal_invalido' }
    if (!configurado()) return { estado: 'pendente', motivo: 'n8n_nao_configurado' }
    const r = await postar(W.caminho_teste, { lote_id: `teste-${randomBytes(6).toString('hex')}`, canal, destino: destinoN8n(canal, destino), cliente_rotulo: cliente })
    return r.ok ? { estado: 'enviado', motivo: '' } : { estado: 'falhou', motivo: motivoHttp(r) }
  }

  return { enviar, enviarInterno, testar, entregarNotion, configurado, postar, invalidarCaches: () => nt?.invalidarCaches() }
}
