// "Como era" do anúncio (Parte B, fase 1): fotografia completa por estado distinto (meli_item_snapshot), diff campo a campo e "piorou depois de"
// cruzado com o Merovíngio (impacto-tarefas.medirMarco: o MESMO antes × depois com controle e placebo das tarefas, numa data-marco).
// Leitura do ML reaproveitada: impressaoItem (ofertas-ml.js) sobre GET /items/{id}?include_attributes=all + GET /items/{id}/description (meli-api.chamar).
// Honestidade: "piorou" só com veredito `piorou` do controle; sem controle = "caiu depois da mudança (sem controle)"; descrição que não pôde ser lida é declarada.
// Sem Restaurar aqui (fase 3). Fábrica testável (criarHistoricoAnuncio(handle, deps)) + instância com o banco real (historicoAnuncio).
import { createHash } from 'node:crypto'
import { db, hojeLocal, agora } from './db.js'
import { impressaoItem } from './ofertas-ml.js'
import { SCHEMA_SNAPSHOT } from './snapshot-schema.js'
import { cfgAtrib, diasEntre } from './meli-serie.js'
import { diaLocal } from './preco-historico.js'
import { medirMarco } from './impacto-tarefas.js'

const ORIGENS = ['coleta', 'ofertas', 'chaveiro', 'restauracao']
const centavos = v => v == null ? null : Math.round(Number(v) * 100)
const json = (s, padrao) => { try { return JSON.parse(s) } catch { return padrao } }
const dm = d => d ? `${diaLocal(d).slice(8, 10)}/${diaLocal(d).slice(5, 7)}` : '—'
// JSON com chaves ordenadas em todos os níveis: a ordem em que a API devolve a ficha nunca muda o hash
const canonico = v => Array.isArray(v) ? `[${v.map(canonico).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonico(v[k])}`).join(',')}}` : JSON.stringify(v ?? null)
const sha16 = s => createHash('sha256').update(s).digest('hex').slice(0, 16)

// impressão do anúncio = impressaoItem (título, preço, status, categoria, ids das fotos, ficha por id, variações) + tipo e frete. Sem descrição (lida à parte).
// ponytail: estoque por variação fica FORA do hash (muda a cada venda e viraria uma fotografia por dia); vai no variacoes_json só para o diff mostrar
export function impressaoCompleta(item) {
  const imp = impressaoItem(item)
  return { ...imp, tipo_anuncio: item?.listing_type_id ?? null,
    frete: { free_shipping: item?.shipping?.free_shipping ? 1 : 0, logistic_type: item?.shipping?.logistic_type ?? null, mode: item?.shipping?.mode ?? null },
    variacoes: (item?.variations || []).map((v, i) => ({ ...imp.variacoes[i], estoque: v.available_quantity ?? null })) }
}
const semEstoque = imp => ({ ...imp, variacoes: (imp.variacoes || []).map(({ estoque, ...v }) => v) })
export const hashSnapshot = imp => sha16(canonico(semEstoque(imp)))          // estável (chaves ordenadas), sem descrição
export const hashDescricao = txt => txt == null ? null : sha16(String(txt))
const chaveLinha = (hashImp, descHash) => sha16(`${hashImp}|${descHash ?? ''}`)   // PK da linha: impressão ⊕ descrição

// linha do banco → snapshot em objeto (o formato que diffSnapshots compara)
export function snapshotDeLinha(l) {
  return { hash: l.hash, capturado_em: l.capturado_em, origem: l.origem, titulo: l.titulo, preco: l.preco, status: l.status, categoria: l.categoria, tipo_anuncio: l.tipo_anuncio,
    fotos: json(l.fotos_json, []), atributos: json(l.atributos_json, {}), variacoes: json(l.variacoes_json, []), frete: json(l.frete_json, {}), descricao: l.descricao ?? null, descricao_hash: l.descricao_hash ?? null }
}
const resumoDe = s => [s.titulo ? String(s.titulo).slice(0, 60) : '(sem título)', s.preco != null ? `R$ ${Number(s.preco).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : null, `${(s.fotos || []).length} foto(s)`, s.status || null, s.descricao == null ? 'descrição não lida' : null].filter(Boolean).join(' · ')

