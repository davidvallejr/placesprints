// Notificações do sistema (cliente conectou, dados prontos, vínculo com o Mercado Livre caiu, prospect conectou).
// Tudo vira uma linha em `notificacoes`; a tela (web/alerta.js) consulta a cada poucos segundos e avisa com som, faixa e notificação do navegador.
// Nunca guarda token nem dado sensível: só o que o time precisa para agir (quem, o quê, para onde ir).
import { db, agora } from './db.js'
import { sistema as sistemaDe, mapaDeOrigem } from './sistemas.js'

db.exec(`CREATE TABLE IF NOT EXISTS notificacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tipo TEXT NOT NULL, nivel TEXT NOT NULL DEFAULT 'info',   -- info | sucesso | alerta | erro
  titulo TEXT NOT NULL, corpo TEXT NOT NULL DEFAULT '', cliente TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL, lida_em TEXT NOT NULL DEFAULT ''
)`)
db.exec('CREATE INDEX IF NOT EXISTS ix_notificacoes_tipo ON notificacoes (tipo, cliente, criado_em)')
// sistema de origem (config/sistemas.json, 15/10/2026): coluna aditiva; linha antiga fica ''
if (!db.prepare('PRAGMA table_info(notificacoes)').all().some(c => c.name === 'sistema')) db.exec("ALTER TABLE notificacoes ADD COLUMN sistema TEXT NOT NULL DEFAULT ''")

const NIVEIS = new Set(['info', 'sucesso', 'alerta', 'erro'])
const cortar = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n)
// só caminho interno (começa com "/", não "//"): a notificação nunca leva a outro domínio
const linkInterno = l => /^\/(?![\/\\])[^\s\\]*$/.test(String(l || '')) ? String(l).slice(0, 300) : ''

// dedupeMin > 0: não repete a MESMA notificação (tipo + cliente) dentro da janela — evita enxurrada se a renovação falhar de hora em hora
// sistema: id de config/sistemas.json passado pelo chamador; sem ele, a tabela de origem pelo tipo (aviso ao time sem dono conhecido = Morpheus, a comunicação).
// O título ganha o nome do sistema («Trinity · Novo cliente conectado: Acme»); o aviso é só do time, nunca vai ao cliente.
export function notificar({ tipo, nivel = 'info', titulo, corpo = '', cliente = '', link = '', dedupeMin = 0, sistema = '' }) {
  if (!tipo || !titulo) throw new Error('notificação sem tipo ou título')
  const s = sistemaDe(sistema || mapaDeOrigem(tipo) || 'morpheus')
  if (dedupeMin > 0) {
    const desde = new Date(Date.now() - dedupeMin * 60_000).toISOString()
    const igual = db.prepare('SELECT id FROM notificacoes WHERE tipo = ? AND cliente = ? AND criado_em >= ? LIMIT 1').get(tipo, cortar(cliente, 160), desde)
    if (igual) return igual.id
  }
  const r = db.prepare('INSERT INTO notificacoes (tipo, nivel, titulo, corpo, cliente, link, criado_em, sistema) VALUES (?,?,?,?,?,?,?,?)')
    .run(cortar(tipo, 40), NIVEIS.has(nivel) ? nivel : 'info', cortar(`${s.nome} · ${titulo}`, 160), cortar(corpo, 600), cortar(cliente, 160), linkInterno(link), agora(), s.id)
  // poda: o histórico não cresce sem fim
  db.prepare('DELETE FROM notificacoes WHERE id NOT IN (SELECT id FROM notificacoes ORDER BY id DESC LIMIT 500)').run()
  return Number(r.lastInsertRowid)
}
// o que ainda não foi lido por ninguém continua no sino; "desde" traz só o que chegou depois do último visto pela tela
export function listarNotificacoes({ desde = 0, limite = 30 } = {}) {
  const itens = db.prepare('SELECT id, tipo, nivel, titulo, corpo, cliente, link, criado_em, lida_em, sistema FROM notificacoes WHERE id > ? ORDER BY id DESC LIMIT ?').all(Math.max(0, Number(desde) || 0), Math.min(100, Math.max(1, Number(limite) || 30)))
  return {
    itens: itens.reverse(),
    ultimo_id: db.prepare('SELECT COALESCE(MAX(id), 0) m FROM notificacoes').get().m,
    nao_lidas: db.prepare("SELECT COUNT(*) n FROM notificacoes WHERE lida_em = ''").get().n,
  }
}
export function marcarLidas(ids = null) {
  if (Array.isArray(ids) && ids.length) {
    const q = db.prepare("UPDATE notificacoes SET lida_em = ? WHERE id = ? AND lida_em = ''")
    return db.transaction(l => l.reduce((t, id) => t + q.run(agora(), Number(id) || 0).changes, 0))(ids)
  }
  return db.prepare("UPDATE notificacoes SET lida_em = ? WHERE lida_em = ''").run(agora()).changes
}
