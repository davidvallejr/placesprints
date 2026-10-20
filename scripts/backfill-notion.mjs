// Backfill leve (só propriedades, sem blocos/imagens) das tarefas já sincronizadas:
//  1) recalcula `status` a partir de status_raw com o mapeamento ATUAL (sem tocar na API);
//  2) preenche tipo_demanda ("Demandas") e usuários do Notion (id↔nome de "Responsável").
// Uso: node scripts/backfill-notion.mjs [--so-status] [--cliente "Nome"]
import { db, log } from '../src/lib/db.js'
import { normalizarStatus, mapeamento } from '../src/lib/extrair.js'
import { descobrirFontes, fontesCfg } from '../src/lib/descobrir.js'
import { resolverFontes, consultarPaginas } from '../src/lib/notion.js'
import { guardarUsuarios } from '../src/lib/equipe.js'

const arg = n => { const i = process.argv.indexOf('--' + n); return i > -1 ? process.argv[i + 1] : '' }

// 1) status
const upS = db.prepare('UPDATE tarefas SET status = ? WHERE id = ?')
let mudaram = 0
db.transaction(() => {
  for (const t of db.prepare('SELECT id, status, status_raw FROM tarefas').all()) {
    const novo = normalizarStatus(t.status_raw)
    if (novo !== t.status) { upS.run(novo, t.id); mudaram++ }
  }
})()
console.log(`✔ status recalculado: ${mudaram} tarefa(s) mudaram de categoria`)
if (process.argv.includes('--so-status')) process.exit(0)

// 2) tipo_demanda + usuários, só das bases já sincronizadas (mesmo piso de data do sync)
const P = mapeamento.propriedades
const nomeDemanda = P.tipo_demanda || ['Demandas']
const nomeResp = P.responsavel || ['Responsável']
const piso = fontesCfg.sync_inicial_desde ? fontesCfg.sync_inicial_desde + 'T00:00:00Z' : undefined
const upD = db.prepare("UPDATE tarefas SET tipo_demanda = ? WHERE id = ? AND tipo_demanda != ?")
const fontes = await descobrirFontes({ filtroCliente: arg('cliente') || undefined })
let n = 0, atualizadas = 0
for (const f of fontes) {
  n++
  try {
    const resolvidas = f.modo === 'data_source' ? [{ id: f.dbId, modo: 'data_source' }] : await resolverFontes(f.dbId)
    const pessoas = []
    for (const fonte of resolvidas) for await (const pg of consultarPaginas(fonte, { desde: piso })) {
      const p = nomeDemanda.map(k => pg.properties?.[k]).find(Boolean)
      const tipo = p?.select?.name || p?.rich_text?.map(t => t.plain_text).join('') || ''
      if (tipo && upD.run(tipo, pg.id, tipo).changes) atualizadas++
      for (const k of nomeResp) for (const u of pg.properties?.[k]?.people || []) if (u.name) pessoas.push({ id: u.id, nome: u.name })
    }
    guardarUsuarios(pessoas)
    if (n % 20 === 0) console.log(`  … ${n}/${fontes.length} clientes (${atualizadas} tipos de demanda gravados)`)
  } catch (e) { console.log(`✕ ${f.cliente}: ${e.message.slice(0, 120)}`) }
}
console.log(`✔ backfill: ${atualizadas} tarefa(s) com tipo_demanda · ${n} cliente(s) lidos`)
log('info', `backfill-notion: ${mudaram} status, ${atualizadas} tipo_demanda`)