// ── diff PURO entre dois snapshots (a = antes, b = depois) → [{ campo, de, para, tipo }] ──────────────────────────────────────
// tipo ∈ alterado | adicionado | removido | reordenado. Descrição por trecho curto (primeiro ponto em que divergem); descrição não lida de um lado = não comparável (nada sai).
const TRECHO = 80
function trechoDiferente(a, b) {
  let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++
  let ja = a.length, jb = b.length; while (ja > i && jb > i && a[ja - 1] === b[jb - 1]) { ja--; jb-- }
  const corte = (s, de, ate) => (de > 0 ? '…' : '') + s.slice(de, Math.min(ate, de + TRECHO)) + (ate - de > TRECHO || ate < s.length ? '…' : '')
  return { de: corte(a, i, ja), para: corte(b, i, jb) }
}
export function diffSnapshots(a, b) {
  const out = [], add = (campo, de, para, tipo = 'alterado') => out.push({ campo, de, para, tipo })
  for (const c of ['titulo', 'status', 'categoria', 'tipo_anuncio']) if (String(a?.[c] ?? '') !== String(b?.[c] ?? '')) add(c, a?.[c] ?? null, b?.[c] ?? null)
  if (centavos(a?.preco) !== centavos(b?.preco)) add('preco', a?.preco ?? null, b?.preco ?? null)
  if (a?.descricao != null && b?.descricao != null && a.descricao !== b.descricao) {
    const t = trechoDiferente(a.descricao, b.descricao)
    add('descricao', t.de, t.para, !a.descricao ? 'adicionado' : !b.descricao ? 'removido' : 'alterado')
  }
  const fa = (a?.fotos || []).map(String), fb = (b?.fotos || []).map(String), sa = new Set(fa), sb = new Set(fb)
  for (const id of fa) if (!sb.has(id)) add('fotos', id, null, 'removido')
  for (const id of fb) if (!sa.has(id)) add('fotos', null, id, 'adicionado')
  const comuns = { a: fa.filter(id => sb.has(id)), b: fb.filter(id => sa.has(id)) }
  if (comuns.a.length > 1 && comuns.a.join(',') !== comuns.b.join(',')) add('fotos', fa.join(', '), fb.join(', '), 'reordenado')
  const aa = a?.atributos || {}, ab = b?.atributos || {}
  for (const id of [...new Set([...Object.keys(aa), ...Object.keys(ab)])].sort()) {
    if (!(id in aa)) add(`atributos.${id}`, null, ab[id], 'adicionado')
    else if (!(id in ab)) add(`atributos.${id}`, aa[id], null, 'removido')
    else if (String(aa[id] ?? '') !== String(ab[id] ?? '')) add(`atributos.${id}`, aa[id], ab[id])
  }
  const va = new Map((a?.variacoes || []).map(v => [String(v.id), v])), vb = new Map((b?.variacoes || []).map(v => [String(v.id), v]))
  for (const [id, v] of va) {
    const w = vb.get(id)
    if (!w) { add(`variacoes.${id}`, `preço ${v.preco ?? '—'}`, null, 'removido'); continue }
    if (centavos(v.preco) !== centavos(w.preco)) add(`variacoes.${id}.preco`, v.preco ?? null, w.preco ?? null)
    if (v.estoque != null && w.estoque != null && Number(v.estoque) !== Number(w.estoque)) add(`variacoes.${id}.estoque`, v.estoque, w.estoque)
    if ((v.picture_ids || []).join(',') !== (w.picture_ids || []).join(',')) add(`variacoes.${id}.fotos`, (v.picture_ids || []).join(', '), (w.picture_ids || []).join(', '))
  }
  for (const [id, w] of vb) if (!va.has(id)) add(`variacoes.${id}`, null, `preço ${w.preco ?? '—'}`, 'adicionado')
  const ra = a?.frete || {}, rb = b?.frete || {}
  for (const k of [...new Set([...Object.keys(ra), ...Object.keys(rb)])].sort()) if (String(ra[k] ?? '') !== String(rb[k] ?? '')) add(`frete.${k}`, ra[k] ?? null, rb[k] ?? null)
  return out
}

