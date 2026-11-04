// Modo «clientes de teste» (config/clientes-teste.json; pedido do David, 04/11/2026). PURO: lê o config, devolve o filtro. Com ativo=false não muda nada.
//  lerClientesTeste(caminho?) → { ativo, clientes: Set(normalizados), lista[] } · filtrarClientesTeste(itens, nomeDe, cfg?) → só os da lista quando ativo
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './env.js'
const normNome = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()   // igual a equipe.normNome (aqui não se importa equipe.js: evita ciclo equipe → descobrir → este)

export const ARQUIVO_CLIENTES_TESTE = join(ROOT, 'config', 'clientes-teste.json')
export function lerClientesTeste(caminho = ARQUIVO_CLIENTES_TESTE) {
  try {
    const j = JSON.parse(readFileSync(caminho, 'utf-8')), lista = Array.isArray(j.clientes) ? j.clientes.map(String).filter(Boolean) : []
    return { ativo: j.ativo === true && lista.length > 0, lista, clientes: new Set(lista.map(n => normNome(n).trim())) }
  } catch { return { ativo: false, lista: [], clientes: new Set() } }
}
export const ehClienteTeste = (nome, cfg = lerClientesTeste()) => cfg.clientes.has(normNome(String(nome || '')).trim())
export const filtrarClientesTeste = (itens, nomeDe = x => x, cfg = lerClientesTeste()) => (cfg.ativo ? itens.filter(x => ehClienteTeste(nomeDe(x), cfg)) : itens)
