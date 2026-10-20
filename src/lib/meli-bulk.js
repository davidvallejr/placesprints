// Formato do multiget de anúncios do Mercado Livre: /items/bulk (o multiget antigo de /items sai do ar em 25/10/2026). PURO, sem import:
// promocoes-coleta.js usa isto e não pode carregar meli-api.js (que abre o banco). O laço com a guarda é o multiget de meli-api.js.
// Formato REAL (2 GETs no Uniaodog em 14/10/2026, docs/manual-integracao-ml.md § multiget): array na ordem dos ids, cada elemento
// { id, status_code, body }; item inexistente = { id, status_code: 404 } sem body. O filtro attributes vale para o ELEMENTO inteiro:
// pedindo só body.* a raiz some (vem { body }) e o item 404 vira {} — por isso a URL SEMPRE pede id e status_code na raiz.
// `bundle` NÃO vem no bulk (pedido como body.bundle num anúncio com tag bundle: ausente) — kit virtual só por GET /items/{id}.
// `variations[].attributes` (o SELLER_SKU da variação) só vem com include_attributes=all (doc de variações; 1 GET real em 14/10/2026: 62 de 70 variações com SKU,
// payload 286 → 357 KB por lote de 20, a mesma chamada) — `extra` acrescenta esse parâmetro à URL.
export const LOTE_BULK = 20

// attrs: 'id,title,…' (campos do anúncio, sem prefixo) → /items/bulk?ids=…&attributes=id,status_code,body.id,body.title,…[&extra]
export const urlBulk = (ids, attrs, extra = '') =>
  `/items/bulk?ids=${ids.map(encodeURIComponent).join(',')}&attributes=id,status_code,${String(attrs).split(',').map(a => `body.${a.trim()}`).join(',')}${extra ? `&${extra}` : ''}`

// resposta crua de UM lote (o que chamar devolve com permitirFalha) → { corpos, erros: [[id, status]], falhou }.
// status_code (novo) ?? code (antigo). Corpo válido = 200 com body e id (raiz ou body). Sem id na raiz, o item é atribuído pela ordem só se
// o tamanho bate com o pedido (senão fica id ''). Lote inteiro com erro ou fora do formato = falhou (todos os ids com o status do lote).
export function lerLoteBulk(r, ids) {
  if (r?._erro || !Array.isArray(r)) return { corpos: [], erros: ids.map(id => [id, r?.status ?? 0]), falhou: true }
  const corpos = [], erros = []
  r.forEach((x, k) => {
    const st = x?.status_code ?? x?.code
    const id = String(x?.id ?? x?.body?.id ?? (r.length === ids.length ? ids[k] : ''))
    if (st === 200 && x.body && typeof x.body === 'object' && id) corpos.push({ ...x.body, id: x.body.id ?? id })
    else erros.push([id, Number.isInteger(st) ? st : 0])
  })
  return { corpos, erros, falhou: false }
}
