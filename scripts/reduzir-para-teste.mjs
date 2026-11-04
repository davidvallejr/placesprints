// Reduz o Place Sprints aos CLIENTES DE TESTE (config/clientes-teste.json → clientes; pedido do David, 04/11/2026): apaga do banco e do Mac tudo dos outros clientes.
// PRÉVIA POR PADRÃO (só lê e conta). Só com --confirmar apaga — e é IRREVERSÍVEL no Mac: faça antes `node scripts/backup-banco.mjs --confirmar` (cifrado no Drive).
// O que --confirmar faz, nesta ordem: (1) liga ativo=true no config (o sync passa a enxergar só a lista); (2) em TODA tabela com coluna cliente, DELETE WHERE cliente
// fora da lista (inclui prospects [Comercial] e contas [S90]); (3) evidências/tarefas órfãs; (4) pastas data/evidencias/<tarefa> e data/relatorios/* dos outros;
// (5) data/backups/meli_contas-*.json (têm os tokens de TODAS as contas) e meli_contas_arquivo; (6) VACUUM; (7) linha no livro de execução.
// Uso: node scripts/reduzir-para-teste.mjs [--confirmar]       (rode com o servidor PARADO: launchctl bootout gui/$(id -u)/com.place2u.place-sprints.servidor)
import { readFileSync, writeFileSync, readdirSync, rmSync, statSync, existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = new URL('..', import.meta.url).pathname
const CONFIRMAR = process.argv.includes('--confirmar')
const { db, agora } = await import('../src/lib/db.js')
const { lerClientesTeste, ARQUIVO_CLIENTES_TESTE } = await import('../src/lib/clientes-teste.js')
const { slug } = await import('../src/lib/relatorio-pdf.js')
const { criarLivroExecucao, versaoGit } = await import('../src/lib/execucao-sistema.js')

const cfg = lerClientesTeste()
if (!cfg.lista.length) { console.log('config/clientes-teste.json sem clientes — nada a fazer'); process.exit(2) }
const manter = cfg.lista
const na = manter.map(() => '?').join(',')
const naCentral = db.prepare(`SELECT cliente FROM clientes_central WHERE cliente IN (${na})`).all(...manter).map(r => r.cliente)
const faltam = manter.filter(c => !naCentral.includes(c))
if (faltam.length) { console.log(`ATENÇÃO: nome(s) fora da central (grafia?): ${faltam.join(' · ')}`); process.exit(2) }

// (2) tabelas com coluna cliente
const tabelas = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name)
  .filter(t => db.prepare(`PRAGMA table_info(${t})`).all().some(c => c.name === 'cliente'))
const plano = tabelas.map(t => ({ tabela: t, apagar: db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE cliente NOT IN (${na})`).get(...manter).n, ficam: db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE cliente IN (${na})`).get(...manter).n })).filter(p => p.apagar || p.ficam)
// (3) órfãs: evidências de tarefas que vão sair (a tabela evidencias não tem cliente)
const evidOrfas = db.prepare(`SELECT COUNT(*) n FROM evidencias WHERE tarefa_id NOT IN (SELECT id FROM tarefas WHERE cliente IN (${na}))`).get(...manter).n
// (4) pastas: data/evidencias/<tarefa_id> fora das tarefas mantidas; data/relatorios/* cujo nome não começa pelo slug de um mantido
const tarefasFicam = new Set(db.prepare(`SELECT id FROM tarefas WHERE cliente IN (${na})`).all(...manter).map(r => String(r.id).replace(/-/g, '')))   // pasta = id da tarefa SEM hífens (evidencias.arquivo_local)
const dirEv = join(ROOT, 'data', 'evidencias'), dirRel = join(ROOT, 'data', 'relatorios'), dirBk = join(ROOT, 'data', 'backups')
const tam = p => { try { const s = statSync(p); if (!s.isDirectory()) return s.size; return readdirSync(p).reduce((t, f) => t + tam(join(p, f)), 0) } catch { return 0 } }
const evDirs = existsSync(dirEv) ? readdirSync(dirEv).filter(d => !tarefasFicam.has(d)) : []
const slugs = manter.map(slug)
const relArq = existsSync(dirRel) ? readdirSync(dirRel).filter(f => f !== 'pdf' && !slugs.some(s => f.includes(s))) : []
const relPdf = existsSync(join(dirRel, 'pdf')) ? readdirSync(join(dirRel, 'pdf')).filter(f => !slugs.some(s => f.startsWith(s))) : []
const bkArq = existsSync(dirBk) ? readdirSync(dirBk).filter(f => /^meli_contas-/.test(f)) : []
const mb = b => (b / 1e6).toFixed(1) + ' MB'
const evBytes = evDirs.reduce((t, d) => t + tam(join(dirEv, d)), 0), relBytes = relArq.reduce((t, f) => t + tam(join(dirRel, f)), 0) + relPdf.reduce((t, f) => t + tam(join(dirRel, 'pdf', f)), 0)

