// Conector Tiny / Olist ERP (API v3) — SOMENTE LEITURA. Spec: docs/integracao-custos-erp-SPEC.md, 7.1 e 7.3.
// Só faz GET em /produtos (permissão "Leitura" no módulo Produtos); nada aqui escreve no Tiny, no ML ou no banco.
// O conector NUNCA decide se um custo vale: entrega o bruto (ou null) e o aplicarLote (custos-db.js) aceita/rejeita.
// Deps (7.1): http({ metodo, url, headers, timeoutMs }) → { status, headers (minúsculos), texto }; limitador { aguardar(), registrar429(ms) }
// criado por quem chama com 25 req/min por conta (o menor plano do Tiny é 30); obterToken() → string | null (M6, renova por validade).
// Tudo o que só a documentação diz (nada foi testado contra a API real) está marcado NÃO CONFIRMADO.
const BASE = 'https://api.tiny.com.br/public-api/v3'
const CAMPOS = { preco_custo: ['precoCusto', 'precoCustoMedio'], custo_medio: ['precoCustoMedio', 'precoCusto'] }   // [escolhido, o outro (só para a dica)]
const TETO_PAGINAS = 500, TETO_DETALHES = 200, TETO_KITS = 200, RETENTATIVAS = 4
const MSG_401 = 'O Tiny recusou o acesso (401). Em geral é falta de permissão de Leitura no módulo Produtos para o aplicativo/usuário que autorizou, não token vencido: confira as permissões do aplicativo no Tiny e, se preciso, reautorize.'

const erro = (codigo, msg, status) => Object.assign(new Error(msg), { codigo, ...(status ? { status } : {}) })
const vazio = v => v == null || Number(v) === 0                       // "nulo ou 0 do campo escolhido" → custo null (7.3, item 2)
const positivo = v => (typeof v === 'number' || typeof v === 'string') && Number.isFinite(+v) && +v > 0
const brl = v => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
const skuDe = p => (p?.sku == null ? '' : String(p.sku))
const idDe = p => (p?.id == null ? '' : String(p.id))
const idOk = id => /^\d{1,20}$/.test(String(id))                       // ids do Tiny são inteiros; nada de caminho montado com lixo
const chave = s => String(s ?? '').trim().toLowerCase()
const amostra = l => l.slice(0, 10).join(', ') + (l.length > 10 ? ` e mais ${l.length - 10}` : '')

