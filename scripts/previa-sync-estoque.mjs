// Prévia REAL do sincronismo de estoque (V3 F6) — SÓ LEITURA: data/db.sqlite aberto com { readonly: true } (nunca copiado), as linhas do cliente vão para um banco EM
// MEMÓRIA (PS_DB_MEMORIA=1) com tokens em branco (nenhuma chamada ao ML é possível daqui) e roda a MESMA previaSync da rota POST /api/chaveiro/estoque/previa.
// Sem estoque físico informado, a parte «SIMULAÇÃO» mostra o que seria escrito SE o cliente informasse, agora, físico = o maior número próprio mostrado por SKU
// (premissa de espelho; rotulada — não é recomendação). Uso: node scripts/previa-sync-estoque.mjs ["Cliente"] [--saida arquivo]
process.env.PS_DB_MEMORIA = '1'
import Database from 'better-sqlite3'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
const { ROOT } = await import('../src/lib/env.js')
const { db, agora } = await import('../src/lib/db.js')
if (db.name !== ':memory:') throw new Error('a prévia só roda em memória')
const args = process.argv.slice(2), iS = args.indexOf('--saida'), SAIDA = iS >= 0 ? args[iS + 1] : null
const C = args.filter((a, i) => a !== '--saida' && i !== iS + 1)[0] || 'Uniaodog Artigos Pet'
const real = new Database(join(ROOT, 'data', 'db.sqlite'), { readonly: true, fileMustExist: true })
const cols = (h, t) => h.prepare(`PRAGMA table_info("${t}")`).all().map(c => c.name)
for (const t of ['meli_anuncio_up', 'meli_item', 'produto_vinculo', 'meli_up_estoque', 'produto_estoque_declarado', 'produto_regra_estoque', 'meli_pedido_item', 'meli_serie_item', 'alinhamento', 'clientes_central']) {
  if (!real.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t) || !cols(db, t).length) continue
  const rc = cols(real, t), mc = new Set(cols(db, t)), cs = rc.filter(c => mc.has(c)), lista = cs.map(c => `"${c}"`).join(',')
  const ins = db.prepare(`INSERT OR IGNORE INTO "${t}" (${lista}) VALUES (${cs.map(() => '?').join(',')})`)
  db.transaction(() => { for (const r of real.prepare(`SELECT ${lista} FROM "${t}" WHERE cliente = ?`).iterate(C)) ins.run(...cs.map(c => r[c])) })()
}
real.close()
const SR = await import('../src/lib/chaveiro-estoque-real.js'), CE = await import('../src/lib/chaveiro-estoque.js'), { chaveSku, SKU_OFICIAL } = await import('../src/lib/produto-estoque.js')
const out = [], l = s => out.push(s), un = v => (v == null ? '—' : Number(v).toLocaleString('pt-BR'))
const pinta = p => {
  l(`Chave global sync_estoque_ligado = ${p.ligado} · parado = ${p.parado} · política do cliente: ${p.politica ? JSON.stringify(p.politica) : 'nenhuma (não liberado)'}`)
  for (const x of p.produtos) {
    l(`\n• SKU ${x.sku} — situação ${x.situacao}; físico ${un(x.fisico.fisico)} (informado ${un(x.fisico.informado)} por ${x.fisico.fonte ?? '—'}, −${un(x.fisico.deduzido)} vendidas); venda prevista ${x.venda_prevista_dia}/dia; segurança ${x.seguranca} un; alvo ${un(x.plano.alvo_total)}; ML mostra ${un(x.plano.soma_mostrada)}${x.plano.risco_vender_sem_estoque ? ' (MAIS que o físico)' : ''}`)
    if (x.fora.length) l(`  fora: ${x.fora.map(f => `${f.chave} (${f.motivo})`).join(', ')}`)
    if (x.motivos.length) l(`  motivos: ${x.motivos.join(' | ')}`)
  }
  l('\nPor anúncio (o que seria escrito):'); l('anúncio | variação | SKU | hoje no ML | seria escrito | escrita | situação')
  for (const r of p.linhas) l(`${r.anuncio} | ${r.variacao || '-'} | ${r.sku} | ${un(r.de)} | ${un(r.para)} | ${r.escrita} | ${r.situacao}`)
}
l(`Prévia do sincronismo de estoque (Chaveiro, V3 F6) — ${C} — ${agora().slice(0, 16)}Z — banco SÓ LEITURA → memória; NADA foi escrito no ML nem no banco.`)
l('\n== 1) PRÉVIA REAL (estoque físico informado de verdade) =='); const p1 = SR.previaSync(C); pinta(p1)
if (!p1.produtos.length) l('Nenhum SKU com estoque físico informado (produto_estoque_declarado): o sincronismo NÃO escreve nada para este cliente hoje.')
// 2) simulação rotulada: físico = maior número próprio mostrado (por SKU oficial, só SKUs em 2+ estoques próprios), informado «agora»
const ares = db.prepare("SELECT sku, sku_fonte, user_product_id, estoque, logistica, status FROM meli_anuncio_up WHERE cliente = ? AND status = 'active'").all(C)
const porSku = new Map(); for (const a of ares) if (SKU_OFICIAL.has(a.sku_fonte) && a.logistica !== 'fulfillment' && a.estoque != null) { const k = chaveSku(a.sku), m = porSku.get(k) || new Map(); m.set(a.user_product_id || Math.random(), Math.max(m.get(a.user_product_id) || 0, a.estoque)); porSku.set(k, m) }
const multi = [...porSku].filter(([, m]) => m.size >= 2).sort((a, b) => a[0].localeCompare(b[0])).slice(0, 25)
db.prepare('DELETE FROM produto_estoque_declarado WHERE cliente = ?').run(C)
for (const [k, m] of multi) db.prepare("INSERT INTO produto_estoque_declarado (cliente, sku, quantidade, fonte, por, em) VALUES (?,?,?,'equipe','simulacao',?)").run(C, k, Math.max(...m.values()), agora())
l(`\n== 2) SIMULAÇÃO (NÃO é dado do cliente): ${multi.length} SKU(s) em 2+ estoques próprios; físico «informado agora» = o maior número próprio mostrado (premissa de espelho) ==`)
pinta(SR.previaSync(C))
const txt = out.join('\n'); if (SAIDA) writeFileSync(SAIDA, txt + '\n'); else console.log(txt)
console.log(`ok: ${p1.produtos.length} SKU(s) reais, ${multi.length} simulados${SAIDA ? ` → ${SAIDA}` : ''}`)
