// Identidade Place2u nos relatórios.
// A logo oficial deve ficar em assets/logo.png (ou .jpg/.webp) — se existir,
// prevalece; senão usa a recriação vetorial assets/logo.svg.
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './env.js'

const CANDIDATAS = [
  ['logo.png', 'image/png'], ['logo.jpg', 'image/jpeg'], ['logo.jpeg', 'image/jpeg'],
  ['logo.webp', 'image/webp'], ['logo.svg', 'image/svg+xml'],
]

export function logoDataUri() {
  for (const [nome, mime] of CANDIDATAS) {
    const p = join(ROOT, 'assets', nome)
    if (existsSync(p)) return `data:${mime};base64,${readFileSync(p).toString('base64')}`
  }
  return null
}

export const MARCA = {
  nome: 'Place2u',
  territorio: 'Performance Estratégica em Marketplaces',
  tagline: 'Eles cuidam da sua conta. A Place2u constrói a sua empresa.',
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
export const rotuloMes = anoMes => {
  const [a, m] = String(anoMes).split('-')
  return m ? `${MESES[Number(m) - 1]}/${a}` : anoMes
}
