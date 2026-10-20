// Plano de ação por cliente via terminal. Exemplos:
//   node scripts/plano-cliente.mjs --escopo total --gerar
//   node scripts/plano-cliente.mjs --escopo consultor --consultor "Giovanna Torres" --distribuir            (pré-visualização)
//   node scripts/plano-cliente.mjs --escopo selecao --cliente "Eleven Brindes" --distribuir --confirmar      (cria no Notion)
// Sem --confirmar a distribuição NUNCA escreve no Notion.
import { resolverEscopo, sincronizarEquipe } from '../src/lib/equipe.js'
import { gerarPlanosEscopo, acoesDoEscopo, playbook } from '../src/lib/plano-cliente.js'
import { distribuir } from '../src/lib/distribuir-notion.js'

const a = process.argv.slice(2), val = k => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : '' }
const tem = k => a.includes(k)
const clientes = a.flatMap((x, i) => x === '--cliente' ? [a[i + 1]] : [])
const scoreMin = Number(val('--score-min') || 11)
const escopo = resolverEscopo({ tipo: val('--escopo') || 'total', consultor: val('--consultor'), squad: val('--squad'), clientes })
if (escopo.erro) { console.error('Escopo inválido:', escopo.erro); process.exit(1) }
if (tem('--sincronizar-equipe')) console.log(`equipe: ${await sincronizarEquipe()} clientes lidos da central`)
console.log(`Escopo ${escopo.tipo}: ${escopo.clientes.length} cliente(s)`)
const progresso = ({ feitos, total, cliente }) => process.stdout.write(`\r  ${feitos}/${total} ${cliente}`.padEnd(70))
if (tem('--gerar')) {
  const r = await gerarPlanosEscopo(escopo, { aoProgredir: progresso })
  console.log(`\nPlanos: ${r.length} · ações novas ${r.reduce((s, x) => s + x.novas, 0)} · mantidas ${r.reduce((s, x) => s + x.mantidas, 0)}`)
}
if (tem('--distribuir')) {
  const cap = playbook.max_acoes_distribuir_por_cliente || 5, porCliente = {}
  const acoes = acoesDoEscopo(escopo).filter(x => x.score >= scoreMin)
    .filter(x => (porCliente[x.cliente] = (porCliente[x.cliente] || 0) + 1) <= cap)   // playbook §12: máx. 5 tarefas/cliente
  const real = tem('--confirmar')
  console.log(`${real ? 'CRIANDO NO NOTION' : 'Pré-visualização (nada é criado)'}: ${acoes.length} ação(ões) com prioridade ≥ ${scoreMin}`)
  const r = await distribuir(acoes, { dryRun: !real, aoProgredir: progresso })
  console.log(`\n${real ? 'criadas' : 'a criar'}: ${(real ? r.criadas : r.a_criar).length} · já existiam: ${r.ja_existiam.length} · sem usuário Notion: ${r.sem_usuario_notion} · erros: ${r.erros.length}`)
  r.erros.slice(0, 10).forEach(e => console.log('  erro', e.cliente, e.id || '', e.erro))
}
