// Agente Smith G0 — raio-X e pauta de reunião com dados REAIS, SÓ LEITURA: data/db.sqlite aberto { readonly: true } (nunca copiado) e as linhas dos clientes pedidos vão para um banco
// EM MEMÓRIA (PS_DB_MEMORIA=1), com as tabelas da equipe (prestadores) para o auditor de nomes. Tokens em branco: nenhuma chamada ao ML. Nada é gravado no banco real.
// Uso: node scripts/guardiao.mjs <pasta> pauta "Cliente" AAAA-MM-DD HH:MM [rótulo]   → <pasta>/pauta-<slug>.html|.pdf|.txt
//      node scripts/guardiao.mjs <pasta> raiox "Cliente" ["Cliente 2" …]           → <pasta>/raiox-<slug>.txt
process.env.PS_DB_MEMORIA = '1'
import Database from 'better-sqlite3'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
const { ROOT } = await import('../src/lib/env.js')
const { db } = await import('../src/lib/db.js')
if (db.name !== ':memory:') throw new Error('o gerador só roda em memória')
const [saida, modo, ...resto] = process.argv.slice(2)
if (!saida || !['pauta', 'raiox'].includes(modo)) throw new Error('uso: node scripts/guardiao.mjs <pasta> pauta "Cliente" AAAA-MM-DD HH:MM | raiox "Cliente" …')
const clientes = modo === 'pauta' ? [resto[0]] : resto

const real = new Database(join(ROOT, 'data', 'db.sqlite'), { readonly: true, fileMustExist: true })
const cols = (h, t) => h.prepare(`PRAGMA table_info("${t}")`).all().map(c => c.name)
for (const { name: t } of real.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()) {
  const rc = cols(real, t), equipe = t === 'prestadores'
  if (!rc.includes('cliente') && !equipe) continue
  if (!cols(db, t).length) db.exec(real.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(t).sql)
  const mc = new Set(cols(db, t)), cs = rc.filter(c => mc.has(c)), lista = cs.map(c => `"${c}"`).join(',')
  const ins = db.prepare(`INSERT OR IGNORE INTO "${t}" (${lista}) VALUES (${cs.map(() => '?').join(',')})`)
  db.transaction(() => {
    const linhas = equipe ? [real.prepare(`SELECT ${lista} FROM "${t}"`).all()] : clientes.map(c => real.prepare(`SELECT ${lista} FROM "${t}" WHERE cliente = ?`).all(c))
    for (const ls of linhas) for (const r of ls) ins.run(...cs.map(c => (/token|segredo|secret/i.test(c) ? '' : r[c])))
  })()
}
// a central inteira (sem tokens) para a equipe/consultores do auditor de nomes
for (const r of real.prepare('SELECT * FROM clientes_central').all()) db.prepare(`INSERT OR IGNORE INTO clientes_central (${Object.keys(r).map(k => `"${k}"`).join(',')}) VALUES (${Object.keys(r).map(() => '?').join(',')})`).run(...Object.values(r))
const ultimoSync = real.prepare("SELECT valor FROM sync_estado WHERE chave = 'ultimo_sync'").get()
if (ultimoSync) db.prepare("INSERT OR REPLACE INTO sync_estado (chave, valor) VALUES ('ultimo_sync', ?)").run(ultimoSync.valor)
real.close()

const { pautaDoCliente, raioXDoCliente } = await import('../src/lib/guardiao-real.js')
const { gerarPdf } = await import('../src/lib/relatorio-pdf.js')
const slug = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
mkdirSync(saida, { recursive: true })
const txtRaio = rx => [`Raio-X financeiro (Smith) — ${rx.cliente} — ${rx.hoje}`, ...rx.secoes.flatMap(s => ['', `## ${s.titulo} (${s.linhas.length})`, ...s.linhas.map(l =>
  `- ${l.item} | ${l.metrica} | Previsão: ${l.previsao.txt} | Chance: ${l.chance.txt} | Medido: ${l.medido.txt}${l.medido.v == null && l.medido.txt === '—' ? ` (${l.medido.motivo})` : ''}${l.nota ? ` | ${l.nota}` : ''}`)]),
  '', `Falta: ${rx.faltando.join('; ') || 'nada'}`, ...rx.premissas.map(p => `- ${p}`)].join('\n') + '\n'

if (modo === 'pauta') {
  const [cliente, data, hora = '16:00', rotulo = ''] = resto
  const r = pautaDoCliente(cliente, { data, hora, rotulo })
  const base = join(saida, `pauta-${slug(rotulo || cliente).split('-')[0]}`)
  writeFileSync(base + '.txt', r.texto); writeFileSync(join(saida, `raiox-${slug(cliente)}.txt`), txtRaio(r.rx))
  let pdf = ''; try { pdf = await gerarPdf(r.html, base + '.pdf') } catch (e) { pdf = `falhou: ${e?.codigo || e?.message}` }
  writeFileSync(base + '.html', r.html)   // depois do PDF: o gerarPdf usa <base>.html como intermediário e o apaga
  console.log(JSON.stringify({ auditoria: r.auditoria, pdf, txt: base + '.txt', html: base + '.html' }, null, 1))
} else {
  for (const c of clientes) { const t0 = Date.now(), { rx } = raioXDoCliente(c); writeFileSync(join(saida, `raiox-${slug(c)}.txt`), txtRaio(rx)); console.log(c, `${Date.now() - t0} ms`, rx.secoes.map(s => `${s.chave}:${s.linhas.length}`).join(' ')) }
}