// o que vai para o change-log meli_item_mudanca (fonte 'coleta'): só os campos que a coleta diária NÃO registra (gravarItens já cobre título, preço, fotos, status, frete)
const CAMPOS_LOG = { descricao: 'descricao', atributos: 'atributos', categoria: 'categoria', tipo_anuncio: 'tipo_anuncio' }
export function mudancasParaLog(a, b) {
  const d = diffSnapshots(a, b), out = []
  const desc = d.find(x => x.campo === 'descricao'); if (desc) out.push({ campo: 'descricao', de: a.descricao_hash ?? hashDescricao(a.descricao), para: b.descricao_hash ?? hashDescricao(b.descricao) })
  const attrs = d.filter(x => x.campo.startsWith('atributos.'))
  if (attrs.length) out.push({ campo: 'atributos', de: JSON.stringify(Object.fromEntries(attrs.map(x => [x.campo.slice(10), x.de]))).slice(0, 300), para: JSON.stringify(Object.fromEntries(attrs.map(x => [x.campo.slice(10), x.para]))).slice(0, 300) })
  for (const c of ['categoria', 'tipo_anuncio']) { const x = d.find(y => y.campo === c); if (x) out.push({ campo: CAMPOS_LOG[c], de: x.de == null ? null : String(x.de), para: x.para == null ? null : String(x.para) }) }
  return out
}

// leitura padrão do ML: a mesma porta de leitura da coleta (meli-api.chamar), nenhuma função nova. permitirFalha: falha vira { _erro } e é declarada, nunca lança
async function apiPadrao() {
  const { chamar } = await import('./meli-api.js')
  return { lerItem: (c, id) => chamar(c, `/items/${encodeURIComponent(id)}?include_attributes=all`, { permitirFalha: true }), lerDescricao: (c, id) => chamar(c, `/items/${encodeURIComponent(id)}/description`, { permitirFalha: true }) }
}
// curva ABC do diagnóstico (diagnostico-conta.js); sem receita/diagnóstico = 'C'
async function curvaPadrao(cliente) {
  const { diagnosticarConta } = await import('./diagnostico-conta.js')
  let mapa = null
  return id => { if (!mapa) { try { mapa = new Map((diagnosticarConta(cliente).itens || []).map(i => [i.item_id, i.curva])) } catch { mapa = new Map() } } return mapa.get(id) || 'C' }
}

