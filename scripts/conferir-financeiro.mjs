// Conferidor do financeiro da V3 F4 com dados reais (docs/desenho-v3-produto-estoque-financeiro.md § 9 F4, «pronto quando»). SÓ LEITURA: data/db.sqlite é aberto com
// { readonly: true } (nunca copiado; nunca db.js no arquivo real) e as linhas dos clientes pedidos vão para um banco EM MEMÓRIA (PS_DB_MEMORIA=1). Tokens em branco:
// nenhuma chamada ao ML é possível daqui. Por cliente: dias com linhas, receita das linhas × GMV nos mesmos dias, frete lido (envios e % da receita), tarifa (conciliada
// ou premissa), custo, lucro/margem da conta e o DRE do mês. Com --plano: o plano com financeiro.margem_medida_nas_regras desligada × ligada (antes × depois da decisão).
// Uso: node scripts/conferir-financeiro.mjs [--plano] ["Cliente" …]   (padrão: Uniaodog Artigos Pet, Rotec, 01Smart)
process.env.PS_DB_MEMORIA = '1'
import Database from 'better-sqlite3'
import { join } from 'node:path'
const { ROOT } = await import('../src/lib/env.js')
const { db, hojeLocal } = await import('../src/lib/db.js')
if (db.name !== ':memory:') throw new Error('o conferidor só roda em memória')
const args = process.argv.slice(2), PLANO = args.includes('--plano'), nomes = args.filter(a => a !== '--plano')
const CLIENTES = nomes.length ? nomes : ['Uniaodog Artigos Pet', 'Rotec', '01Smart']

const real = new Database(join(ROOT, 'data', 'db.sqlite'), { readonly: true, fileMustExist: true })
const cols = (h, t) => h.prepare(`PRAGMA table_info("${t}")`).all().map(c => c.name)
for (const { name: t } of real.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()) {
  const rc = cols(real, t); if (!rc.includes('cliente')) continue
  if (!cols(db, t).length) db.exec(real.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(t).sql)
  const mc = new Set(cols(db, t)), cs = rc.filter(c => mc.has(c)), lista = cs.map(c => `"${c}"`).join(',')
  const ins = db.prepare(`INSERT OR IGNORE INTO "${t}" (${lista}) VALUES (${cs.map(() => '?').join(',')})`)
  const sel = real.prepare(`SELECT ${lista} FROM "${t}" WHERE cliente IN (${CLIENTES.map(() => '?').join(',')})`)
  db.transaction(() => { for (const r of sel.iterate(...CLIENTES)) ins.run(...cs.map(c => (t === 'meli_contas' && /token/.test(c) ? '' : r[c]))) })()
}
real.close()

