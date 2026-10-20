// Sombra da V3 F2 com dados reais — «por anúncio × por produto» (docs/desenho-v3-produto-estoque-financeiro.md § 9 F2). SÓ LEITURA: data/db.sqlite é aberto com
// { readonly: true } (nunca copiado; nunca db.js no arquivo real) e as linhas dos clientes pedidos vão para um banco EM MEMÓRIA (PS_DB_MEMORIA=1), onde roda a MESMA
// projeção da aba Produtos (produtosDoCliente sobre diagnosticarConta). Tokens do ML nunca entram na memória (em branco): nenhuma chamada ao ML é possível daqui.
// Sem arestas da F1 para o cliente (coleta anterior ao reinício), as chaves são SIMULADAS com o que o banco já tem — promo_anuncio (UP e SKU), fotografias
// (SELLER_SKU), meli_item (catálogo, logística, estoque) e meli_full_estoque (inventário) — rotulado: sem variações e sem Flex (subestima as junções).
// F3 (15/10): o comparativo «por anúncio × por produto» vale com a chave ligada ou não (sombra_ligada diz o estado); o selo está na aba Produtos (#prSeloF3).
// Uso: node scripts/sombra-produto.mjs [--saida <dir>] ["Cliente" …]   (padrão: Uniaodog Artigos Pet, Rotec, 01Smart; sem --saida imprime)
process.env.PS_DB_MEMORIA = '1'
import Database from 'better-sqlite3'
import { join } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
const { ROOT } = await import('../src/lib/env.js')
const { db } = await import('../src/lib/db.js')
if (db.name !== ':memory:') throw new Error('a sombra só roda em memória')
const args = process.argv.slice(2), iS = args.indexOf('--saida'), SAIDA = iS >= 0 ? args[iS + 1] : null
const CLIENTES = args.filter((a, i) => a !== '--saida' && i !== iS + 1).length ? args.filter((a, i) => a !== '--saida' && i !== iS + 1) : ['Uniaodog Artigos Pet', 'Rotec', '01Smart']

// ── banco real (só leitura) → memória, só os clientes pedidos ──
const real = new Database(join(ROOT, 'data', 'db.sqlite'), { readonly: true, fileMustExist: true })
const cols = (h, t) => h.prepare(`PRAGMA table_info("${t}")`).all().map(c => c.name)
for (const { name: t } of real.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()) {
  const rc = cols(real, t); if (!rc.includes('cliente')) continue
  if (!cols(db, t).length) db.exec(real.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(t).sql)   // tabela de módulo com banco próprio (promo_*): mesma DDL
  const mc = new Set(cols(db, t))
  const cs = rc.filter(c => mc.has(c)), lista = cs.map(c => `"${c}"`).join(',')
  const ins = db.prepare(`INSERT OR IGNORE INTO "${t}" (${lista}) VALUES (${cs.map(() => '?').join(',')})`)
  const sel = real.prepare(`SELECT ${lista} FROM "${t}" WHERE cliente IN (${CLIENTES.map(() => '?').join(',')})`)
  db.transaction(() => { for (const r of sel.iterate(...CLIENTES)) ins.run(...cs.map(c => (t === 'meli_contas' && /token/.test(c) ? '' : r[c]))) })()
}
real.close()
// ── simulação das arestas (a mesma de scripts/conferir-grafo.mjs) quando o cliente ainda não tem a coleta da F1 ──
const FONTE_PROMO = { 'attributes.SELLER_SKU': 'seller_sku', 'user-products': 'seller_sku', 'variação': 'variacao', seller_custom_field: 'seller_custom_field' }
const fonteChaves = {}
for (const c of CLIENTES) {
  if (db.prepare('SELECT 1 FROM meli_anuncio_up WHERE cliente = ? LIMIT 1').get(c)) { fonteChaves[c] = 'F1 (coleta real)'; continue }
  fonteChaves[c] = 'SIMULAÇÃO (promo_anuncio, fotografias, meli_item, meli_full_estoque; sem variações, sem Flex)'
  const promo = new Map(db.prepare('SELECT item_id, user_product_id, sku, sku_fonte FROM promo_anuncio WHERE cliente = ?').all(c).map(r => [r.item_id, r])), snap = new Map()
  for (const r of db.prepare('SELECT item_id, atributos_json FROM meli_item_snapshot WHERE cliente = ? ORDER BY capturado_em').all(c)) {
    try { const s = String(JSON.parse(r.atributos_json || '{}').SELLER_SKU || '').trim(); if (s) snap.set(r.item_id, s) } catch { /* fotografia defensiva */ }
  }
  const inv = new Map(db.prepare('SELECT item_id, inventory_id FROM meli_full_estoque WHERE cliente = ? AND item_id IS NOT NULL ORDER BY dia').all(c).map(r => [r.item_id, r.inventory_id]))
  const ins = db.prepare(`INSERT INTO meli_anuncio_up (cliente, item_id, variacao_id, user_product_id, inventory_id, sku, sku_fonte, catalogo_produto_id, estoque, logistica, flex, tags, status, lido_em)
    VALUES (?,?,'',?,?,?,?,?,?,?,0,'',?,?)`)
  db.transaction(() => {
    for (const i of db.prepare('SELECT item_id, status, estoque, logistica, catalogo_produto_id, atualizado_em FROM meli_item WHERE cliente = ?').all(c)) {
      const p = promo.get(i.item_id), fp = FONTE_PROMO[p?.sku_fonte] || ''
      const [sku, fonte] = p?.sku && fp ? [p.sku, fp] : snap.has(i.item_id) ? [snap.get(i.item_id), 'seller_sku'] : ['', '']
      ins.run(c, i.item_id, p?.user_product_id || '', i.logistica === 'fulfillment' ? inv.get(i.item_id) || '' : '', sku, fonte, i.catalogo_produto_id || '', i.estoque, i.logistica || '', i.status || '', i.atualizado_em || '')
    }
  })()
}