// dataAlteracao → ISO. Formato e fuso NÃO CONFIRMADOS: sem fuso explícito, assume Brasília (-03:00, sem horário de verão desde 2019).
// Também NÃO CONFIRMADO se mudança só de custo atualiza dataAlteracao: o valor é informativo (não entra no hash do custo).
function iso(s) {
  const m = typeof s === 'string' && s.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:\d{2})?$/)
  if (!m) return null
  const d = new Date(`${m[1]}T${m[2]}${m[3] || '-03:00'}`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

// /produtos/{id}/kit devolve [{ produto: { id, sku }, quantidade }]; qualquer coisa fora disso = sem estrutura (o kit fica pendente, 5.9)
function estrutura(lista) {
  if (!Array.isArray(lista) || !lista.length) return null
  const comps = lista.map(c => ({ id_externo: idDe(c?.produto), quantidade: Number(c?.quantidade) }))
  return comps.every(c => c.id_externo && Number.isFinite(c.quantidade) && c.quantidade > 0) ? comps : null
}

export function criarConectorTiny({ http, limitador, obterToken, log = () => {}, agora = Date.now, campoCusto = 'preco_custo', situacoes = ['A', 'I'] } = {}) {
  if (!CAMPOS[campoCusto]) throw erro('config', 'campo de custo do Tiny inválido: use preco_custo ou custo_medio')
  const [campo, outro] = CAMPOS[campoCusto]
  const nomeCampo = `tiny.precos.${campo}`
  const agoraMs = () => { const v = agora(); return typeof v === 'number' ? v : new Date(v).getTime() }

  // X-RateLimit-Reset: NÃO CONFIRMADO se é "segundos até zerar" ou epoch; > 1e9 trata como epoch. Sem cabeçalho: 60 s (janela por minuto).
  const esperaReset = v => {
    const n = Number(v)
    if (v == null || v === '' || !Number.isFinite(n) || n <= 0) return 60000
    return Math.min(Math.max(n > 1e9 ? n * 1000 - agoraMs() : n * 1000, 1000), 120000)
  }

  async function get(caminho, { aceita404 = false } = {}) {
    let token
    try { token = await obterToken() } catch (e) {
      const msg = String(e?.message || e).replace(/Bearer\s+\S+/gi, 'Bearer ***').slice(0, 200)
      if (/invalid_grant/i.test(msg) || e?.codigo === 'reautorizar') throw erro('reautorizar', 'Autorização do Tiny expirada ou revogada (invalid_grant): o cliente precisa reautorizar. O refresh token do Tiny dura 1 dia.')
      throw erro('token', `não foi possível obter o token do Tiny: ${msg}`)
    }
    if (!token) throw erro('reautorizar', 'Tiny sem autorização válida: o cliente precisa reautorizar (o refresh token do Tiny dura 1 dia).')
    const limpo = t => String(t ?? '').split(token).join('***').replace(/Bearer\s+\S+/gi, 'Bearer ***').slice(0, 300)
    const rota = caminho.split('?')[0]
    for (let tentativa = 0; ; tentativa++) {
      await limitador.aguardar()
      const r = await http({ metodo: 'GET', url: BASE + caminho, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, timeoutMs: 20000 })
      const h = r.headers || {}
      const zerou = /^\s*0\s*$/.test(h['x-ratelimit-remaining'] ?? '')
      // código HTTP do estouro na v3 NÃO CONFIRMADO: vale 429 e qualquer erro com X-RateLimit-Remaining: 0
      const limite = r.status === 429 || (r.status >= 400 && zerou)
      if (limite || r.status >= 500) {
        if (tentativa >= RETENTATIVAS) throw erro(limite ? 'limite' : 'http', `Tiny ${r.status} em ${rota} (${tentativa + 1} tentativas)${limite ? ': limite de consulta da conta' : ''}`, r.status)
        const ms = limite ? esperaReset(h['x-ratelimit-reset']) : 2000 * 2 ** tentativa
        log('aviso', `tiny: ${limite ? 'limite de consulta' : `erro ${r.status}`} em ${rota}, pausa de ${Math.round(ms / 1000)} s`)
        limitador.registrar429(ms)                                     // o próximo aguardar() respeita a pausa (vale também para o 5xx)
        continue
      }
      if (r.status === 401) throw erro('sem_permissao', MSG_401, 401)  // 401 pode ser permissão do módulo: não é repetido
      if (r.status === 404 && aceita404) return null
      if (r.status < 200 || r.status >= 300) throw erro('http', `Tiny ${r.status} em ${rota}: ${limpo(r.texto)}`, r.status)
      if (zerou) limitador.registrar429(esperaReset(h['x-ratelimit-reset']))   // a próxima chamada estouraria: espera o reset
      try { return JSON.parse(r.texto) } catch { throw erro('http', `resposta inválida do Tiny em ${rota}`) }
    }
  }

  // Campo escolhido por cliente, SEM fallback: vazio vira null e a dica só informa o outro campo (vai para a lista de rejeitadas)
  function linha(p, precos, variacao_de = null) {
    const bruto = precos?.[campo], alt = precos?.[outro]
    const l = { sku: skuDe(p), mlb: null, custo: vazio(bruto) ? null : bruto, campo: nomeCampo, id_externo: idDe(p), atualizado_na_fonte: iso(p?.dataAlteracao), variacao_de }
    if (l.custo === null && positivo(alt)) l.dica = `${campo} vazio no Tiny; o outro campo (${outro}) tem ${brl(alt)}, mas não é usado (sem fallback entre campos)`
    return l
  }
  const variacoesDe = d => (Array.isArray(d?.variacoes) ? d.variacoes : []).map(v => linha(v, v?.precos, skuDe(d)))
  const kitDe = (k, componentes, dica = '') => ({ id_externo: idDe(k), sku: skuDe(k), custo_proprio: vazio(k?.precos?.[campo]) ? null : k.precos[campo], componentes, ...(dica && { dica }) })
  const DICA_FILA = 'estrutura não lida nesta varredura (teto de detalhes por varredura): segue na fila'

  return {
    async testar() {
      try { await get('/produtos?limit=1'); return { ok: true, empresa: null } }   // só o módulo Produtos: o Tiny não dá a empresa por ele
      catch (e) { return { ok: false, empresa: null, erro: e.message } }
    },

    async *varrer({ prioridadeSkus = [] } = {}) {
      const prioridade = new Set([...prioridadeSkus].map(chave))
      const priorizar = l => l.sort((a, b) => prioridade.has(chave(b.sku)) - prioridade.has(chave(a.sku)))   // sort estável: SKU de anúncio primeiro
      const pais = [], kits = []
      let pagina = 0, viuVariacao = false
      // situacao sempre explícita (nunca o padrão da API, NÃO CONFIRMADO); 'E' (excluído) fica fora
      for (const situacao of situacoes) {
        for (let offset = 0, n = 0; ; n++) {
          if (n >= TETO_PAGINAS) throw erro('teto', `Tiny: teto de ${TETO_PAGINAS} páginas na situação ${situacao}; varredura incompleta (não fecha como completa)`)
          const corpo = await get(`/produtos?${new URLSearchParams({ limit: '100', offset: String(offset), situacao })}`)
          if (!Array.isArray(corpo?.itens)) throw erro('http', 'resposta inesperada do Tiny em /produtos (sem a lista "itens")')
          if (!corpo.itens.length) break
          const linhas = [], paisPag = []
          for (const p of corpo.itens) {
            if (p?.tipoVariacao === 'P') { pais.push(p); paisPag.push(skuDe(p)); continue }   // pai: sem custo próprio
            if (p?.tipo === 'K') { kits.push(p); continue }                                    // kit: estrutura no fim (com teto e prioridade)
            if (p?.tipoVariacao === 'V') viuVariacao = true   // a listagem não diz o pai: variacao_de fica null (NÃO CONFIRMADO)
            linhas.push(linha(p, p?.precos))
          }
          const avisos = paisPag.length ? [`${paisPag.length} produto(s) pai de variação ignorado(s) (sem custo próprio): ${amostra(paisPag)}`] : []
          yield { pagina: ++pagina, linhas, kits: [], avisos }
          offset += corpo.itens.length                       // anda pelo que veio: limit máximo NÃO CONFIRMADO
          const total = Number(corpo.paginacao?.total)
          if (corpo.paginacao?.total != null && Number.isFinite(total) && offset >= total) break
        }
      }

      const linhas = [], lidos = [], avisos = [], pendentes_detalhe = []
      let nao_fechar = false
      // Variações: NÃO CONFIRMADO se vêm como linhas da listagem. Se nenhuma veio, lê o detalhe dos pais (variacoes[].precos), teto 200;
      // o excedente vai para a fila (7.3) e a varredura NÃO fecha o completo: as variações dele nem são conhecidas (não viram "não visto").
      if (!viuVariacao && pais.length) {
        priorizar(pais)
        const semVar = []
        for (const pai of pais.slice(0, TETO_DETALHES)) {
          const d = idOk(pai.id) ? await get(`/produtos/${pai.id}`, { aceita404: true }) : null
          const vs = variacoesDe(d)
          if (vs.length) linhas.push(...vs); else semVar.push(skuDe(pai))
        }
        if (semVar.length) avisos.push(`${semVar.length} pai(s) sem variações legíveis no detalhe: ${amostra(semVar)}`)
        const sobra = pais.slice(TETO_DETALHES)
        if (sobra.length) {
          avisos.push(`${sobra.length} pai(s) além do teto de ${TETO_DETALHES} detalhes por varredura: variações vão para a fila (custo vigente mantido até lá): ${amostra(sobra.map(skuDe))}`)
          pendentes_detalhe.push(...sobra.map(idDe).filter(idOk)); nao_fechar = true
        }
      }
      // Kits: estrutura por /produtos/{id}/kit (teto próprio de 200; excedente vai para a fila). Sem estrutura lida = componentes null (kit pendente).
      if (kits.length) {
        priorizar(kits)
        const semEst = [], alem = []
        for (const [i, k] of kits.entries()) {
          if (i >= TETO_KITS) { alem.push(skuDe(k)); if (idOk(k.id)) pendentes_detalhe.push(idDe(k)); lidos.push(kitDe(k, null, DICA_FILA)); continue }
          const componentes = idOk(k.id) ? estrutura(await get(`/produtos/${k.id}/kit`, { aceita404: true })) : null
          if (!componentes) semEst.push(skuDe(k))
          lidos.push(kitDe(k, componentes))
        }
        if (semEst.length) avisos.push(`${semEst.length} kit(s) sem estrutura legível no Tiny: ${amostra(semEst)}`)
        if (alem.length) avisos.push(`${alem.length} kit(s) além do teto de ${TETO_KITS} estruturas por varredura (vão para a fila): ${amostra(alem)}`)
      }
      if (linhas.length || lidos.length || avisos.length) yield { pagina: ++pagina, linhas, kits: lidos, avisos, pendentes_detalhe, nao_fechar }
    },

    // Para a fila (detalhe pendente). O 2º argumento ({ skuConhecido }, 7.1) não preenche nada: o detalhe do Tiny traz o próprio sku (nunca inventar vínculo).
    async custoDoProduto(idExterno, _opcoes = {}) {
      if (!idOk(idExterno)) throw erro('id', 'id de produto do Tiny inválido')
      const d = await get(`/produtos/${idExterno}`, { aceita404: true })
      if (!d) return { linhas: [] }                          // sumiu no Tiny
      if (d.tipo === 'K') return { linhas: [], kits: [kitDe({ ...d, id: d.id ?? idExterno }, estrutura(await get(`/produtos/${idExterno}/kit`, { aceita404: true })))] }   // a soma é do M7 (5.9)
      if (d.tipoVariacao === 'P') return { linhas: variacoesDe(d) }
      return { linhas: [linha(d, d.precos)] }
    },
  }
}
