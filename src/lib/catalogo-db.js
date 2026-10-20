// Dados do anúncio de CATÁLOGO: coleta do catalog_product_id, marcador manual "catálogo próprio" (por cliente e por anúncio) e as contas do painel.
// O que existe de verdade: meli_item.catalogo (catalog_listing do ML). "Próprio × terceiros" NÃO é determinável por API — só por marcação manual, e sem marcação o
// catálogo é de TERCEIROS (padrão seguro: não recomendar edição que o vendedor não pode fazer). Predicado: src/lib/catalogo.js.
// Núcleo SEM import de banco (como criarPerfis/criarDependencias): o handle entra por fábrica; o autoteste usa :memory:. Todas as leituras toleram banco com menos
// tabelas (testes de módulos vizinhos têm DDL mínimo): sem as tabelas novas, tudo é "terceiros", nunca erro.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './env.js'
import { origemCatalogo } from './catalogo.js'
import { CATALOGO } from './catalogo-cfg.js'

export const SCHEMA_CATALOGO = `
CREATE TABLE IF NOT EXISTS catalogo_origem (   -- exceção por anúncio ao padrão do cliente (perfil_cliente.catalogo_proprio): catálogo próprio ou de terceiros
  cliente TEXT NOT NULL, item_id TEXT NOT NULL,
  origem TEXT NOT NULL CHECK (origem IN ('proprio','terceiros')),
  por TEXT NOT NULL DEFAULT '', em TEXT NOT NULL,
  PRIMARY KEY (cliente, item_id)
);`

// migração aditiva e idempotente (db.js chama uma vez): coluna do catalog_product_id, padrão do cliente e a tabela de exceções
export function migrarCatalogo(h) {
  const tem = t => !!h.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t)
  const cols = t => new Set(h.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name))
  if (tem('meli_item') && !cols('meli_item').has('catalogo_produto_id')) h.exec("ALTER TABLE meli_item ADD COLUMN catalogo_produto_id TEXT NOT NULL DEFAULT ''")
  if (tem('perfil_cliente') && !cols('perfil_cliente').has('catalogo_proprio')) h.exec('ALTER TABLE perfil_cliente ADD COLUMN catalogo_proprio INTEGER')   // NULL = terceiros (padrão seguro); 1 = próprio; 0 = terceiros marcado
  h.exec(SCHEMA_CATALOGO)
}

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const RX_ITEM = /^[A-Za-z]{3}\d{1,15}$/
const str = v => typeof v === 'string' ? v.trim() : ''
const objetivoPadrao = () => { try { return JSON.parse(readFileSync(join(ROOT, 'config', 'perfis-cliente.json'), 'utf-8')).padrao.objetivo } catch { return 'ads' } }

