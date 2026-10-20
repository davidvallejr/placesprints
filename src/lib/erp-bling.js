// Conector Bling (API v3) da integração de custos por SKU — SOMENTE LEITURA (docs/integracao-custos-erp-SPEC.md, 7.1 e 7.2).
// Só faz GET. Entrega o custo BRUTO (ou null) do campo `precoCusto` do fornecedor padrão: quem decide validade é o aplicarLote
// (custos-db.js). Nunca devolve 0 como custo, nunca usa `precoCompra` como custo, nunca inventa SKU (SKU = `codigo` do Bling).
// Rede, token e ritmo são injetados (M6); nada aqui lê banco, .env ou loga token.
// NÃO CONFIRMADO (fixtures construídas da doc, sem API real — checklist 14.2 da spec): criterio=5 = "todos"; efeito do filtro de
// saldo; `idProdutoPai` na listagem; situacao 'E' = excluído; `precoCusto` na raiz do detalhe (lê raiz, depois fornecedor);
// forma de `estrutura.componentes`; corpo do 401; `period:"day"` no 429.

const BASE = 'https://api.bling.com.br/Api/v3'
const LIMITE = 100, TETO_PAGINAS = 500, MAX_429 = 4
export const CAMPO_BLING = 'bling.fornecedor_padrao.precoCusto'