const { diagnosticarConta, algoritmo } = await import('../src/lib/diagnostico-conta.js')
const { produtosDoCliente, mapeamentoDoCliente } = await import('../src/lib/produto-estoque-real.js')
const un = v => (v == null ? '—' : Number(v).toLocaleString('pt-BR'))
const cob = (a, b) => (a == null ? '—' : b != null && b !== a ? `${un(a)}–${un(b)}` : un(a))
if (SAIDA) mkdirSync(SAIDA, { recursive: true })
for (const c of CLIENTES) {
  const L = [], l = (...x) => L.push(x.join(''))
  const r = produtosDoCliente(c, diagnosticarConta(c), { cfg: algoritmo })
  l(`Sombra V3 F2/F3 — ${c} — ${new Date().toISOString().slice(0, 16)}Z — banco SÓ LEITURA → memória; diagnóstico por produto ${r.sombra_ligada ? 'LIGADO' : 'DESLIGADO (nada muda no plano, nos avisos nem nos textos)'} (produto.diagnostico_ligado = ${!!r.sombra_ligada})`)
  l(`Chaves do produto: ${fonteChaves[c]}`)
  if (!r.disponivel) { l(`Diagnóstico indisponível: ${r.motivo}`); fim(c, L); continue }
  const s = r.resumo, so = r.sombra, modos = {}
  for (const p of r.produtos) modos[p.modo] = (modos[p.modo] || 0) + 1
  l(`\n1. GRUPOS: ${un(s.anuncios_ativos)} anúncios ativos → ${un(s.produtos)} produtos (${un(s.agrupados)} com 2+ anúncios). Modos: ${Object.entries(modos).map(([k, v]) => `${k} ${v}`).join(' · ')}.`)
  l(`   Estoque dividido ${un(s.estoque_dividido)} · confirmar estoque (espelho provável) ${un(s.confirmar_estoque)} · prováveis kits sem composição (título) ${un(s.kits_sem_composicao)}.`)
  l(`\n2. ESTOQUE CONTADO UMA VEZ: somando por anúncio (ativos e pausados) ${un(so.estoque.soma_por_anuncio)} un × contado uma vez ${un(so.estoque.contado_uma_vez)} un (${un(so.estoque.em_pausados)} un em anúncios pausados)`)
  l(`   (nos produtos com estoque conhecido, a soma por anúncio seria ${un(so.estoque.soma_por_anuncio_dos_conhecidos)} un; ${un(so.estoque.produtos_sem_leitura)} produto(s) sem estoque lido ficam fora da conta, nunca como 0).`)
  l(`   Capital em estoque: ${s.capital ? `R$ ${un(Math.round(s.capital.valor))} (custo em ${s.capital.com_custo} de ${s.capital.total} produtos)` : '— (sem custo informado)'}.`)
  l(`\n3. RUPTURA (o mesmo predicado emRuptura): por anúncio ${un(so.ruptura.anuncios)} anúncio(s) × por produto ${un(so.ruptura.efs)} estoque(s) físico(s). Mudariam de estado (${so.ruptura.mudariam.length}):`)
  const nota = m => (!m.depois || m.local !== 'full' ? '' : m.estoque_proprio == null ? ' — Full vazio; estoque próprio não lido' : m.estoque_proprio > 0 ? ` — Full vazio com ${un(m.estoque_proprio)} un no próprio: enviar ao Full, não comprar (F3)` : ' — Full vazio e sem estoque próprio')
  for (const m of so.ruptura.mudariam.slice(0, 20)) l(`   - ${m.id} ${String(m.titulo).slice(0, 50)}: por anúncio ${m.antes ? 'RUPTURA' : 'ok'} (${un(m.cobertura_anuncio)} d) → por produto ${m.depois ? 'RUPTURA' : 'ok'} no ${m.local === 'full' ? 'Full' : 'próprio'} (${un(m.cobertura_ef)} d)${nota(m)} [${m.produto}]`)
  l(`\n4. COMPRAS: linhas por anúncio ${un(so.compras.linhas_por_anuncio)} × por produto ${un(so.compras.linhas_por_produto)}; unidades (cenário base) ${un(so.compras.unidades_base_por_anuncio)} × ${un(so.compras.unidades_base_por_produto)}. Linhas que se juntariam (${so.compras.juntadas.length}):`)
  for (const j of so.compras.juntadas.slice(0, 15)) l(`   - ${String(j.nome).slice(0, 60)}: ${j.linhas_antes} linha(s), ${un(j.base_antes)} un → ${j.depois} linha, ${un(j.base_depois)} un [${j.produto}]`)
  l(`\n5. COBERTURA por anúncio × por produto (grupos com 2+ anúncios, por receita; até 30):`)
  for (const p of r.produtos.filter(x => x.n_anuncios >= 2).slice(0, 30)) {
    const loc = p.efs.map(e => `${e.local} ${un(e.estoque)}`).join(' + ')
    l(`   - ${String(p.nome).slice(0, 55)} [${p.chave}] ${p.n_anuncios} anúncios · ${p.motivos.join('+') || '—'} · ${p.modo} · estoque ${loc || '—'} = ${un(p.estoque_total)} · ${un(p.vel_dia)}/dia · cobertura por anúncio ${cob(p.cobertura_por_anuncio?.min, p.cobertura_por_anuncio?.max)} d × produto ${un(p.cobertura)} d · ponto ${un(p.ponto_pedido)} · ${p.situacao}`)
  }
  const m = mapeamentoDoCliente(c)
  l(`\n6. GAVETA «Gerenciar mapeamento»: ${m.totais.sugestoes} sugestão(ões), ${m.totais.mapeados} mapeado(s), ${m.totais.nao_mapeados} não mapeado(s). Primeiras:`)
  for (const x of m.sugestoes.slice(0, 12)) l(`   - [${x.tipo}] ${x.motivo}: ${String(x.de).slice(0, 45)} → ${String(x.para).slice(0, 45)}`)
  l(`\n7. PREMISSAS:`); for (const t of r.premissas) l(`   - ${t}`)
  if (r.data_quality.avisos.length || r.data_quality.nota) { l(`\n8. AVISOS:`); if (r.data_quality.nota) l(`   - ${r.data_quality.nota}`); for (const a of r.data_quality.avisos.slice(0, 10)) l(`   - ${a}`) }
  fim(c, L)
}
function fim(c, L) { const t = L.join('\n') + '\n'; if (SAIDA) { writeFileSync(join(SAIDA, `${c.replace(/[^\w-]+/g, '_')}.txt`), t); console.log(`gravado ${c}`) } else console.log(t) }
