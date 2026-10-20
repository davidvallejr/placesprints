// Destinos dos avisos lidos da base CLIENTES do Notion (config/fontes.json → clientes_db). SÓ MERCADO LIVRE (decisão do David, 12/10/2026):
//  • ao CLIENTE: WhatsApp = só «Id whatsapp meli» (grupo …@g.us do cliente no ML); e-mail do cadastro;
//  • INTERNO (a equipe — o cliente NÃO está no Discord): canal do cliente no Discord = só «Webhook ML»; consultor = só «Discord ID Consultor ML».
// Sem o campo ML preenchido = sem destino: nunca cai para Shopee, Amazon, TikTok, Magalu ou Legacy.
// Este módulo só LÊ (fetch direto com NOTION_TOKEN; não toca notion.js) e devolve uma SUGESTÃO para clientes_central.notificacao_json (canais do cliente, tudo
// DESLIGADO — quem liga é a equipe na tela). Valores (número, e-mail, URL, id) nunca vão a log nem a erro.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, env } from './env.js'

const fontes = JSON.parse(readFileSync(join(ROOT, 'config', 'fontes.json'), 'utf-8'))
export const CANAIS_CENTRAL = { whatsapp: 'Id whatsapp meli', discord: 'Webhook ML', consultor: 'Discord ID Consultor ML' }
export const RX_DISCORD = /^https:\/\/(?:discord(?:app)?\.com)\/api\/webhooks\/\d{10,25}\/[A-Za-z0-9_-]{30,120}$/
const RX_JID = /^\d{8,25}@g\.us$/     // SÓ o grupo do cliente (…@g.us): número cru ou contato no campo do Notion = inválido (nunca vira destino ao cliente)
const RX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const RX_ID_DISCORD = /^<?@?!?(\d{15,21})>?$/                           // id numérico do usuário, 15–21 dígitos (aceita a menção <@123…>)

const texto = p => p?.type === 'rich_text' ? (p.rich_text || []).map(t => t.plain_text || '').join('').trim()
  : p?.type === 'title' ? (p.title || []).map(t => t.plain_text || '').join('').trim()
  : p?.type === 'url' ? String(p.url || '').trim() : p?.type === 'email' ? String(p.email || '').trim()
  : p?.type === 'select' ? String(p.select?.name || '').trim() : p?.type === 'phone_number' ? String(p.phone_number || '').trim()
  : p?.type === 'number' ? (p.number == null ? '' : String(p.number)) : ''
const jid = v => { const s = String(v || '').replace(/\s+/g, ''); return RX_JID.test(s) ? s : '' }

// puro: propriedades da página do cliente na central → destinos válidos (inválido = '' e contado em `invalidos`, sem o valor)
export function destinosDeProps(props = {}) {
  const invalidos = []
  const w = texto(props[CANAIS_CENTRAL.whatsapp]), whatsapp = w ? jid(w) : ''; if (w && !whatsapp) invalidos.push('whatsapp')
  const d = texto(props[CANAIS_CENTRAL.discord]), discord = d && RX_DISCORD.test(d) ? d : ''; if (d && !discord) invalidos.push('discord')
  const k = texto(props[CANAIS_CENTRAL.consultor]).replace(/\s+/g, ''), consultor = k.match(RX_ID_DISCORD)?.[1] || ''; if (k && !consultor) invalidos.push('consultor')
  const email = texto(props.Email), emailOk = RX_EMAIL.test(email) ? email : ''; if (email && !emailOk) invalidos.push('email')
  return { whatsapp, email: emailOk, interno: { discord, consultor }, telefone: texto(props['Telefone do responsável']), notificar: texto(props['Notificar?']), invalidos }
}

// sugestão para notificacao_json.canais (só canais AO CLIENTE, tudo DESLIGADO); o destino interno (Discord da equipe + consultor) vai à parte e nunca vira canal do cliente
export function sugerirCanais(d) {
  return {
    whatsapp: { ligado: false, destino: d.whatsapp || '', origem: d.whatsapp ? 'central:ml' : '' },
    email: { ligado: false, destino: d.email || '', origem: d.email ? 'central' : '' },
    notion: { ligado: false },
  }
}

// lê a linha do cliente na central (título exato; se 0, contains) — devolve { achado, destinos, sugestao, pagina_id } ou { achado:false, motivo }
export async function buscarDestinos(cliente, { fetch: f = globalThis.fetch, token = env.NOTION_TOKEN, dbId = fontes.clientes_db, versao = '2022-06-28' } = {}) {
  if (!token) return { achado: false, motivo: 'notion_token_ausente' }
  const nome = String(cliente || '').trim(); if (!nome || /^\s*\[Comercial\]/i.test(nome)) return { achado: false, motivo: 'cliente_invalido' }
  const consulta = async filtro => {
    const r = await f(`https://api.notion.com/v1/databases/${dbId}/query`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Notion-Version': versao, 'Content-Type': 'application/json' }, body: JSON.stringify({ filter: { property: 'Cliente', title: filtro }, page_size: 5 }) })
    if (!r.ok) return { erro: r.status }
    return { paginas: (await r.json()).results || [] }
  }
  let r = await consulta({ equals: nome }); if (r.erro) return { achado: false, motivo: r.erro === 401 || r.erro === 403 ? 'notion_sem_permissao' : 'notion_indisponivel' }
  if (!r.paginas.length) { r = await consulta({ contains: nome }); if (r.erro) return { achado: false, motivo: 'notion_indisponivel' } }
  if (!r.paginas.length) return { achado: false, motivo: 'cliente_nao_esta_na_central' }
  if (r.paginas.length > 1) return { achado: false, motivo: 'mais_de_uma_linha_na_central' }   // nunca escolher "a primeira": destino de outro cliente seria vazamento
  const pg = r.paginas[0], destinos = destinosDeProps(pg.properties || {})
  return { achado: true, pagina_id: pg.id, destinos, sugestao: sugerirCanais(destinos) }
}