// codigo: 'reautorizar' (401 após 1 renovação, 403, invalid_grant, empresa inativa) | 'limite_dia' (429 diário) | 'http' (resto)
const erro = (codigo, msg, status = 0) => Object.assign(new Error(msg), { codigo, status })
// o corpo do ERP pode ecoar a requisição: tira o que pareça credencial e corta em 300
const sanitizar = s => String(s ?? '')
  .replace(/Bearer\s+[^\s"',]+/gi, 'Bearer ***').replace(/eyJ[\w-]+\.[\w-]+\.[\w-]*/g, '***')
  .replace(/(access_token|refresh_token|client_secret|code)(["'\s:=]+)[^\s"',&}]+/gi, '$1$2***').slice(0, 300)
const lerJson = t => { try { return JSON.parse(t) } catch { return null } }
const semCusto = v => v == null || v === '' || Number(v) === 0          // ausente/nulo/0: vai ao detalhe; na saída vira null, nunca 0
const primeiroCusto = (...vs) => vs.find(v => !semCusto(v)) ?? null     // mesmo campo (fornecedor padrão) em lugares diferentes, sem fallback de campo

const linha = (p, custo, variacao_de = null, dica = '') => ({
  sku: p.codigo ?? '', mlb: null, custo, campo: CAMPO_BLING, id_externo: String(p.id ?? ''),
  atualizado_na_fonte: null,                                          // o Bling não informa data de alteração do custo
  variacao_de, ...(dica && { dica }),
})
const dicaSemCusto = (p, d) => {
  const compra = primeiroCusto(p.precoCompra, d?.precoCompra, d?.fornecedor?.precoCompra)
  return 'sem precoCusto do fornecedor padrão no Bling' + (compra == null ? '' : ` (precoCompra ${compra} existe, mas não é usado como custo)`)
}
// estrutura incompleta (sem id ou quantidade inválida) = sem estrutura: o kit fica pendente, não se inventa soma
const estrutura = d => {
  const cs = d?.estrutura?.componentes
  if (!Array.isArray(cs) || !cs.length) return null
  const out = cs.map(c => ({ id_externo: String(c?.produto?.id ?? ''), quantidade: Number(c?.quantidade) }))
  return out.every(c => c.id_externo && Number.isFinite(c.quantidade) && c.quantidade > 0) ? out : null
}
const kit = (p, d) => ({ id_externo: String(p.id ?? ''), sku: p.codigo ?? '', custo_proprio: primeiroCusto(p.precoCusto, d?.precoCusto, d?.fornecedor?.precoCusto), componentes: estrutura(d) })

// deps: { http, limitador, obterToken, log } (contrato 7.1). Extras opcionais: parametros (query extra da listagem, ex. filtro de
// saldo; `pagina`/`limite` são sempre do conector) e tetoDetalhes (detalhes por varredura; excedente sai em `pendentes_detalhe`).
export function criarConectorBling({ http, limitador, obterToken, log = () => {}, parametros = { criterio: 5 }, tetoDetalhes = 500 }) {
  async function token(renovar) {
    let t
    try { t = await obterToken(renovar ? { renovar: true } : {}) }
    catch (e) { throw erro(/invalid_grant|empresa inativa/i.test(e?.message) ? 'reautorizar' : 'http', `Bling: falha ao obter o token (${sanitizar(e?.message)})`) }
    if (!t) throw erro('reautorizar', 'Bling sem autorização válida: o cliente precisa autorizar de novo.')
    return t
  }

  async function chamar(caminho) {
    let renovou = false, forcar = false, n429 = 0
    for (;;) {
      const tk = await token(forcar); forcar = false
      await limitador.aguardar()
      let r
      try { r = await http({ metodo: 'GET', url: BASE + caminho, headers: { Authorization: `Bearer ${tk}`, 'enable-jwt': '1', Accept: 'application/json' }, timeoutMs: 20000 }) }
      catch (e) { throw erro('http', `Bling: falha de rede em ${caminho} (${sanitizar(e?.message)})`) }
      if (r.status >= 200 && r.status < 300) {
        const j = lerJson(r.texto)
        if (!j) throw erro('http', `Bling: resposta não-JSON em ${caminho}`, r.status)
        return j
      }
      const periodo = lerJson(r.texto)?.error?.period
      if (r.status === 429 && periodo === 'day') throw erro('limite_dia', 'Bling: limite diário de requisições da conta atingido; nova tentativa amanhã.', 429)
      if (r.status === 429 && n429++ < MAX_429) {                  // 429 sem Retry-After: espera >= 1 s com jitter (o limitador segura a próxima)
        const ms = 1000 + Math.floor(Math.random() * 500)
        log('aviso', `bling: 429 por segundo, nova tentativa em ${ms} ms`)
        limitador.registrar429(ms)
        continue
      }
      const reaut = /invalid_grant|empresa inativa/i.test(r.texto)
      if (r.status === 401 && !renovou && !reaut) { renovou = forcar = true; continue }   // renova UMA vez, sem laço
      if (r.status === 401 || r.status === 403 || reaut) throw erro('reautorizar', `Bling ${r.status}: token recusado ou sem permissão (escopo/empresa inativa); reautorize. ${sanitizar(r.texto)}`, r.status)
      throw erro('http', `Bling ${r.status} em ${caminho}: ${sanitizar(r.texto)}`, r.status)   // demais 4xx/5xx: sem repetir
    }
  }

  // detalhe dentro da varredura: 4xx de UM produto (ex.: excluído no meio) não derruba a varredura; credencial/limite derrubam
  async function detalheTolerante(id, avisos) {
    try { return (await chamar(`/produtos/${encodeURIComponent(id)}`)).data ?? null }
    catch (e) {
      if (e.codigo !== 'http' || e.status < 400 || e.status >= 500 || e.status === 429) throw e
      avisos.push(`detalhe do produto ${id} falhou (HTTP ${e.status})`)
      return null
    }
  }

  async function testar() {
    try {
      const d = (await chamar('/empresas/me/dados-basicos')).data
      if (d?.id == null || d.id === '') return { ok: false, empresa: null, erro: 'Bling não devolveu o id da empresa.' }
      return { ok: true, empresa: { id: String(d.id), nome: String(d.nome ?? '') } }
    } catch (e) { return { ok: false, empresa: null, erro: e.message, codigo: e.codigo } }
  }

  // Páginas da listagem com os itens simples; o ÚLTIMO lote traz os adiados (kits, variações e sem custo na listagem), porque
  // o SKU do pai da variação pode vir em página posterior e o teto de detalhes prioriza `prioridadeSkus` na varredura inteira.
  // Termina sem lançar = varredura completa (o M7 pode fechar o sync completo); lançou = incompleta.
  async function* varrer({ prioridadeSkus = [] } = {}) {
    const prio = new Set([...prioridadeSkus].map(s => String(s).toLowerCase()))
    const skuDoId = new Map(), adiados = []
    let ultima = 0
    for (let pagina = 1; ; pagina++) {
      if (pagina > TETO_PAGINAS) throw erro('http', `Bling: mais de ${TETO_PAGINAS} páginas; varredura interrompida (incompleta).`)
      const q = new URLSearchParams({ ...parametros, pagina, limite: LIMITE })
      const data = (await chamar(`/produtos?${q}`)).data
      if (!Array.isArray(data)) throw erro('http', 'Bling: listagem sem "data".')
      if (!data.length) break
      const linhas = [], avisos = []
      let pais = 0, excluidos = 0
      for (const p of data) {
        skuDoId.set(String(p.id), p.codigo ?? '')
        if (p.situacao === 'E') excluidos++                                            // situacao 'E' = excluído (formato 'E' = kit)
        else if (p.formato === 'V') pais++                                             // pai de variações: sem custo próprio
        else if (p.formato === 'E' || p.idProdutoPai || semCusto(p.precoCusto)) adiados.push(p)
        else linhas.push(linha(p, p.precoCusto))                                       // inativo ('I') entra: custo continua valendo
      }
      if (pais) avisos.push(`${pais} produto(s) pai de variação ignorado(s): não têm custo próprio`)
      if (excluidos) avisos.push(`${excluidos} produto(s) excluído(s) no Bling ignorado(s)`)
      yield { pagina, linhas, kits: [], avisos }
      ultima = pagina
      if (data.length < LIMITE) break
    }
    if (!adiados.length) return

    const ehPrio = p => prio.has(String(p.codigo ?? '').toLowerCase())
    adiados.sort((a, b) => ehPrio(b) - ehPrio(a))                                     // estável: SKUs de anúncio primeiro no teto
    const linhas = [], kits = [], avisos = [], pendentes_detalhe = []
    let detalhes = 0
    for (const p of adiados) {
      let d = null, pendente = false
      if (p.formato === 'E' || semCusto(p.precoCusto)) {
        if (detalhes < tetoDetalhes) { detalhes++; d = await detalheTolerante(p.id, avisos) }
        else { pendente = true; pendentes_detalhe.push(String(p.id)) }
      }
      if (p.formato === 'E') {                                                        // sem estrutura → componentes null (pendente no M7)
        kits.push(pendente ? { ...kit(p, null), dica: 'estrutura não lida nesta varredura (teto de detalhes por varredura): segue na fila' } : kit(p, d)); continue
      }
      const custo = primeiroCusto(p.precoCusto, d?.precoCusto, d?.fornecedor?.precoCusto)
      const dica = custo != null ? '' : pendente ? 'detalhe pendente (teto por varredura): segue na fila' : dicaSemCusto(p, d)
      linhas.push(linha(p, custo, p.idProdutoPai ? skuDoId.get(String(p.idProdutoPai)) || null : null, dica))
    }
    if (pendentes_detalhe.length) avisos.push(`${pendentes_detalhe.length} produto(s) passaram do teto de ${tetoDetalhes} detalhes por varredura: vão para a fila (custo vigente mantido até lá)`)
    log('info', `bling: varredura com ${ultima} página(s), ${detalhes} detalhe(s), ${pendentes_detalhe.length} pendente(s)`)
    yield { pagina: ultima + 1, linhas, kits, avisos, pendentes_detalhe }
  }

  // Releitura de UM produto (gatilho do webhook / fila). `skuConhecido` só vale se o detalhe nem trouxer o campo `codigo`.
  async function custoDoProduto(idExterno, { skuConhecido } = {}) {
    const d = (await chamar(`/produtos/${encodeURIComponent(idExterno)}`)).data
    if (!d || d.formato === 'V' || d.situacao === 'E') return { linhas: [], kits: [] }
    const p = { ...d, id: d.id ?? idExterno, codigo: d.codigo === undefined ? skuConhecido ?? '' : d.codigo }
    if (d.formato === 'E') return { linhas: [], kits: [kit(p, d)] }                    // kit: a soma é do M7, nunca o custo próprio direto
    const custo = primeiroCusto(d.precoCusto, d.fornecedor?.precoCusto)
    return { linhas: [linha(p, custo, null, custo == null ? dicaSemCusto(p, d) : '')], kits: [] }
  }

  return { testar, varrer, custoDoProduto }
}

// Payload do webhook do Bling (já com HMAC validado pelo M2) → gatilho de releitura, ou null se não interessa.
// Só product_supplier.created|updated do fornecedor PADRÃO; o `codigo` do payload é o código no fornecedor, NÃO o SKU (não sai daqui),
// e o precoCusto do payload não é usado (releitura autenticada via custoDoProduto). `padrao === true` estrito: NÃO CONFIRMADO se vem booleano.
export function lerEventoBling(ev) {
  if (!ev || !/^product_supplier\.(created|updated)$/.test(ev.event) || ev.data?.padrao !== true) return null
  const id = ev.data?.produto?.id
  if (id == null || id === '' || !ev.eventId) return null
  return { evento_id: String(ev.eventId), company_id: String(ev.companyId ?? ''), data: String(ev.date ?? ''), id_externo: String(id) }
}
