// CLI: node scripts/sync.mjs [--completo] [--cliente "Nome ou trecho"]
// Incremental por padrão (só o que mudou desde a última execução).
// --completo revarre tudo — use como rotina agendada de segurança (ex.: 1x/dia).
import { sincronizar } from '../src/lib/sync.js'

const completo = process.argv.includes('--completo')
const iCli = process.argv.indexOf('--cliente')
const cliente = iCli > -1 ? process.argv[iCli + 1] : undefined
try {
  const r = await sincronizar({ completo, cliente })
  if (r.erros.length) {
    console.error('\nFontes com falha (relatório segue com as demais):')
    r.erros.forEach(e => console.error('  - ' + e))
    process.exitCode = 2
  }
} catch (e) {
  console.error('Sync falhou:', e.message)
  process.exitCode = 1
}
