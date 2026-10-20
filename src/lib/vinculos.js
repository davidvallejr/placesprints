// Vínculo TAREFA → ANÚNCIO. Sem anúncio identificado não há antes/depois nem atribuição, então esta camada é o gargalo de qualidade.
// Origens (só as 3 primeiras entram em medição; "sugerido" nunca vira número):
//   citado     — o ID MLB (ou o link do anúncio) está no título/descrição/conteúdo do card e é DESTE vendedor (sem falso positivo)
//   plano      — a tarefa nasceu de uma ação do plano por anúncio (sufixo "· PS-xxxxxxxxxx" → acoes_plano.item_id)
//   confirmado — alguém da equipe confirmou a sugestão na tela do cliente
//   sugerido   — semelhança entre o texto do card e o título dos anúncios; só aparece como PROPOSTA para a equipe confirmar
import { norm as normNome } from './promocoes-mc.js'   // = equipe.normNome, mas sem banco: custo-vinculo.js (importado por db.js) usa este arquivo

const RX_PS = /·\s*(PS-[0-9a-f]{10})\b/i
const STOP = new Set(('para como mais pela pelo dos das uma uns com sem por que anuncio anuncios produto produtos teste focando foco ml mercado livre ' +
  'otimizar otimizacao otimizacoes titulo titulos duplicar duplicacao criar kit kits cadastro cadastrar cadastros imagem imagens foto fotos ficha tecnica ' +
  'descricao ajuste ajustar revisar revisao oferta ofertas promocao promocoes campanha campanhas ads preco precos estoque full reuniao relatorio semanal ' +
  'acao acoes plano semana mensal item itens novo nova novos novas todos todas conta').split(' '))
// tamanhos (opt-in, vínculo de CUSTO): PP/P/M/G/GG/XG/XGG/EG e número com unidade ("5m", "10mm") viram palavra — a regra de ≥ 3 letras os descartava —
// e o rótulo "tamanho"/"tam" sai (só anuncia o tamanho). Tarefas seguem sem eles (comportamento de antes).
const TAMANHOS = new Set(['pp', 'p', 'm', 'g', 'gg', 'xg', 'xgg', 'eg']), ROTULO_TAMANHO = new Set(['tamanho', 'tam'])
const COM_UNIDADE = /^\d+(mm|cm|m|kg|g|ml|l)$/
export const tokens = (t, { tamanhos = false } = {}) => [...new Set(normNome(t).replace(/[^a-z0-9]+/g, ' ').split(' ')
  .filter(w => (w.length >= 3 || (tamanhos && (TAMANHOS.has(w) || COM_UNIDADE.test(w)))) && !STOP.has(w) && !(tamanhos && ROTULO_TAMANHO.has(w)) && !/^\d{6,}$/.test(w)))]

// ── núcleo puro: candidatos de anúncio para um texto (tarefa ou nome do custo) ─────────────
// itens: [{item_id, titulo}] do cliente. Peso de cada palavra = IDF no catálogo do cliente (palavra comum a todos os anúncios não diz nada).
// O índice tokeniza o catálogo UMA vez (o vínculo de custo consulta o mesmo catálogo para cada SKU de custo).
// Com `tamanhos`, tamanho em conflito (texto diz P, anúncio só tem M) tira o anúncio da lista, e o tamanho desempata mas não conta no mínimo de palavras em comum.
export function indiceVinculo(itens, { tamanhos = false } = {}) {
  const N = itens.length || 1, df = new Map()
  const toks = itens.map(i => new Set(tokens(i.titulo, { tamanhos })))
  const tams = tamanhos ? toks.map(ts => [...ts].filter(w => TAMANHOS.has(w))) : []
  for (const ts of toks) for (const w of ts) df.set(w, (df.get(w) || 0) + 1)
  const idf = w => Math.log(1 + N / (df.get(w) || 0.5))
  return (texto, { minCompartilhadas = 2 } = {}) => {
    const tt = tokens(texto, { tamanhos }), tam = tamanhos ? tt.filter(w => TAMANHOS.has(w)) : []
    if (tt.length === tam.length) return []
    const min = Math.min(minCompartilhadas, tt.length - tam.length)
    const totalTarefa = tt.reduce((s, w) => s + (df.has(w) ? idf(w) : idf(w) * 0.5), 0)   // palavra do card que não existe em nenhum título pesa menos (pode ser jargão)
    return itens.map((it, k) => {
      if (tam.length && tams[k].length && !tam.some(w => toks[k].has(w))) return null
      const comuns = tt.filter(w => toks[k].has(w))
      const sc = comuns.reduce((s, w) => s + idf(w), 0)
      return { item_id: it.item_id, titulo: it.titulo, comuns, score: totalTarefa ? sc / totalTarefa : 0 }
    }).filter(c => c && c.comuns.filter(w => !tam.includes(w)).length >= min).sort((a, b) => b.score - a.score)
  }
}
export function sugerirVinculo(tarefa, itens, { minCobertura = 0.6, margem = 0.15, minCompartilhadas = 2, tamanhos = false } = {}) {
  const texto = `${tarefa.titulo || ''} ${String(tarefa.descricao || '').slice(0, 200)}`
  if (tokens(texto, { tamanhos }).length < minCompartilhadas) return null
  const cand = indiceVinculo(itens, { tamanhos })(texto, { minCompartilhadas })
  const [a, b] = cand
  if (!a || a.score < minCobertura) return null
  if (b && a.score - b.score < margem) return { ambiguo: true, candidatos: cand.slice(0, 3).map(({ item_id, titulo, score }) => ({ item_id, titulo, score: Math.round(100 * score) / 100 })) }
  return { item_id: a.item_id, titulo: a.titulo, score: Math.round(100 * a.score) / 100, motivo: `palavras em comum: ${a.comuns.join(', ')}` }
}

