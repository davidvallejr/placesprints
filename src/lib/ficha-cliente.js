// Ficha do cliente ligada ao banco real e ao Notion. A regra mora em ficha-nucleo.js (testável sem banco).
import { db } from './db.js'
import { equipeCfg } from './equipe.js'
import { criarFicha } from './ficha-nucleo.js'
export { PAPEIS, CANAIS_FICHA, LINKS, papelDaAcao, criarFicha } from './ficha-nucleo.js'

export const ficha = criarFicha(db, { usuariosOverride: equipeCfg.usuarios_notion || {} })

// ── Notion → prestadores ativos (só os campos necessários: a base tem CPF, salário e conta bancária — nada disso é lido) ──
export async function buscarPrestadoresNotion() {
  const cfg = equipeCfg.analistas_oficiais || {}
  if (!cfg.db) throw new Error('config/equipe.json → analistas_oficiais.db ausente')
  const { notionReq, resolverFontes } = await import('./notion.js')
  const fontes = await resolverFontes(cfg.db)
  const rota = fontes[0].modo === 'data_source' ? `data_sources/${fontes[0].id}` : `databases/${fontes[0].id}`
  const lista = []
  let cursor
  do {
    const r = await notionReq(`${rota}/query`, { method: 'POST', body: { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) } })
    for (const p of r.results) {
      const pr = p.properties || {}
      const nome = (pr.Nome?.title || []).map(t => t.plain_text).join('').trim()
      if (!nome || (pr.Status?.select?.name || '') !== 'Ativo') continue      // o select Status manda (a data de desligamento tem lixo)
      lista.push({ nome, cargo: pr.Cargo?.select?.name || '', area: pr['Área']?.select?.name || '', atuacao: (pr['Atuação Clientes']?.multi_select || []).map(o => o.name).slice(0, 80) })
    }
    cursor = r.has_more ? r.next_cursor : undefined
  } while (cursor)
  return lista
}
export async function sincronizarPrestadores() { return ficha.gravarPrestadores(await buscarPrestadoresNotion()) }
