// V3 F9 — gera os 8 relatórios de um cliente com dados REAIS, SÓ LEITURA: data/db.sqlite aberto { readonly: true } (nunca copiado; db.js nunca no arquivo real) e as linhas
// do cliente vão para um banco EM MEMÓRIA (PS_DB_MEMORIA=1). Tokens em branco: nenhuma chamada ao ML. Saída: 1 .txt pequeno por relatório + resumo.txt na pasta pedida.
// Uso: node scripts/relatorios-ciclo.mjs <pasta-de-saida> ["Cliente"]   (padrão: Uniaodog Artigos Pet)
process.env.PS_DB_MEMORIA = '1'
import Database from 'better-sqlite3'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
const { ROOT } = await import('../src/lib/env.js')
const { db } = await import('../src/lib/db.js')
if (db.name !== ':memory:') throw new Error('o gerador só roda em memória')
const [saida, cliente = 'Uniaodog Artigos Pet'] = process.argv.slice(2)
if (!saida) throw new Error('uso: node scripts/relatorios-ciclo.mjs <pasta-de-saida> ["Cliente"]')

const real = new Database(join(ROOT, 'data', 'db.sqlite'), { readonly: true, fileMustExist: true })
const cols = (h, t) => h.prepare(`PRAGMA table_info("${t}")`).all().map(c => c.name)
for (const { name: t } of real.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()) {
  const rc = cols(real, t); if (!rc.includes('cliente')) continue
  if (!cols(db, t).length) db.exec(real.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(t).sql)
  const mc = new Set(cols(db, t)), cs = rc.filter(c => mc.has(c)), lista = cs.map(c => `"${c}"`).join(',')
  const ins = db.prepare(`INSERT OR IGNORE INTO "${t}" (${lista}) VALUES (${cs.map(() => '?').join(',')})`)
  db.transaction(() => { for (const r of real.prepare(`SELECT ${lista} FROM "${t}" WHERE cliente = ?`).iterate(cliente)) ins.run(...cs.map(c => (/token|segredo|secret/i.test(c) ? '' : r[c]))) })()
}
real.close()

const { todosDoCliente } = await import('../src/lib/relatorios-ciclo-real.js')
const rels = todosDoCliente(cliente, { semCache: true })
mkdirSync(saida, { recursive: true })
const resumo = []
for (const [nome, r] of Object.entries(rels)) {
  const out = [`${r.titulo} — ${r.cliente} — ${r.hoje}${r.janela ? ` (janela ${r.janela.de} a ${r.janela.ate}, ${r.janela.dias_coleta}/28 dias com coleta)` : ''}`]
  if (!r.disponivel) out.push(`INDISPONÍVEL: ${r.motivo}`)
  for (const s of r.secoes) {
    out.push('', `## ${s.titulo} (${s.linhas.length})`)
    for (const l of s.linhas.slice(0, 25)) out.push(`- ${l.item} | ${l.metrica} | Previsão: ${l.previsao.txt}${l.previsao.v == null && l.previsao.motivo && l.previsao.txt === '—' ? ` (${l.previsao.motivo})` : ''} | Chance: ${l.chance.txt} | Medido: ${l.medido.txt}${l.medido.v == null && l.medido.txt === '—' ? ` (${l.medido.motivo})` : ''}${l.nota ? ` | ${l.nota}` : ''}`)
    if (s.linhas.length > 25) out.push(`  … e mais ${s.linhas.length - 25} (CSV traz todas)`)
  }
  out.push('', 'Premissas:', ...r.premissas.map(p => `- ${p}`), '', `Falta para ficar completo: ${r.faltando.join('; ') || 'nada'}`)
  writeFileSync(join(saida, `${nome}.txt`), out.join('\n') + '\n')
  const ls = r.secoes.flatMap(s => s.linhas), cels = ls.flatMap(l => [l.previsao, l.medido])
  resumo.push(`${nome}: ${ls.length} linhas · medido com número ${ls.filter(l => l.medido.v != null).length}/${ls.length} · previsão com número ${ls.filter(l => l.previsao.v != null).length}/${ls.length} · chance calibrada ${ls.filter(l => l.chance.v != null).length} · «—» ${cels.filter(c => c.v == null).length}`)
}
writeFileSync(join(saida, 'resumo.txt'), resumo.join('\n') + '\n')
console.log(resumo.join('\n'))
