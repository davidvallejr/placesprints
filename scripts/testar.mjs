// Runner da suíte («Neo aprende sobre si», habilidade Quality Platform): roda todos os scripts/teste-*.mjs, 1 linha por teste, e grava o resultado
// no livro de execução (execucao_sistema, operacao 'testes') — é o que a Saúde do sistema lê em «arquiteto.testes» (horas desde a última suíte verde).
//  node scripts/testar.mjs                → roda tudo como à mão (cada teste decide se usa banco em memória) e grava o resultado no banco real
//  node scripts/testar.mjs --sem-banco    → não grava e PULA os testes de config/testes.json → precisam_dados (CI do GitHub, sem dados)
//  node scripts/testar.mjs --memoria      → força PS_DB_MEMORIA=1 em todos (nunca abre data/db.sqlite nos filhos)
// config/testes.json → conhecidos_vermelhos: quebrados antes do runner, contam à parte (não derrubam a saída) até serem consertados e removidos da lista.
//  node scripts/testar.mjs --so <trecho>  → só os testes cujo nome contém o trecho
//  node scripts/testar.mjs --dir <pasta>  → outra pasta de testes (autoteste do runner)
// Sai com código 1 se algum teste falhou. Instável = falhou na rodada anterior gravada e passou agora (ou vice-versa) na MESMA versão do código.
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join, basename } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const args = process.argv.slice(2)
const flag = n => args.includes(n)
const val = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
const DIR = val('--dir') || join(ROOT, 'scripts')
const SO = val('--so')
const TIMEOUT_MS = Number(process.env.PS_TESTE_TIMEOUT_MS) || 120_000

let CFG = { precisam_dados: [], conhecidos_vermelhos: [] }
try { CFG = { ...CFG, ...JSON.parse(readFileSync(join(ROOT, 'config', 'testes.json'), 'utf-8')) } } catch { /* sem config: tudo roda, nada é conhecido */ }
const precisamDados = new Set(flag('--sem-banco') ? CFG.precisam_dados : []), conhecidos = new Map(CFG.conhecidos_vermelhos.map(c => [c.nome, c]))
const todos = readdirSync(DIR).filter(f => /^teste-.*\.mjs$/.test(f) && (!SO || f.includes(SO))).sort()
const pulados = todos.filter(f => precisamDados.has(basename(f, '.mjs'))), arquivos = todos.filter(f => !precisamDados.has(basename(f, '.mjs')))
for (const f of pulados) console.log(`· ${basename(f, '.mjs')} pulado (precisa de dados reais; roda à mão)`)
const inicio = new Date().toISOString(), t0 = Date.now()
const falhas = [], tempos = {}
for (const f of arquivos) {
  const t = Date.now()
  const r = spawnSync(process.execPath, [join(DIR, f)], { cwd: ROOT, env: flag('--memoria') ? { ...process.env, PS_DB_MEMORIA: '1' } : process.env, encoding: 'utf-8', timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 })
  const ms = Date.now() - t, nome = basename(f, '.mjs')
  tempos[nome] = ms
  const ok = r.status === 0 && !r.error
  if (!ok) {
    const motivo = r.error?.code === 'ETIMEDOUT' ? `timeout ${TIMEOUT_MS} ms` : `código ${r.status}`
    const cauda = String(r.stderr || r.stdout || '').trim().split('\n').slice(-6).join('\n')
    falhas.push({ nome, motivo, cauda: cauda.slice(0, 800), conhecido: conhecidos.has(nome) })
  }
  console.log(`${ok ? '✓' : conhecidos.has(nome) ? '○' : '✗'} ${nome} (${ms} ms)${ok ? '' : ' — ' + falhas.at(-1).motivo + (conhecidos.has(nome) ? ' (vermelho conhecido desde ' + conhecidos.get(nome).desde + ')' : '')}`)
}
const novas = falhas.filter(f => !f.conhecido), velhas = falhas.filter(f => f.conhecido)
const total = arquivos.length, okN = total - falhas.length, msTotal = Date.now() - t0
for (const f of novas) console.log(`\n── ${f.nome}: ${f.motivo}\n${f.cauda}`)
console.log(`\n${okN}/${total} ok em ${(msTotal / 1000).toFixed(1)} s${pulados.length ? ` · ${pulados.length} pulado(s)` : ''}${velhas.length ? ` · ${velhas.length} vermelho(s) conhecido(s): ${velhas.map(f => f.nome).join(', ')}` : ''}${novas.length ? ` — FALHOU: ${novas.map(f => f.nome).join(', ')}` : ''}`)

if (!flag('--sem-banco')) {
  try {
    const { db, agora } = await import('../src/lib/db.js')
    const { criarLivroExecucao, versaoGit } = await import('../src/lib/execucao-sistema.js')
    const livro = criarLivroExecucao({ handle: db, agora, versao: versaoGit(ROOT) })
    // instáveis: mesma versão, resultado diferente da rodada anterior (só quando há rodada anterior gravada na mesma versão)
    const anterior = livro.ultima('testes')
    let instaveis = []
    if (anterior && anterior.versao === livro.versao) {
      const antes = new Set((JSON.parse(anterior.detalhe_json || '{}').falhas || []).map(f => f.nome)), agoraF = new Set(novas.map(f => f.nome))
      instaveis = [...new Set([...antes, ...agoraF])].filter(n => antes.has(n) !== agoraF.has(n))
    }
    const lentos = Object.entries(tempos).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, ms]) => ({ nome: n, ms }))
    // falhas = só as NOVAS (verde = 0 novas); as conhecidas vão no detalhe para o relatório de si
    livro.gravar({ sistema: 'arquiteto', operacao: 'testes', inicio, fim: agora(), ms: msTotal, ok: okN, total, falhas: novas.length, detalhe: { falhas: novas.map(f => ({ nome: f.nome, motivo: f.motivo })), conhecidos: velhas.map(f => f.nome), pulados: pulados.map(f => basename(f, '.mjs')), instaveis, lentos } })
    if (instaveis.length) console.log(`instáveis (mesma versão ${livro.versao}): ${instaveis.join(', ')}`)
  } catch (e) { console.log(`(resultado não gravado no banco: ${String(e?.message).slice(0, 120)})`) }
}
process.exit(novas.length ? 1 : 0)
