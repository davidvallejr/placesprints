// Histórico do anúncio (change-log no padrão de erp_custos_hist): preço, preço "de" riscado, título, fotos, estoque (só ao cruzar o zero), status,
// frete grátis, logística e foto de capa. Uma leitura por dia (coleta das 4–6h): mudança intra-dia não é vista; webhook de itens é gatilho futuro.
// Fábrica testável (criarHistorico(handle), como vinculos.js) + instância com o banco real (historico).
import { db, hojeLocal } from './db.js'
import { estadoPromocao, SEM_PROMOCAO } from './estado-anuncio.js'

// campos que "O que mudou no anúncio" compara (fotografia do antes × hoje)
export const CAMPOS_ANUNCIO = [['titulo', 'Título'], ['preco', 'Preço'], ['fotos', 'Quantidade de fotos'], ['estoque', 'Estoque'], ['status', 'Status'], ['frete_gratis', 'Frete grátis'], ['tipo_anuncio', 'Tipo de anúncio'], ['logistica', 'Logística'], ['thumb', 'Foto de capa']]
// igualdade por campo: preço em centavos (1 centavo conta, ruído de ponto flutuante não); capa sem o sufixo de tamanho (-O.jpg × -I.jpg é a mesma foto)
const semSufixo = v => String(v || '').replace(/-[A-Z]\.(jpg|webp)$/i, '')
const centavos = v => Math.round(Number(v) * 100)
export function igualCampo(campo, a, b) {
  if (campo === 'thumb') return semSufixo(a) === semSufixo(b)
  if ((campo === 'preco' || campo === 'preco_original') && a != null && b != null) return centavos(a) === centavos(b)
  return String(a ?? '') === String(b ?? '')
}