// ── camada com banco (fábrica: o teste usa um banco em memória) ─────────────
export function criarVinculos(handle) {
  const idsDoTexto = (texto, conhecidos) => {
    const achados = new Set()
    for (const m of String(texto || '').matchAll(/MLB-?(\d{6,12})/gi)) if (conhecidos.has('MLB' + m[1])) achados.add('MLB' + m[1])
    for (const m of String(texto || '').matchAll(/(?<![\d])(\d{8,12})(?![\d])/g)) if (conhecidos.has('MLB' + m[1])) achados.add('MLB' + m[1])
    return [...achados]
  }
  // Map(tarefa_id → [{ item_id, origem }]) só com origens que entram em medição (sem 'sugerido')
  function vinculosDe(cliente, tarefas, conhecidos) {
    const out = new Map()
    const poe = (tid, item_id, origem) => {
      if (!conhecidos.has(item_id)) return
      const l = out.get(tid) || out.set(tid, []).get(tid)
      if (!l.some(x => x.item_id === item_id)) l.push({ item_id, origem })
    }
    for (const t of tarefas) for (const id of idsDoTexto(`${t.titulo} ${t.descricao} ${t.conteudo}`, conhecidos)) poe(t.id, id, 'citado')
    // V3 F3: ação de PRODUTO (dados.entidade.itens) liga TODOS os irmãos do mesmo estoque — a medição soma o grupo e os irmãos saem do controle
    const itensDe = r => { if (!/"entidade":\{"tipo":"produto"/.test(r.dados_json || '')) return [r.item_id]; try { const e = JSON.parse(r.dados_json).entidade; return Array.isArray(e?.itens) && e.itens.length ? e.itens.map(String) : [r.item_id] } catch { return [r.item_id] } }
    const plano = new Map(handle.prepare("SELECT id, item_id, dados_json FROM acoes_plano WHERE cliente = ? AND item_id != ''").all(cliente).map(r => [r.id.toUpperCase(), itensDe(r)]))
    if (plano.size) for (const t of tarefas) { const m = RX_PS.exec(t.titulo || ''); if (m && plano.has(m[1].toUpperCase())) for (const id of plano.get(m[1].toUpperCase())) poe(t.id, id, 'plano') }
    for (const r of handle.prepare("SELECT tarefa_id, item_id, origem FROM tarefa_item WHERE cliente = ? AND origem IN ('citado','plano','confirmado')").all(cliente)) poe(r.tarefa_id, r.item_id, r.origem)
    return out
  }
  // Sugestões para tarefas SEM anúncio vinculado (texto semelhante ao título de um anúncio do cliente). Nunca entram em medição.
  function sugestoes(cliente, tarefas, itens, jaVinculadas) {
    const lista = []
    for (const t of tarefas) {
      if (jaVinculadas.has(t.id)) continue
      const rec = handle.prepare("SELECT item_id FROM tarefa_item WHERE tarefa_id = ? AND origem = 'recusado'").all(t.id).map(r => r.item_id)
      const s = sugerirVinculo(t, itens.filter(i => !rec.includes(i.item_id)))
      if (s) lista.push({ tarefa_id: t.id, titulo: t.titulo, ...s })
    }
    return lista
  }
  function confirmar({ tarefa_id, item_id, por }) {
    const t = handle.prepare('SELECT cliente FROM tarefas WHERE id = ?').get(String(tarefa_id || ''))
    if (!t) throw Object.assign(new Error('tarefa não encontrada'), { status: 404 })
    const it = handle.prepare('SELECT 1 FROM meli_item WHERE cliente = ? AND item_id = ?').get(t.cliente, String(item_id || ''))
    if (!it) throw Object.assign(new Error('anúncio não pertence a este cliente'), { status: 400 })
    const quem = String(por || '').trim().slice(0, 80)
    if (!quem) throw Object.assign(new Error('informe "por" (quem confirmou o vínculo)'), { status: 400 })
    handle.prepare(`INSERT INTO tarefa_item (tarefa_id, cliente, item_id, origem, score, por, em) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(tarefa_id, item_id) DO UPDATE SET origem = 'confirmado', por = excluded.por, em = excluded.em`).run(tarefa_id, t.cliente, item_id, 'confirmado', null, quem, new Date().toISOString())
    return { ok: true }
  }
  function recusar({ tarefa_id, item_id, por }) {                 // "não é este anúncio": some das sugestões e não volta
    const t = handle.prepare('SELECT cliente FROM tarefas WHERE id = ?').get(String(tarefa_id || ''))
    if (!t) throw Object.assign(new Error('tarefa não encontrada'), { status: 404 })
    handle.prepare(`INSERT INTO tarefa_item (tarefa_id, cliente, item_id, origem, score, por, em) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(tarefa_id, item_id) DO UPDATE SET origem = 'recusado', por = excluded.por, em = excluded.em`).run(tarefa_id, t.cliente, String(item_id || ''), 'recusado', null, String(por || '').slice(0, 80), new Date().toISOString())
    return { ok: true }
  }
  function remover({ tarefa_id, item_id }) {
    handle.prepare("DELETE FROM tarefa_item WHERE tarefa_id = ? AND item_id = ? AND origem = 'confirmado'").run(String(tarefa_id || ''), String(item_id || ''))
    return { ok: true }
  }
  return { vinculosDe, sugestoes, confirmar, recusar, remover }
}
