// Semeia a programação do Relatório de Sprints ao Notion: SEMANAL para os clientes ATIVOS/elegíveis, primeiro envio na sexta-feira escolhida
// (padrão 2026-10-16), com ativado_por vazio — ou seja, NÃO liberado: nada dispara até um líder liberar (POST /api/relatorio/liberar) e ligar o agendador.
// Idempotente; nunca sobrescreve programação já existente; dry-run por padrão; rejeita data no passado (a programação começaria atrasada).
// Uso: node scripts/semear-relatorio-programacao.mjs [--data=AAAA-MM-DD] [--aplicar]
import { db, agora } from '../src/lib/db.js'
import { clientesElegiveis } from '../src/lib/equipe.js'
import { lerConfig, semearProgramacao, dataValida, diaSemana, dataNoFuso } from '../src/lib/relatorio-envio.js'

const arg = k => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3)
const data = arg('data') || '2026-10-16'
const aplicar = process.argv.includes('--aplicar')
if (!dataValida(data)) { console.error('✘ --data inválida (use AAAA-MM-DD)'); process.exit(1) }
const cfg = lerConfig()
if (data < dataNoFuso(Date.now(), cfg.fuso)) { console.error(`✘ --data no passado (${data}): use hoje ou uma data futura`); process.exit(1) }
if (diaSemana(data) !== cfg.dia_semana_padrao) console.warn(`⚠ ${data} não cai no dia padrão de envio (sexta-feira)`)
const ok = new Set(cfg.status_elegiveis.map(s => s.toLowerCase()))
const nomes = clientesElegiveis().elegiveis.filter(c => ok.has(String(c.status).trim().toLowerCase())).map(c => c.cliente)
const r = semearProgramacao(db, nomes, { data, aplicar, agora, hoje: () => dataNoFuso(Date.now(), cfg.fuso) })
console.log(`${aplicar ? '✔ gravado' : 'DRY-RUN (nada gravado; use --aplicar)'} — semanal, 1º envio em ${r.data}, sem liberação (ativado_por vazio)`)
console.log(`  clientes elegíveis: ${r.total} · novos: ${r.novos.length} · já programados (intocados): ${r.existentes.length}`)
if (!aplicar && r.novos.length) console.log(`  exemplos: ${r.novos.slice(0, 5).join(' · ')}${r.novos.length > 5 ? ' …' : ''}`)