// campos do histórico (lista fechada = CHECK de meli_item_mudanca): CAMPOS_HIST = atributos que diffAnuncio compara em meli_item;
// CAMPOS_ESTADO = estado derivado por outros coletores (promoção em promocoes-db.js, Ads em meli-serie.js, via estado-anuncio.js)
export const CAMPOS_HIST = ['preco', 'preco_original', 'titulo', 'fotos', 'estoque_zero', 'status', 'frete_gratis', 'logistica', 'thumb']
export const CAMPOS_ESTADO = ['promocao', 'ads']
export const CAMPOS_SNAPSHOT = ['descricao', 'atributos', 'categoria', 'tipo_anuncio']   // gravados pelo snapshot (anuncio-historico.js), não por diffAnuncio
export const CAMPOS_TODOS = [...CAMPOS_HIST, ...CAMPOS_ESTADO, ...CAMPOS_SNAPSHOT]
const PRECOS = new Set(['preco', 'preco_original'])
const NUMERICOS = new Set(['preco', 'preco_original', 'fotos', 'estoque_zero', 'frete_gratis'])
const valorDe = (linha, campo) => campo === 'estoque_zero' ? linha?.estoque : linha?.[campo]
const mesmoValor = (campo, a, b) => campo === 'estoque_zero' ? (Number(a) > 0) === (Number(b) > 0) : igualCampo(campo, a, b)
const r2 = x => Math.round(x * 100) / 100
const varPct = (campo, de, para) => PRECOS.has(campo) && para != null && Number(de) > 0 ? r2((Number(para) - Number(de)) / Number(de) * 100) : null
const json = s => { try { return JSON.parse(s) } catch { return null } }
const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }   // local: meli-serie importa este módulo
const dm = d => `${d.slice(8, 10)}/${d.slice(5, 7)}`
// dia no fuso do Brasil: timestamp com fuso (Z / -03:00) é convertido; data sem fuso (2026-09-10T00:00:00) já é local
export const diaLocal = s => {
  s = String(s || '')
  if (!/(Z|[+-]\d\d:?\d\d)$/i.test(s)) return s.slice(0, 10)
  const d = new Date(s)
  return isNaN(d) ? '' : d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

// diff de duas leituras do MESMO anúncio. Sem valor anterior (null OU '' — fotografia antiga sem logística/status/título) não há "de": a 1ª coleta
// não vira centenas de mudanças falsas e "não coletado → fulfillment" não vira "foi para o Full". Valor novo ausente só conta no preco_original
// (o preço riscado sumiu = o desconto acabou); nos outros campos é leitura incompleta, não mudança.
export function diffAnuncio(ant, nova) {
  const out = []
  for (const campo of CAMPOS_HIST) {
    const a = valorDe(ant, campo), b = valorDe(nova, campo)
    if (a == null || a === '' || (b == null && campo !== 'preco_original') || mesmoValor(campo, a, b)) continue
    out.push({ campo, de: String(a), para: b == null ? null : String(b), pct: varPct(campo, a, b) })
  }
  return out
}

// preço efetivamente pago = receita ÷ unidades, só nos dias com venda (dia sem venda não tem preço). serie: { unidades: {dia: n}, receita: {dia: R$} } (carregarSeries)
export function precoRealizado(serie, de, ate) {
  let r = 0, u = 0
  for (const [dia, n] of Object.entries(serie?.unidades || {})) if (dia >= de && dia <= ate && n > 0) { u += n; r += serie.receita?.[dia] || 0 }
  return u > 0 ? r2(r / u) : null
}

export function criarHistorico(handle) {
  const ins = handle.prepare('INSERT OR IGNORE INTO meli_item_mudanca (cliente, item_id, dia, campo, de, para, variacao_pct, fonte, em) VALUES (?,?,?,?,?,?,?,?,?)')
  const gravar = (cliente, item_id, dia, m, fonte, em) => ins.run(cliente, item_id, dia, m.campo, m.de, m.para, m.pct, fonte, em).changes
  const doDia = handle.prepare('SELECT id, de FROM meli_item_mudanca WHERE cliente = ? AND item_id = ? AND dia = ? AND campo = ? AND fonte = ?')
  const juntar = handle.prepare('UPDATE meli_item_mudanca SET para = ?, variacao_pct = ?, em = ? WHERE id = ?')
  const apagar = handle.prepare('DELETE FROM meli_item_mudanca WHERE id = ?')

  // 2ª leitura no MESMO dia (cron + botão + conexão): a linha do dia guarda o "de" da 1ª e passa a ter o "para" desta — 50→55→60 vira 50→60 (+20%) e
  // 50→55→50 (foi e voltou) apaga a linha. Sem isso a 2ª mudança se perdia e uma ida e volta virava alta fantasma.
  function gravarDoDia(cliente, item_id, dia, m, fonte, em) {
    const ja = doDia.get(cliente, item_id, dia, m.campo, fonte)
    if (!ja) return gravar(cliente, item_id, dia, m, fonte, em)
    if (mesmoValor(m.campo, ja.de, m.para)) { apagar.run(ja.id); return 0 }
    return juntar.run(m.para, varPct(m.campo, ja.de, m.para), em, ja.id).changes
  }
  // anteriores: Map item_id → linha de meli_item ANTES do upsert; novas: linhas no formato de meli_item. Roda dentro da transação de quem grava.
  function registrarMudancas(cliente, anteriores, novas, { dia = hojeLocal(), fonte = 'coleta', em = new Date().toISOString() } = {}) {
    let n = 0
    for (const l of novas) {
      const ant = anteriores.get(l.item_id)
      if (ant) for (const m of diffAnuncio(ant, l)) n += gravarDoDia(cliente, l.item_id, dia, m, fonte, em)
    }
    return n
  }
  // eventos de ESTADO já diferenciados (diffPromocao/diffAds de estado-anuncio.js): [{ item_id, campo, de, para, pct }]. Campo fora de CAMPOS_ESTADO = erro
  // (o CHECK barraria igual; aqui a mensagem é legível). Mesma regra do dia repetido de registrarMudancas. Devolve inserções.
  function registrarEstados(cliente, muds, { dia = hojeLocal(), fonte, em = new Date().toISOString() } = {}) {
    if (!fonte) throw new Error('registrarEstados: informe a fonte')
    let n = 0
    for (const m of muds || []) {
      if (!CAMPOS_ESTADO.includes(m.campo)) throw new Error('registrarEstados: campo fora da lista de estado')
      n += gravarDoDia(cliente, m.item_id, dia, { campo: m.campo, de: m.de == null ? null : String(m.de), para: m.para == null ? null : String(m.para), pct: m.pct ?? null }, fonte, em)
    }
    return n
  }

  // Map item_id → [{ dia, campo, de, para, pct, fonte, incerteza? }] em ordem de dia. Filtros opcionais; campos fora da lista fechada são ignorados.
  // Linha com "de" vazio (gravada antes da guarda de diffAnuncio: fotografia antiga sem o campo) não é evento para NENHUM leitor — sem leitura
  // anterior não há mudança; é o ponto único por onde Folha, leitura, cartão, cronologia e Merovíngio leem o change-log.
  function eventosAnuncio(cliente, { itens = null, de = '', ate = '', campos = null } = {}) {
    const w = ['cliente = ?', "de IS NOT NULL AND de <> ''"], p = [cliente]
    if (itens) { w.push('item_id IN (SELECT value FROM json_each(?))'); p.push(JSON.stringify([].concat(itens).map(String))) }
    if (de) { w.push('dia >= ?'); p.push(String(de)) }
    if (ate) { w.push('dia <= ?'); p.push(String(ate)) }
    if (campos) { w.push('campo IN (SELECT value FROM json_each(?))'); p.push(JSON.stringify([].concat(campos).filter(c => CAMPOS_TODOS.includes(c)))) }
    const rows = handle.prepare(`SELECT item_id, dia, campo, de, para, variacao_pct, fonte FROM meli_item_mudanca WHERE ${w.join(' AND ')} ORDER BY item_id, dia, id`).all(...p)
    // fonte 'acomp': as fotografias não são diárias — a mudança aconteceu depois da última fotografia que ainda mostrava o valor antigo
    const comAcomp = [...new Set(rows.filter(r => r.fonte === 'acomp').map(r => r.item_id))]
    const fotos = new Map()
    if (comAcomp.length) for (const c of handle.prepare('SELECT item_id, capturado_em, estado_json FROM tarefa_acomp WHERE cliente = ? AND item_id IN (SELECT value FROM json_each(?))').all(cliente, JSON.stringify(comAcomp))) {
      const attrs = json(c.estado_json)?.attrs
      if (attrs) (fotos.get(c.item_id) || fotos.set(c.item_id, []).get(c.item_id)).push({ dia: diaLocal(c.capturado_em), attrs })
    }
    const num = (campo, v) => NUMERICOS.has(campo) && v != null ? Number(v) : v
    const out = new Map()
    for (const r of rows) {
      const ev = { dia: r.dia, campo: r.campo, de: num(r.campo, r.de), para: num(r.campo, r.para), pct: r.variacao_pct, fonte: r.fonte }
      if (r.fonte === 'acomp') {
        const desde = (fotos.get(r.item_id) || []).filter(f => f.dia && f.dia < r.dia && mesmoValor(r.campo, valorDe(f.attrs, r.campo), r.de)).reduce((m, f) => f.dia > m ? f.dia : m, '')
        if (desde) ev.incerteza = `mudou entre ${dm(desde)} e ${dm(r.dia)}`
      }
      (out.get(r.item_id) || out.set(r.item_id, []).get(r.item_id)).push(ev)
    }
    return out
  }

  // 1º dia em que a coleta registrou mudança (o change-log diário começa aí); null = ainda sem histórico da coleta
  // ponytail: dia de coleta sem nenhuma mudança não deixa marca — o início real pode ser anterior; marcar em sync_estado se a tela precisar
  const inicioHistorico = cliente => handle.prepare("SELECT MIN(dia) d FROM meli_item_mudanca WHERE cliente = ? AND fonte = 'coleta'").get(cliente).d ?? null

  // Semeadura do passado (idempotente pelo UNIQUE): promoções ativas (preço E estado de promoção), fotografias do acompanhamento e publicações
  // verificadas de Ofertas. Só cobre o período ANTES do histórico da coleta (dali em diante a coleta já vê a mudança: rodar de novo não duplica
  // evento). Ads e Full não têm semeadura: não existe de onde tirar o passado — o histórico deles começa na 1ª coleta depois da implantação.
  // Devolve inserções por fonte (promocao = eventos de estado 'promocao', fonte 'promo').
  function semearHistoricoAnuncio(cliente, { hoje = hojeLocal(), em = new Date().toISOString() } = {}) {
    const n = { promo: 0, acomp: 0, ofertas: 0, promocao: 0 }
    if (/^\[Comercial\] /.test(cliente)) return n                     // prospect nunca é cliente
    const corte = inicioHistorico(cliente)
    const poe = (fonte, item_id, dia, m, contador = fonte) => { if (dia && dia <= hoje && (!corte || dia < corte)) n[contador] += gravar(cliente, item_id, dia, m, fonte, em) }
    const evPreco = (de, para) => ({ campo: 'preco', de: String(de), para: String(para), pct: Number(de) > 0 ? r2((Number(para) - Number(de)) / Number(de) * 100) : null })
    handle.transaction(() => {
      // 1) oferta ativa: o preço pago foi de preco_original para preco no início; se já acabou, volta no fim (2 ofertas no mesmo dia: vale a de menor preço)
      const ofertas = handle.prepare("SELECT item_id, preco, preco_original, inicio, fim FROM promo_oferta WHERE cliente = ? AND status = 'started' AND inicio <> '' AND preco IS NOT NULL AND preco_original IS NOT NULL").all(cliente)
        .map(o => ({ ...o, dia: diaLocal(o.inicio) })).sort((a, b) => a.item_id.localeCompare(b.item_id) || a.dia.localeCompare(b.dia) || a.preco - b.preco)
      for (const o of ofertas) {
        if (igualCampo('preco', o.preco, o.preco_original)) continue
        poe('promo', o.item_id, o.dia, evPreco(o.preco_original, o.preco))
        const fim = diaLocal(o.fim)
        if (fim && fim < hoje) poe('promo', o.item_id, fim, evPreco(o.preco, o.preco_original))
      }
      // 1b) ESTADO de promoção: 'nenhuma' → '<TIPO> −X%' no dia de início da oferta started mais antiga do anúncio (de='nenhuma' é premissa declarada,
      //     a mesma do preço); se ela já acabou, volta a 'nenhuma' no fim. Anúncio que já tem evento promocao com dia ≥ início (a coleta de promoções
      //     já registrou, ou semeadura anterior) é pulado inteiro — nunca dois eventos contando a mesma entrada.
      const jaTem = new Map(handle.prepare("SELECT item_id, MAX(dia) d FROM meli_item_mudanca WHERE cliente = ? AND campo = 'promocao' GROUP BY item_id").all(cliente).map(r => [r.item_id, r.d]))
      const porItem = new Map()
      for (const o of handle.prepare("SELECT item_id, tipo, status, preco, preco_original, inicio, fim FROM promo_oferta WHERE cliente = ? AND status = 'started' AND inicio <> ''").all(cliente)) {
        const dia = diaLocal(o.inicio); if (!dia) continue
        const g = porItem.get(o.item_id) || porItem.set(o.item_id, { dia, ofertas: [] }).get(o.item_id)
        if (dia < g.dia) { g.dia = dia; g.ofertas = [] }
        if (dia === g.dia) g.ofertas.push(o)
      }
      for (const [item_id, g] of porItem) {
        if ((jaTem.get(item_id) || '') >= g.dia) continue
        const estado = estadoPromocao(g.ofertas)
        poe('promo', item_id, g.dia, { campo: 'promocao', de: SEM_PROMOCAO, para: estado, pct: null }, 'promocao')
        const fim = diaLocal([...g.ofertas].sort((a, b) => (a.preco ?? Infinity) - (b.preco ?? Infinity))[0].fim)
        if (fim && fim < hoje) poe('promo', item_id, fim, { campo: 'promocao', de: estado, para: SEM_PROMOCAO, pct: null }, 'promocao')
      }
      // 2) fotografias do acompanhamento (antes → 24h → 48h → 72h → 1 semana), na linha do tempo do ANÚNCIO: fotos de tarefas diferentes do mesmo
      //    anúncio entram juntas, então a mesma mudança vista por duas tarefas vira um evento só. Dia = fotografia em que o valor novo apareceu.
      let ant = null
      for (const c of handle.prepare('SELECT item_id, capturado_em, estado_json FROM tarefa_acomp WHERE cliente = ? ORDER BY item_id, capturado_em').all(cliente)) {
        const attrs = json(c.estado_json)?.attrs
        if (!attrs) continue
        if (ant?.item_id === c.item_id) for (const m of diffAnuncio(ant.attrs, attrs)) poe('acomp', c.item_id, diaLocal(c.capturado_em), m)
        ant = { item_id: c.item_id, attrs }
      }
      // 3) publicações de Ofertas Estratégicas conferidas no ML (estado 'verificada'): só o campo preço; dia da verificação
      for (const pub of handle.prepare("SELECT anuncio_id, diff_json, verificado_em FROM of_publicacao WHERE cliente = ? AND canal = 'ML' AND estado = 'verificada' AND verificado_em <> '' AND anuncio_id <> ''").all(cliente)) {
        const ds = json(pub.diff_json)
        for (const d of Array.isArray(ds) ? ds : []) if (d?.campo === 'preco' && d.de != null && d.para != null && !igualCampo('preco', d.de, d.para)) poe('ofertas', pub.anuncio_id, diaLocal(pub.verificado_em), evPreco(d.de, d.para))
      }
    })()
    return n
  }

  // Preço na causalidade de vendas da conta (motor-ppc.causalidadeVendas): 28 dias até `ate` × os 28 anteriores. Anúncio que SUBIU (variação líquida do
  // 1º "de" ao último "para" ≥ limiar), quanto da receita anterior esses anúncios somam e como a receita dos anúncios SEM nenhuma mudança de preço andou
  // (o falsificador: se eles caíram na mesma proporção, a causa não é o preço). null = sem dado (a coleta não cobre a janela e nada foi registrado nela).
  function resumoPrecos28d(cliente, { ate = addDias(hojeLocal(), -1), limiar = 3 } = {}) {
    const de = addDias(ate, -27), aAte = addDias(de, -1), aDe = addDias(aAte, -27)
    const desde = inicioHistorico(cliente), evs = eventosAnuncio(cliente, { de, ate, campos: ['preco'] })
    if (!evs.size && !(desde && desde <= de)) return null
    const rec = new Map(handle.prepare(`SELECT item_id, SUM(CASE WHEN dia BETWEEN ? AND ? THEN receita ELSE 0 END) r, SUM(CASE WHEN dia BETWEEN ? AND ? THEN receita ELSE 0 END) r0
      FROM meli_serie_item WHERE cliente = ? GROUP BY item_id`).all(de, ate, aDe, aAte, cliente).map(x => [x.item_id, x]))
    const base = [...rec.values()].reduce((t, x) => t + (x.r0 || 0), 0)
    const aumentos = [...evs].map(([item_id, l]) => {
      const de0 = Number(l[0].de), para = l.at(-1).para, pico = [...l].sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0))[0]
      return { item_id, dia: pico.dia, incerteza: pico.incerteza || null, de: de0, para, pct: de0 > 0 && para != null ? r2((para / de0 - 1) * 100) : null, receita_ant: r2(rec.get(item_id)?.r0 || 0) }
    }).filter(a => a.pct != null && a.pct >= limiar).map(a => ({ ...a, share_pct: base > 0 ? r2(100 * a.receita_ant / base) : null })).sort((a, b) => b.receita_ant - a.receita_ant)
    const sem = [...rec.entries()].filter(([i]) => !evs.has(i)).map(([, x]) => x), sR = sem.reduce((t, x) => t + (x.r || 0), 0), sR0 = sem.reduce((t, x) => t + (x.r0 || 0), 0)
    // os que SUBIRAM caíram? (Σ receita ÷ Σ receita anterior − 1): sem queda neles, o aumento não explica a queda da conta
    const aR = aumentos.reduce((t, a) => t + (rec.get(a.item_id)?.r || 0), 0), aR0 = aumentos.reduce((t, a) => t + a.receita_ant, 0)
    return { de, ate, desde, completo: !!desde && desde <= de, limiar, receita_base: r2(base), n_mudaram: evs.size, aumentos,
      share_aumentos_pct: base > 0 ? r2(100 * aR0 / base) : null, var_aumentos_pct: aR0 > 0 ? r2((aR / aR0 - 1) * 100) : null,
      var_sem_mudanca_pct: sR0 > 0 ? r2((sR / sR0 - 1) * 100) : null, n_sem_mudanca: sem.length }
  }

  return { registrarMudancas, registrarEstados, eventosAnuncio, inicioHistorico, semearHistoricoAnuncio, resumoPrecos28d }
}

export const historico = criarHistorico(db)
