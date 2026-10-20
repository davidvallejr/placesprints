// Armazenamento frio dos anexos (docs/plano-autogestao.md A4; D-A1: pasta do Google Drive da Place2u, .env FRIO_DIR).
// evidencias.arquivo_local = 'frio:<sha256><.ext>' depois que scripts/arquivar-evidencias.mjs copiou, conferiu o hash no destino e removeu do Mac.
// resolverArquivo(arquivo_local) → caminho absoluto legível ou null (local dentro de data/, ou frio dentro de FRIO_DIR) — usado pelo dossiê e pelos relatórios.
import { existsSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { ROOT } from './env.js'   // carrega o .env (FRIO_DIR)

export const PREFIXO_FRIO = 'frio:'
const NOME_FRIO = /^[0-9a-f]{64}(\.[A-Za-z0-9]{1,8})?$/
export const ehFrio = a => String(a || '').startsWith(PREFIXO_FRIO)
export const nomeFrio = a => { const n = String(a || '').slice(PREFIXO_FRIO.length); return NOME_FRIO.test(n) ? n : '' }
export const dirFrio = (env = process.env) => String(env.FRIO_DIR || '').trim()

export function resolverArquivo(arquivoLocal, { raizDados = join(ROOT, 'data'), env = process.env } = {}) {
  const a = String(arquivoLocal || '')
  if (!a) return null
  if (ehFrio(a)) {
    const n = nomeFrio(a), d = dirFrio(env)
    if (!n || !d) return null                                      // FRIO_DIR fora do ar/configuração: o chamador mostra «anexo em armazenamento frio»
    const abs = join(resolve(d), n)
    return existsSync(abs) ? abs : null
  }
  const base = resolve(raizDados), abs = resolve(base, a)
  return abs.startsWith(base + sep) && existsSync(abs) ? abs : null
}
