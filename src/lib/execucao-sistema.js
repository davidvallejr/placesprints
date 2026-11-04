// Livro de execução do próprio sistema (plano «Neo aprende sobre si», 04/11/2026 — a 1ª habilidade: dado único sobre as rodadas).
// Toda rodada (coleta diária, sync do Notion, medição, boot do processo, suíte de testes, aplicação do Neo) vira UMA linha com duração, ok/total/falhas e versão do código.
// Antes disso nada era gravado: a coleta só deixava o carimbo coleta_ml_em e contagens em texto no sync_log (podado a 5.000 linhas).
//  gravar(handle, linha)                 → insere 1 linha (nunca lança: o livro não derruba quem chamou)
//  criarLivroExecucao({ handle, agora, versao }) → { abrir(sistema, operacao) → { fechar({ ok, total, falhas, detalhe }) }, gravar, resumo(operacao, dias), ultima(operacao, { ok }), contar(operacao, horas), podar(dias) }
//  versaoGit(root)                        → short hash do HEAD ('' quando não há git)
import { execFileSync } from 'node:child_process'

export const SCHEMA_EXECUCAO = `
CREATE TABLE IF NOT EXISTS execucao_sistema (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sistema TEXT NOT NULL,
  operacao TEXT NOT NULL,
  inicio TEXT NOT NULL,
  fim TEXT NOT NULL DEFAULT '',
  ms INTEGER,
  ok INTEGER,
  total INTEGER,
  falhas INTEGER,
  detalhe_json TEXT NOT NULL DEFAULT '{}',
  versao TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_execucao_op ON execucao_sistema (operacao, inicio);
`

export const versaoGit = root => { try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf-8', timeout: 5000 }).trim() } catch { return '' } }

const num = v => (v == null || v === '' ? null : Number(v))
const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.max(0, Math.ceil(p * s.length) - 1)] }   // nearest-rank

export function gravar(handle, { sistema, operacao, inicio, fim = '', ms = null, ok = null, total = null, falhas = null, detalhe = {}, versao = '' }) {
  try {
    const d = JSON.stringify(detalhe ?? {}).slice(0, 4000)   // ponytail: detalhe curto; o que não cabe fica no log
    return handle.prepare('INSERT INTO execucao_sistema (sistema, operacao, inicio, fim, ms, ok, total, falhas, detalhe_json, versao) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(String(sistema), String(operacao), String(inicio), String(fim), num(ms), num(ok), num(total), num(falhas), d, String(versao || '')).lastInsertRowid
  } catch { return null }
}

export function criarLivroExecucao({ handle, agora = () => new Date().toISOString(), versao = '' }) {
  handle.exec(SCHEMA_EXECUCAO)
  const desde = (dias) => new Date(Date.parse(agora()) - dias * 864e5).toISOString()
  function abrir(sistema, operacao, detalheInicial = {}) {
    const inicio = agora()
    let fechado = false
    return {
      inicio,
      fechar({ ok = null, total = null, falhas = null, detalhe = {} } = {}) {
        if (fechado) return null
        fechado = true
        const fim = agora()
        return gravar(handle, { sistema, operacao, inicio, fim, ms: Date.parse(fim) - Date.parse(inicio), ok, total, falhas, detalhe: { ...detalheInicial, ...detalhe }, versao })
      },
    }
  }
  const resumo = (operacao, dias = 7) => {
    const linhas = handle.prepare("SELECT ms, ok, total, falhas, inicio FROM execucao_sistema WHERE operacao = ? AND inicio >= ? AND fim != '' ORDER BY inicio").all(operacao, desde(dias))
    const ms = linhas.map(l => l.ms).filter(Number.isFinite)
    const comTotal = linhas.filter(l => l.total > 0)
    return { n: linhas.length, p50_ms: pct(ms, 0.5), p95_ms: pct(ms, 0.95), ultimo: linhas.at(-1)?.inicio || null,
      taxa_falha: comTotal.length ? comTotal.reduce((s, l) => s + (l.falhas || 0), 0) / comTotal.reduce((s, l) => s + l.total, 0) : null }
  }
  // última linha da operação; { ok: true } = última em que falhas = 0 (ou ok = total) — para «horas desde a última suíte verde»
  const ultima = (operacao, { ok = false } = {}) => handle.prepare(`SELECT * FROM execucao_sistema WHERE operacao = ? ${ok ? 'AND (falhas = 0 OR (ok IS NOT NULL AND ok = total))' : ''} ORDER BY inicio DESC LIMIT 1`).get(operacao) || null
  const contar = (operacao, horas = 24) => handle.prepare('SELECT COUNT(*) n FROM execucao_sistema WHERE operacao = ? AND inicio >= ?').get(operacao, desde(horas / 24)).n
  const podar = (dias = 180) => { try { return handle.prepare('DELETE FROM execucao_sistema WHERE inicio < ?').run(desde(dias)).changes } catch { return 0 } }
  return { abrir, gravar: linha => gravar(handle, { versao, ...linha }), resumo, ultima, contar, podar, versao }
}
