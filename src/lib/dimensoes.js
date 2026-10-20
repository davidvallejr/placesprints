// Dimensões de recorte do resultado: NICHO (texto livre da central → mapa curado em config/nichos.json) e REGIÃO (UF do vendedor no ML).
// Nunca deduz: sem nicho → SEM_NICHO; sem UF → SEM_UF (a UF vem só do address.state do /users do ML, nunca do CNPJ).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { db } from './db.js'
import { ROOT } from './env.js'
import { normNome } from './equipe.js'

export const SEM_NICHO = 'Sem nicho registrado'
export const SEM_UF = 'Sem UF registrada'

const cfgNichos = JSON.parse(readFileSync(join(ROOT, 'config', 'nichos.json'), 'utf-8'))
const SEM = new Set(cfgNichos.sem_nicho.map(normNome))
const MAPA = new Map(Object.entries(cfgNichos.nichos).flatMap(([canon, grafias]) => [canon, ...grafias].map(g => [normNome(g), canon])))
// ponytail: grafia fora do mapa fica com o próprio nome (só espaço aparado) — variação de caixa de nicho não curado vira grupo à parte; curar em config/nichos.json
export function normalizarNicho(cru) {
  const k = normNome(cru)
  if (SEM.has(k)) return SEM_NICHO
  return MAPA.get(k) || String(cru).trim().replace(/\s+/g, ' ')
}
export const nichoDe = cliente => normalizarNicho(db.prepare('SELECT nicho FROM clientes_central WHERE cliente = ?').get(cliente)?.nicho)

const REGIOES = { Norte: 'AC AP AM PA RO RR TO', Nordeste: 'AL BA CE MA PB PE PI RN SE', 'Centro-Oeste': 'DF GO MT MS', Sudeste: 'ES MG RJ SP', Sul: 'PR RS SC' }
const REGIAO = new Map(Object.entries(REGIOES).flatMap(([r, ufs]) => ufs.split(' ').map(uf => [uf, r])))
export const UFS = [...REGIAO.keys()]
export const regiaoDe = uf => REGIAO.get(String(uf || '').trim().toUpperCase()) || SEM_UF
// address.state do /users do ML ("BR-SP") → "SP"; qualquer outra coisa → '' (fica "Sem UF registrada")
export function ufDoPerfil(perfil) {
  const m = /^(?:BR-)?([A-Za-z]{2})$/.exec(String(perfil?.address?.state || '').trim())
  const uf = m ? m[1].toUpperCase() : ''
  return REGIAO.has(uf) ? uf : ''
}
export const ufDe = cliente => db.prepare('SELECT uf FROM meli_contas WHERE cliente = ?').get(cliente)?.uf || SEM_UF