export function criarHistoricoAnuncio(handle, { medir = null, params = cfgAtrib } = {}) {
  handle.exec(SCHEMA_SNAPSHOT)   // idempotente: o banco em memória dos testes e um db.js ainda sem o import ganham a tabela aqui mesmo
  const ultimoQ = handle.prepare('SELECT * FROM meli_item_snapshot WHERE cliente = ? AND item_id = ? ORDER BY capturado_em DESC LIMIT 1')
  const todosQ = handle.prepare('SELECT * FROM meli_item_snapshot WHERE cliente = ? AND item_id = ? ORDER BY capturado_em DESC')
  const ins = handle.prepare(`INSERT INTO meli_item_snapshot (cliente, item_id, hash, capturado_em, origem, titulo, preco, status, categoria, tipo_anuncio, fotos_json, atributos_json, variacoes_json, frete_json, descricao, descricao_hash)
    VALUES (@cliente, @item_id, @hash, @capturado_em, @origem, @titulo, @preco, @status, @categoria, @tipo_anuncio, @fotos_json, @atributos_json, @variacoes_json, @frete_json, @descricao, @descricao_hash)
    ON CONFLICT (cliente, item_id, hash) DO UPDATE SET capturado_em = excluded.capturado_em, origem = excluded.origem`)   // voltou ao estado de antes: a linha avança (ver snapshot-schema.js)
  const insLog = handle.prepare("INSERT OR IGNORE INTO meli_item_mudanca (cliente, item_id, dia, campo, de, para, variacao_pct, fonte, em) VALUES (?,?,?,?,?,?,NULL,'coleta',?)")
  const ultimaPorItem = handle.prepare('SELECT item_id, MAX(capturado_em) ultimo FROM meli_item_snapshot WHERE cliente = ? GROUP BY item_id')
  const itensQ = handle.prepare("SELECT item_id FROM meli_item WHERE cliente = ? AND status <> 'closed' ORDER BY item_id")

  const listarSnapshots = (cliente, item_id) => todosQ.all(cliente, String(item_id)).map(snapshotDeLinha)

  // grava a fotografia SE a impressão ou a descrição mudaram desde a última. Descrição ilegível: grava sem ela e declara (sem_descricao) — a chave herda o hash
  // anterior da descrição para não nascer uma linha nova só porque a leitura falhou.
  async function capturarSnapshot(cliente, item_id, { origem = 'coleta', api = null, em = agora() } = {}) {
    if (!ORIGENS.includes(origem)) throw new Error('origem desconhecida')
    api = api || await apiPadrao()
    const item = await api.lerItem(cliente, item_id)
    if (!item || item._erro || !item.id) return { ok: false, gravou: false, motivo: `anúncio não lido (${item?._erro ? item.status : 'resposta vazia'})` }
    const imp = impressaoCompleta(item), hashImp = hashSnapshot(imp)
    const d = await api.lerDescricao(cliente, item_id).catch(() => ({ _erro: true }))
    const descricao = d && !d._erro && typeof d.plain_text === 'string' ? d.plain_text : null
    const ultimo = ultimoQ.get(cliente, String(item_id))
    const descHash = descricao != null ? hashDescricao(descricao) : (ultimo?.descricao_hash ?? null)
    const hash = chaveLinha(hashImp, descHash)
    if (ultimo && ultimo.hash === hash) return { ok: true, gravou: false, hash, sem_descricao: descricao == null, motivo: 'sem mudança desde a última fotografia' }
    const linha = { cliente, item_id: String(item_id), hash, capturado_em: em, origem, titulo: imp.titulo, preco: imp.preco, status: imp.status, categoria: imp.categoria, tipo_anuncio: imp.tipo_anuncio,
      fotos_json: JSON.stringify(imp.pictures), atributos_json: JSON.stringify(imp.atributos), variacoes_json: JSON.stringify(imp.variacoes), frete_json: JSON.stringify(imp.frete), descricao, descricao_hash: descricao != null ? descHash : null }
    let log = 0
    handle.transaction(() => {
      ins.run(linha)
      if (ultimo) for (const m of mudancasParaLog(snapshotDeLinha(ultimo), snapshotDeLinha(linha))) log += insLog.run(cliente, String(item_id), diaLocal(em), m.campo, m.de, m.para, em).changes
    })()
    return { ok: true, gravou: true, hash, sem_descricao: descricao == null, mudancas_log: log, primeira: !ultimo }
  }

  // lote da coleta: A/B a cada ab_dias, C a cada c_dias; no máximo max_itens_por_coleta e teto_ms por rodada — quem ficou de fora sai em `restantes`
  async function capturarLote(cliente, { curvaDe = null, hoje = hojeLocal(), api = null, origem = 'coleta', em = agora(), relogio = Date.now } = {}) {
    const S = params.snapshot || {}, abDias = S.ab_dias ?? 1, cDias = S.c_dias ?? 7, max = S.max_itens_por_coleta ?? 150, teto = S.teto_ms ?? 120_000
    curvaDe = curvaDe || await curvaPadrao(cliente)
    api = api || await apiPadrao()
    const ultima = new Map(ultimaPorItem.all(cliente).map(r => [r.item_id, diaLocal(r.ultimo)]))
    const devidos = itensQ.all(cliente).map(r => ({ id: r.item_id, curva: curvaDe(r.item_id), ultimo: ultima.get(r.item_id) || '' }))
      .filter(x => !x.ultimo || diasEntre(x.ultimo, hoje) >= (x.curva === 'C' ? cDias : abDias))
      .sort((x, y) => (x.curva === 'C') - (y.curva === 'C') || x.ultimo.localeCompare(y.ultimo))   // A/B primeiro, depois quem está há mais tempo sem fotografia
    const out = { cliente, devidos: devidos.length, lidos: 0, gravados: 0, sem_mudanca: 0, sem_descricao: 0, falhas: 0, mudancas_log: 0, teto_atingido: false, restantes: 0 }
    const t0 = relogio()
    for (const x of devidos) {
      if (out.lidos >= max || relogio() - t0 > teto) { out.teto_atingido = true; break }
      out.lidos++
      try {
        const r = await capturarSnapshot(cliente, x.id, { origem, api, em })
        if (!r.ok) out.falhas++
        else { if (r.gravou) { out.gravados++; out.mudancas_log += r.mudancas_log || 0 } else out.sem_mudanca++; if (r.sem_descricao) out.sem_descricao++ }
      } catch { out.falhas++ }
    }
    out.restantes = devidos.length - out.lidos
    return out
  }

  // veredito por par de fotografias consecutivas: diff + medida do Merovíngio na data da fotografia nova (medirMarco). Só o controle autoriza "piorou".
  const VEREDITO = { piorou: 'piorou', melhorou: 'melhorou', sem_efeito: 'sem_efeito', sem_controle: 'sem_controle', variacao_conta: 'sem_controle', em_maturacao: 'em_maturacao', sem_base: 'sem_base', lancamento: 'sem_base' }
  const sinal = n => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(Math.round(n)) + '%'
  function textoVeredito(v, m, dia) {
    const bruto = m?.efeito_bruto_pct
    switch (v) {
      case 'piorou': return `piorou ${sinal(m.efeito_pct)} em ${m.metrica_primaria} depois da mudança de ${dm(dia)}, descontado o controle (associação temporal, não causa provada)`
      case 'melhorou': return `melhorou ${sinal(m.efeito_pct)} em ${m.metrica_primaria} depois da mudança de ${dm(dia)}, descontado o controle (associação temporal, não causa provada)`
      case 'sem_efeito': return `sem efeito mensurável depois da mudança de ${dm(dia)} (${sinal(m.efeito_pct)} contra o controle)`
      case 'sem_controle': return bruto != null && bruto < 0 ? `caiu depois da mudança (sem controle): ${sinal(bruto)} — não dá para dizer se foi a mudança ou o mercado` : `variou depois da mudança (sem controle)${bruto != null ? `: ${sinal(bruto)}` : ''} — não dá para dizer se foi a mudança ou o mercado`
      case 'em_maturacao': return `ainda em maturação: ${m?.motivo || 'poucos dias depois da mudança'}`
      default: return `sem base para medir: ${m?.motivo || 'histórico insuficiente'}`
    }
  }
  function piorouDepoisDe(cliente, item_id, { hoje = hojeLocal(), tipo = 'Mudança no anúncio' } = {}) {
    const asc = listarSnapshots(cliente, item_id).reverse(), out = []
    const medirFn = medir || medirMarco   // o teste injeta uma medida fixa
    for (let i = 1; i < asc.length; i++) out.push({ de: asc[i - 1], para: asc[i], diff: diffSnapshots(asc[i - 1], asc[i]), dia: diaLocal(asc[i].capturado_em) })
    return Promise.all(out.map(async p => {
      const medida = await medirFn(cliente, item_id, p.dia, { hoje, tipo })
      const veredito = VEREDITO[medida?.estado] || 'sem_base'
      return { de: { hash: p.de.hash, capturado_em: p.de.capturado_em, origem: p.de.origem }, para: { hash: p.para.hash, capturado_em: p.para.capturado_em, origem: p.para.origem }, dia: p.dia, diff: p.diff,
        medida: medida ? { estado: medida.estado, efeito_pct: medida.efeito_pct ?? null, efeito_bruto_pct: medida.efeito_bruto_pct ?? null, metrica_primaria: medida.metrica_primaria ?? null, janelas: medida.janelas, controle: medida.controle ?? null, confianca: medida.confianca ?? null, confundido_preco: medida.confundido_preco ?? false, confundido_estado: medida.confundido_estado ?? false, motivo: medida.motivo ?? null } : null,
        veredito, texto: textoVeredito(veredito, medida, p.dia) }
    })).then(l => l.reverse())   // mais recente primeiro, como a lista de snapshots
  }
  const resumoSnapshots = (cliente, item_id) => listarSnapshots(cliente, item_id).map(s => ({ hash: s.hash, capturado_em: s.capturado_em, origem: s.origem, resumo: resumoDe(s), sem_descricao: s.descricao == null }))

  return { capturarSnapshot, capturarLote, listarSnapshots, resumoSnapshots, piorouDepoisDe, diffSnapshots, mudancasParaLog }
}
export const historicoAnuncio = criarHistoricoAnuncio(db)
export const { capturarSnapshot, capturarLote, listarSnapshots, piorouDepoisDe } = historicoAnuncio
export { medirMarco }
