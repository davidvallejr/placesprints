// Fotos do anúncio para a galeria da tela do cliente (GET /api/cliente/anuncio/fotos em rotas-historico.js). Só leitura: nunca escreve no ML nem no banco.
// Fonte, nesta ordem: fotografia do "Como era" (meli_item_snapshot.fotos_json, ids das fotos) com até 7 dias → leitura ao vivo do item com o token do
// cliente (detalhesItens de meli-api.js: GET /items, campo pictures) → só a capa (meli_item.thumb). Falha do ML nunca vira erro: cai na capa ('capa').
// URL montada AQUI a partir do id da foto, sempre https://http2.mlstatic.com. Sufixo -O (medido com curl em 14/10/2026): proporção original, lado maior
// até 500 px — é a foto como o comprador vê na página do anúncio; -F (1200 px) pesa 3–5× mais; -V/-W são quadrados recortados. .webp ≈ 1/3 do .jpg.
export const MAX_FOTOS = 8                                                       // capa + 7
const ID_FOTO = /^\d+-ML[A-Z]\d+_\d+$/
const DA_URL = /^https?:\/\/http2\.mlstatic\.com\/D_(?:NQ_NP_(?:2X_)?)?(\d+-ML[A-Z]\d+_\d+)-[A-Z]\.(?:jpe?g|webp|png)$/i
export const urlFoto = id => ID_FOTO.test(String(id)) ? `https://http2.mlstatic.com/D_${id}-O.webp` : null
export const idDaUrl = u => (String(u || '').match(DA_URL) || [])[1] || null
const lista = s => { try { const v = JSON.parse(s); return Array.isArray(v) ? v.map(String).filter(i => ID_FOTO.test(i)) : [] } catch { return [] } }
const resposta = (item_id, ids, fonte, lido_em, total = ids.length) => ({ item_id, fotos: ids.slice(0, MAX_FOTOS).map((id, i) => ({ url: urlFoto(id), ordem: i + 1 })), total, fonte, lido_em })

// deps: handle (better-sqlite3), lerItem(cliente, item_id) → item do ML com `pictures` | { _erro } | lança. agora() em ms (o teste controla o relógio).
// ponytail: cache e fila em memória do processo (somem ao reiniciar; 1 servidor local). Teto por entradas, a mais antiga sai primeiro.
export function criarFotosAnuncio({ handle, lerItem, agora = () => Date.now(), ttlMs = 6 * 3600e3, ttlCapaMs = 5 * 60e3, maxCache = 2000, maxParalelo = 3, timeoutMs = 8000, snapshotDias = 7 }) {
  const snapQ = handle.prepare("SELECT fotos_json, capturado_em FROM meli_item_snapshot WHERE cliente = ? AND item_id = ? AND fotos_json NOT IN ('', '[]') ORDER BY capturado_em DESC LIMIT 1")
  const itemQ = handle.prepare('SELECT thumb, fotos, atualizado_em FROM meli_item WHERE cliente = ? AND item_id = ?')
  const cache = new Map(), emVoo = new Map(), fila = []
  let ativos = 0
  const comVaga = async fn => {                                                  // no máximo maxParalelo leituras ao ML ao mesmo tempo
    while (ativos >= maxParalelo) await new Promise(ok => fila.push(ok))
    ativos++
    try { return await fn() } finally { ativos--; fila.shift()?.() }
  }
  const guardar = (k, valor, ttl) => { cache.delete(k); cache.set(k, { valor, ate: agora() + ttl }); while (cache.size > maxCache) cache.delete(cache.keys().next().value) }

  // ids das fotos lidas agora no ML, ou null (sem conexão, erro, tempo esgotado). A vaga só é devolvida quando a leitura termina de fato.
  // O prazo conta desde a entrada na fila; quem ainda esperava vaga quando ele venceu não vai mais ao ML (ninguém esperaria a resposta).
  async function aoVivo(cliente, item_id) {
    let timer, desistiu = false
    const leitura = comVaga(() => desistiu ? null : lerItem(cliente, item_id)).catch(() => null)   // catch aqui: depois do tempo esgotado ninguém mais escuta
    const limite = new Promise(ok => { timer = setTimeout(() => { desistiu = true; ok(null) }, timeoutMs) })
    try {
      const it = await Promise.race([leitura, limite])
      if (!it || it._erro || !Array.isArray(it.pictures)) return null
      return it.pictures.map(p => ID_FOTO.test(String(p?.id)) ? String(p.id) : idDaUrl(p?.secure_url || p?.url)).filter(Boolean)
    } finally { clearTimeout(timer) }
  }

  async function montar(cliente, item_id) {
    const s = snapQ.get(cliente, item_id), ids = s ? lista(s.fotos_json) : []
    if (ids.length && agora() - Date.parse(s.capturado_em) <= snapshotDias * 864e5) return resposta(item_id, ids, 'snapshot', s.capturado_em)
    const vivo = await aoVivo(cliente, item_id)
    if (vivo?.length) return resposta(item_id, vivo, 'ml', new Date(agora()).toISOString())
    const m = itemQ.get(cliente, item_id) || {}, capa = idDaUrl(m.thumb)
    return resposta(item_id, capa ? [capa] : [], 'capa', m.atualizado_em || null, Math.max(Number(m.fotos) || 0, capa ? 1 : 0))
  }

  // a rota já validou: item é DESTE cliente e o id é ^MLB\d+$. Chave do cache = cliente + item (isolamento).
  function fotos(cliente, item_id) {
    const k = cliente + '\u0000' + item_id, c = cache.get(k)
    if (c && c.ate > agora()) return Promise.resolve(c.valor)
    if (!emVoo.has(k)) emVoo.set(k, montar(cliente, item_id).then(r => { guardar(k, r, r.fonte === 'capa' ? ttlCapaMs : ttlMs); return r }).finally(() => emVoo.delete(k)))
    return emVoo.get(k)
  }
  return { fotos, cache }
}