// deps: agora(), validarPor(nome) → nome canônico de líder/consultor ou '' (equipe.validarLiderOuConsultor), log?(nivel, msg)
export function criarCatalogo(h, { agora = () => new Date().toISOString(), validarPor = nome => str(nome), log = null } = {}) {
  // contexto do cliente para o predicado: padrão (marcação manual do cliente) + exceções por anúncio. Sem marcação nenhuma → terceiros.
  function contexto(cliente) {
    let padrao = 'terceiros'
    const excecoes = new Map()
    try { if (h.prepare('SELECT catalogo_proprio FROM perfil_cliente WHERE cliente = ?').get(cliente)?.catalogo_proprio === 1) padrao = 'proprio' } catch { /* banco sem a coluna: terceiros */ }
    try { for (const r of h.prepare('SELECT item_id, origem FROM catalogo_origem WHERE cliente = ?').all(cliente)) excecoes.set(r.item_id, r.origem) } catch { /* banco sem a tabela */ }
    return { padrao, excecoes }
  }

  // origem de vários anúncios do cliente numa leitura (para enriquecer ações/cartões já gravados sem refazer o plano): Map item_id → 'nao'|'proprio'|'terceiros'
  function origensDe(cliente, ids) {
    const lista = [...new Set((ids || []).filter(Boolean).map(String))], out = new Map(lista.map(i => [i, 'nao']))
    if (!lista.length) return out
    let rows = []
    try { rows = h.prepare('SELECT item_id, catalogo FROM meli_item WHERE cliente = ? AND item_id IN (SELECT value FROM json_each(?))').all(cliente, JSON.stringify(lista)) } catch { return out }
    const ctx = contexto(cliente)
    for (const r of rows) out.set(r.item_id, origemCatalogo({ id: r.item_id, catalogo: r.catalogo }, ctx))
    return out
  }

  // contas do painel: quantos anúncios de catálogo, quantos ativos, quantos contam como terceiros/próprio sob o padrão + exceções
  function resumo(cliente) {
    const ctx = contexto(cliente)
    let itens = []
    try { itens = h.prepare('SELECT item_id, status FROM meli_item WHERE cliente = ? AND catalogo = 1').all(cliente) } catch { /* sem meli_item */ }
    let terceiros = 0, proprio = 0
    for (const i of itens) origemCatalogo({ id: i.item_id, catalogo: 1 }, ctx) === 'proprio' ? proprio++ : terceiros++
    let excecoes = []
    try {
      excecoes = h.prepare(`SELECT o.item_id, o.origem, o.por, o.em, COALESCE(m.titulo, '') titulo FROM catalogo_origem o
        LEFT JOIN meli_item m ON m.cliente = o.cliente AND m.item_id = o.item_id WHERE o.cliente = ? ORDER BY o.em DESC LIMIT 500`).all(cliente)
    } catch { /* sem a tabela */ }
    return { cliente, padrao: ctx.padrao, total: itens.length, ativos: itens.filter(i => i.status === 'active').length, terceiros, proprio, excecoes }
  }

  // padrão do cliente: proprio true | false | null (null apaga a marcação). Sem confirmar === true é prévia (nada é gravado).
  function definirPadrao({ cliente, proprio, por, confirmar = false } = {}) {
    cliente = str(cliente)
    if (!cliente) throw erro('informe "cliente"')
    if (proprio !== true && proprio !== false && proprio !== null) throw erro('"proprio" deve ser true, false ou null')
    if (!str(por)) throw erro('informe "por" (quem marca — líder ou consultor)')
    const nome = validarPor(str(por))
    if (!nome) throw erro('só líderes e consultores marcam o catálogo próprio — escolha um nome da central', 403)
    const antes = resumo(cliente), novo = proprio === true ? 'proprio' : 'terceiros'
    const sem = antes.excecoes.length
    const previa = {
      cliente, de: antes.padrao, para: novo, catalogo_total: antes.total, ativos: antes.ativos,
      mudam: novo === antes.padrao ? 0 : antes.total - sem, excecoes_mantidas: sem,
      texto: novo === 'proprio'
        ? `Os ${antes.total} anúncios de catálogo desta conta passam a ser tratados como PRÓPRIOS (marca/dono do produto): foto, título, descrição e ficha seguem sem edição direta no item, e a recomendação vira "${CATALOGO.texto_proprio}" Só marque se esta conta for a dona do produto no catálogo; sem marcação, o catálogo é de terceiros.`
        : `Os anúncios de catálogo desta conta voltam a ser tratados como de TERCEIROS: ${CATALOGO.texto_terceiros}`,
    }
    if (confirmar !== true) return { ok: true, previa: true, ...previa }
    const t = agora()
    const valor = proprio === null ? null : proprio ? 1 : 0
    const nova = h.transaction(() => {
      const ex = h.prepare('SELECT 1 FROM perfil_cliente WHERE cliente = ?').get(cliente)
      if (ex) { h.prepare('UPDATE perfil_cliente SET catalogo_proprio = ? WHERE cliente = ?').run(valor, cliente); return false }   // perfil, objetivo e "por" do perfil ficam como estão
      if (valor === null) return false
      // cliente sem perfil salvo: a linha nasce vazia (perfis '[]' → o perfil continua o padrão da config, origem 'padrao') só para guardar o marcador
      h.prepare("INSERT INTO perfil_cliente (cliente, perfis_json, objetivo, atualizado_em, por, catalogo_proprio) VALUES (?, '[]', ?, ?, ?, ?)").run(cliente, objetivoPadrao(), t, nome.slice(0, 80), valor)
      return true
    })()
    log?.('info', `catálogo: ${nova ? 'linha de perfil criada e ' : ''}padrão do cliente = ${novo} (por ${nome})`)
    return { ok: true, ...previa, previa: false, gravado_por: nome, resumo: resumo(cliente) }
  }

  // exceção por anúncio: origem 'proprio' | 'terceiros' | null (null remove e o anúncio volta ao padrão do cliente). O anúncio precisa ser do cliente e de catálogo.
  function definirExcecao({ cliente, item_id, origem, por, confirmar = false } = {}) {
    cliente = str(cliente); item_id = str(item_id).toUpperCase()
    if (!cliente) throw erro('informe "cliente"')
    if (!RX_ITEM.test(item_id)) throw erro('informe "item_id" no formato do anúncio (ex.: MLB123456789)')
    if (origem !== 'proprio' && origem !== 'terceiros' && origem !== null) throw erro('"origem" deve ser "proprio", "terceiros" ou null')
    if (!str(por)) throw erro('informe "por" (quem marca — líder ou consultor)')
    const nome = validarPor(str(por))
    if (!nome) throw erro('só líderes e consultores marcam o catálogo próprio — escolha um nome da central', 403)
    let m = null
    try { m = h.prepare('SELECT item_id, titulo, catalogo FROM meli_item WHERE cliente = ? AND item_id = ?').get(cliente, item_id) } catch { /* sem meli_item */ }
    if (!m) throw erro('anúncio não encontrado neste cliente', 404)
    if (!m.catalogo) return { ok: false, motivo: 'este anúncio não é de catálogo: não há o que marcar' }
    const ctx = contexto(cliente), de = origemCatalogo({ id: item_id, catalogo: 1 }, ctx)
    const efetivo = origem ?? ctx.padrao
    const previa = { cliente, item_id, titulo: String(m.titulo || '').slice(0, 120), de, para: efetivo, remove_excecao: origem === null,
      texto: efetivo === 'proprio' ? `Este anúncio passa a ser tratado como catálogo PRÓPRIO: ${CATALOGO.texto_proprio}` : `Este anúncio passa a ser tratado como catálogo de TERCEIROS: ${CATALOGO.texto_terceiros}` }
    if (confirmar !== true) return { ok: true, previa: true, ...previa }
    if (origem === null) h.prepare('DELETE FROM catalogo_origem WHERE cliente = ? AND item_id = ?').run(cliente, item_id)
    else h.prepare(`INSERT INTO catalogo_origem (cliente, item_id, origem, por, em) VALUES (?,?,?,?,?)
      ON CONFLICT(cliente, item_id) DO UPDATE SET origem = excluded.origem, por = excluded.por, em = excluded.em`).run(cliente, item_id, origem, nome.slice(0, 80), agora())
    log?.('info', `catálogo: exceção do anúncio ${item_id} = ${origem ?? 'removida'} (por ${nome})`)
    return { ok: true, ...previa, previa: false, gravado_por: nome, resumo: resumo(cliente) }
  }

  return { contexto, origensDe, resumo, definirPadrao, definirExcecao }
}