const { financeiroDoCliente, dreDoCliente } = await import('../src/lib/lucro-real.js')
const { diagnosticarConta, algoritmo } = await import('../src/lib/diagnostico-conta.js')
const { montarAcoes } = await import('../src/lib/plano-anuncios.js')
const hoje = hojeLocal(), R$ = c => (c == null ? '—' : 'R$ ' + (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })), pct = x => (x == null ? '—' : `${Math.round(x * 100)}%`)
for (const C of CLIENTES) {
  const f = financeiroDoCliente(C, { hoje }), conta = f.por(() => 'conta').get('conta')
  const com = new Set(); for (let d = f.de; d <= f.ate; d = (x => { const t = new Date(x + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10) })(d)) if (!f.dias.sem_linhas.includes(d)) com.add(d)
  const q = [...com].map(() => '?').join(','), gmvCom = com.size ? Math.round(db.prepare(`SELECT COALESCE(SUM(receita), 0) r FROM meli_serie_item WHERE cliente = ? AND dia IN (${q})`).get(C, ...com).r * 100) : 0
  const pagasCom = com.size ? db.prepare(`SELECT COALESCE(SUM(preco_unit_c * quantidade), 0) c FROM meli_pedido_item WHERE cliente = ? AND status = 'paid' AND dia IN (${q})`).get(C, ...com).c : 0
  const canc = com.size ? db.prepare(`SELECT COALESCE(SUM(preco_unit_c * quantidade), 0) c FROM meli_pedido_item WHERE cliente = ? AND status = 'cancelled' AND dia IN (${q})`).get(C, ...com).c : 0
  console.log(`\n══ ${C} — ${f.de} a ${f.ate}`)
  console.log(`dias com linhas: ${f.dias.com_linhas} de ${f.dias.total}${f.dias.com_linhas ? '' : ' (sem dado: a coleta grava as linhas a partir do reinício; o backfill completa 10 dias por coleta)'}`)
  if (com.size) console.log(`receita nos dias com linhas: linhas pagas ${R$(pagasCom)} + canceladas marcadas ${R$(canc)} × GMV (série) ${R$(gmvCom)} → ${gmvCom - pagasCom - canc === 0 ? 'BATE' : `diferença ${R$(gmvCom - pagasCom - canc)} (cancelado antes da gravação das linhas)`}`)
  console.log(`frete: ${f.envios.lidos} de ${f.envios.total} envios lidos${Object.keys(f.envios.pendentes).length ? ` (pendentes: ${JSON.stringify(f.envios.pendentes)})` : ''} · cobertura de taxas+frete ${pct(conta?.cobertura_taxas_frete)} da receita (meta ≥ 80%)`)
  console.log(`tarifa: ${f.tarifa.rotulo} · votos ${JSON.stringify(f.tarifa.votos)}`)
  console.log(`custo informado em ${pct(conta?.cobertura_custo)} da receita · lucro de contribuição ${conta?.lucro_c == null ? `— (${conta?.motivo || 'sem linhas'})` : `${R$(conta.lucro_c)} (margem ${conta.margem_pct}%, ${conta.antes_do_imposto ? 'antes do imposto' : 'depois do imposto'})`}`)
  const d = dreDoCliente(C, hoje.slice(0, 7), { hoje })
  if (!d.disponivel) console.log(`DRE ${hoje.slice(0, 7)}: ${d.motivo}`)
  else console.log('DRE ' + d.mes + (d.parcial ? ` (parcial: ${d.parcial.dias_sem_linhas} de ${d.parcial.dias} dias sem linhas)` : '') + ':\n  ' + d.linhas.map(l => `${l.rotulo}: ${R$(l.valor_c)}${l.nota ? ` [${l.nota}]` : ''}`).join('\n  ') + `\n  ${d.rodape}`)
  if (PLANO) {
    const resumo = a => new Map(a.map(x => [x.id, `${x.regra} ${x.item_id || ''} p=${x.prioridade}`]))
    const diag0 = diagnosticarConta(C, { hoje }); if (!diag0.disponivel) { console.log('plano: diagnóstico indisponível — ' + diag0.motivo); continue }
    const off = resumo(montarAcoes(C, diag0, { hoje }))
    algoritmo.financeiro.margem_medida_nas_regras = true
    let on; try { on = resumo(montarAcoes(C, diagnosticarConta(C, { hoje }), { hoje })) } finally { algoritmo.financeiro.margem_medida_nas_regras = false }
    const sai = [...off.keys()].filter(k => !on.has(k)), entra = [...on.keys()].filter(k => !off.has(k)), muda = [...on.keys()].filter(k => off.has(k) && off.get(k) !== on.get(k))
    console.log(`plano com a chave LIGADA × desligada: ${entra.length} ação(ões) nova(s), ${sai.length} sai(em), ${muda.length} com prioridade diferente`)
    for (const k of entra) console.log('  + ' + on.get(k)); for (const k of sai) console.log('  − ' + off.get(k)); for (const k of muda) console.log(`  ~ ${off.get(k)} → ${on.get(k)}`)
  }
}