console.log(`${CONFIRMAR ? 'APAGANDO' : 'PRÉVIA'} — ficam ${manter.length} clientes: ${manter.join(' · ')}`)
for (const p of plano.sort((a, b) => b.apagar - a.apagar)) if (p.apagar) console.log(`  ${p.tabela}: apaga ${p.apagar} linha(s), ficam ${p.ficam}`)
console.log(`  evidencias (órfãs): apaga ${evidOrfas}\n  data/evidencias: ${evDirs.length} pasta(s), ${mb(evBytes)}\n  data/relatorios: ${relArq.length + relPdf.length} arquivo(s), ${mb(relBytes)}\n  data/backups: ${bkArq.length} arquivo(s) meli_contas-*.json (tokens de todas as contas)`)
console.log(`  banco hoje: ${mb(tam(join(ROOT, 'data', 'db.sqlite')))}`)
if (!CONFIRMAR) { console.log('\nNada foi apagado. Para apagar: pare o servidor, faça o backup cifrado e rode com --confirmar.'); process.exit(0) }

// ── apaga ──
const t0 = Date.now(), inicio = agora()
const j = JSON.parse(readFileSync(ARQUIVO_CLIENTES_TESTE, 'utf-8')); j.ativo = true; j.ligado_em = inicio
writeFileSync(ARQUIVO_CLIENTES_TESTE + '.tmp', JSON.stringify(j, null, 2) + '\n'); renameSync(ARQUIVO_CLIENTES_TESTE + '.tmp', ARQUIVO_CLIENTES_TESTE)
db.pragma('foreign_keys = OFF')
// livros append-only (registro_cliente, perfil_informacao_hist, …) têm gatilho BEFORE DELETE com RAISE: só aqui, na redução para teste, o gatilho sai e volta na mesma transação
const gatilhosDelete = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='trigger' AND sql LIKE '%BEFORE DELETE%' AND sql LIKE '%RAISE%'").all()
const total = db.transaction(() => {
  let n = 0
  for (const g of gatilhosDelete) db.exec(`DROP TRIGGER IF EXISTS ${g.name}`)
  for (const p of plano) if (p.apagar) n += db.prepare(`DELETE FROM ${p.tabela} WHERE cliente NOT IN (${na})`).run(...manter).changes
  n += db.prepare(`DELETE FROM evidencias WHERE tarefa_id NOT IN (SELECT id FROM tarefas)`).run().changes
  for (const t of ['tarefa_acomp', 'tarefa_item', 'tarefa_dependencia']) { try { n += db.prepare(`DELETE FROM ${t} WHERE tarefa_id NOT IN (SELECT id FROM tarefas)`).run().changes } catch { /* sem a coluna */ } }
  try { n += db.prepare('DELETE FROM meli_contas_arquivo').run().changes } catch { /* sem a tabela */ }
  try { n += db.prepare("DELETE FROM sync_estado WHERE chave LIKE 'fonte_descoberta:%' AND substr(chave, 18) NOT IN (" + na + ')').run(...manter).changes } catch { /* ok */ }
  for (const g of gatilhosDelete) db.exec(g.sql)
  return n
})()
let arquivos = 0
for (const d of evDirs) { rmSync(join(dirEv, d), { recursive: true, force: true }); arquivos++ }
for (const f of relArq) { rmSync(join(dirRel, f), { recursive: true, force: true }); arquivos++ }
for (const f of relPdf) { rmSync(join(dirRel, 'pdf', f), { force: true }); arquivos++ }
for (const f of bkArq) { rmSync(join(dirBk, f), { force: true }); arquivos++ }
db.exec('VACUUM')
const livro = criarLivroExecucao({ handle: db, agora, versao: versaoGit(ROOT) })
livro.gravar({ sistema: 'trinity', operacao: 'reduzir_para_teste', inicio, fim: agora(), ms: Date.now() - t0, ok: manter.length, total: manter.length, falhas: 0, detalhe: { linhas_apagadas: total, arquivos_apagados: arquivos, mantidos: manter } })
console.log(`\nFeito: ${total} linha(s) e ${arquivos} pasta(s)/arquivo(s) apagados; banco agora ${mb(tam(join(ROOT, 'data', 'db.sqlite')))}. Modo clientes de teste LIGADO. Suba o servidor de novo.`)
