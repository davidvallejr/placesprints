// Destinos da base Clientes do Notion — SÓ MERCADO LIVRE (decisão do David, 12/10/2026): WhatsApp = só «Id whatsapp meli», Discord interno = só «Webhook ML»,
// consultor = só «Discord ID Consultor ML»; sem o campo ML = sem destino (nunca Shopee/Amazon/TikTok/Magalu/Legacy); o Discord nunca vira canal do cliente.
import assert from 'node:assert/strict'
import { destinosDeProps, sugerirCanais, buscarDestinos, CANAIS_CENTRAL } from '../src/lib/gatilhos-destinos-notion.js'
const rt = s => ({ type: 'rich_text', rich_text: [{ plain_text: s }] })
const HOOK = 'https://discord.com/api/webhooks/1483835626619932803/' + 'a'.repeat(60)
const props = { Cliente: { type: 'title', title: [{ plain_text: 'Loja X' }] }, 'Id whatsapp meli': rt('120363012345678901@g.us'), 'Id whatsapp shopee': rt('120363099999999999@g.us'), 'Id whatsapp amazon': rt('120363088888888888@g.us'),
  'Webhook ML': { type: 'url', url: HOOK }, 'Webhook SHO': { type: 'url', url: 'https://discord.com/api/webhooks/1483835626619932804/' + 'b'.repeat(60) }, 'Discord ID Consultor ML': rt('<@712345678901234567>'), 'Discord ID Consultor SHO': rt('812345678901234567'),
  Email: { type: 'email', email: 'dono@loja.com' }, 'Telefone do responsável': rt('(13) 99999-0000'), 'Notificar?': { type: 'select', select: { name: 'Sim' } } }
assert.deepEqual(CANAIS_CENTRAL, { whatsapp: 'Id whatsapp meli', discord: 'Webhook ML', consultor: 'Discord ID Consultor ML' })
const d = destinosDeProps(props)
assert.equal(d.whatsapp, '120363012345678901@g.us'); assert.deepEqual(d.interno, { discord: HOOK, consultor: '712345678901234567' }, 'menção <@id> vira o id')
assert.deepEqual(d.invalidos, []); assert.equal(d.email, 'dono@loja.com'); assert.equal(d.notificar, 'Sim')
const s = sugerirCanais(d)
assert.deepEqual(Object.keys(s), ['whatsapp', 'email', 'notion'], 'Discord nunca é canal do cliente'); assert.deepEqual(s.whatsapp, { ligado: false, destino: '120363012345678901@g.us', origem: 'central:ml' }); assert.equal(s.email.destino, 'dono@loja.com'); assert.equal(s.notion.ligado, false)
// sem o campo do Mercado Livre: sem destino — os grupos/webhooks/consultor de Shopee e Amazon nunca entram
const soOutros = destinosDeProps({ ...props, 'Id whatsapp meli': rt(''), 'Webhook ML': { type: 'url', url: null }, 'Discord ID Consultor ML': rt('') })
assert.deepEqual([soOutros.whatsapp, soOutros.interno.discord, soOutros.interno.consultor], ['', '', '']); assert.equal(sugerirCanais(soOutros).whatsapp.destino, '', 'nunca cai para Shopee/Amazon')
const ruins = destinosDeProps({ 'Id whatsapp meli': rt('não tem'), 'Webhook ML': { type: 'url', url: 'https://exemplo.com/x' }, 'Discord ID Consultor ML': rt('Fulano'), Email: { type: 'email', email: 'sem-arroba' } })
// só o GRUPO (…@g.us): número cru ou contato no campo do Notion não vira destino ao cliente (antes caía na regra do '+' e o botão respondia 400 sem gravar o e-mail)
for (const v of ['5513999990000', '5513999990000@s.whatsapp.net']) { const x = destinosDeProps({ ...props, 'Id whatsapp meli': rt(v) }); assert.deepEqual([x.whatsapp, x.invalidos], ['', ['whatsapp']], v); assert.ok(!JSON.stringify(x).includes(v)); assert.equal(sugerirCanais(x).email.destino, 'dono@loja.com') }
assert.deepEqual(ruins.invalidos.sort(), ['consultor', 'discord', 'email', 'whatsapp']); assert.ok(!JSON.stringify(ruins).includes('Fulano') && !JSON.stringify(ruins).includes('exemplo.com'), 'inválido não carrega o valor')
assert.deepEqual(destinosDeProps({}), { whatsapp: '', email: '', interno: { discord: '', consultor: '' }, telefone: '', notificar: '', invalidos: [] })
// buscarDestinos com fetch falso: exato → 1 linha; duas linhas → recusa; 403 → sem permissão; prospect → inválido; sem token → ausente
const fetchDe = resultados => async (u, o) => ({ ok: true, status: 200, json: async () => ({ results: resultados(JSON.parse(o.body).filter.title) }) })
let r = await buscarDestinos('Loja X', { fetch: fetchDe(f => f.equals ? [{ id: 'p1', properties: props }] : []), token: 't' }); assert.equal(r.achado, true); assert.equal(r.pagina_id, 'p1'); assert.equal(r.sugestao.whatsapp.destino, d.whatsapp); assert.ok(!('discord' in r.sugestao))
r = await buscarDestinos('Loja', { fetch: fetchDe(f => f.equals ? [] : [{ id: 'p1', properties: props }, { id: 'p2', properties: props }]), token: 't' }); assert.equal(r.achado, false); assert.equal(r.motivo, 'mais_de_uma_linha_na_central')
r = await buscarDestinos('Loja X', { fetch: async () => ({ ok: false, status: 403 }), token: 't' }); assert.equal(r.motivo, 'notion_sem_permissao')
r = await buscarDestinos('[Comercial] Prospect', { fetch: fetchDe(() => []), token: 't' }); assert.equal(r.motivo, 'cliente_invalido')
r = await buscarDestinos('Loja X', { fetch: fetchDe(() => []), token: '' }); assert.equal(r.motivo, 'notion_token_ausente')
r = await buscarDestinos('Loja X', { fetch: fetchDe(() => []), token: 't' }); assert.equal(r.motivo, 'cliente_nao_esta_na_central')
console.log('teste-gatilhos-destinos: ok (só Mercado Livre: grupo meli, Webhook ML e consultor ML; sugestão desligada; Discord interno nunca é canal do cliente; busca segura)')

// rota POST /api/cliente/notificacao/central: preenche só destinos vazios (WhatsApp ML e e-mail), nunca liga canal, nunca devolve o valor; diz só se o Discord interno existe
{
  const express = (await import('express')).default
  const { criarRotasGatilhos } = await import('../src/rotas-gatilhos.js')
  let salvo = null
  const atual = { liberado_por: '', canais: { whatsapp: { ligado: false, destino: '' }, email: { ligado: true, destino: 'ja@tem.com' }, notion: { ligado: false } }, ritmo: {}, silencio: {}, fuso: 'America/Sao_Paulo', rotulo: 'Loja X Oficial' }
  const gatilhos = { notificacao: () => atual, configurar: b => { salvo = b; return { ok: true } } }
  const app = express(); app.use(express.json()); app.use(criarRotasGatilhos({ gatilhos, clienteCanonico: c => c === 'Loja X' ? c : '', buscarDestinos: async () => ({ achado: true, sugestao: sugerirCanais(d), destinos: d }) }))
  const srv = app.listen(0); const porta = srv.address().port
  const post = async b => { const r = await fetch(`http://127.0.0.1:${porta}/api/cliente/notificacao/central`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); return { s: r.status, j: await r.json() } }
  const r1 = await post({ cliente: 'Loja X', por: 'Fulano' })
  assert.equal(r1.s, 200); assert.deepEqual(r1.j.preenchidos.map(p => p.canal), ['whatsapp']); assert.deepEqual(r1.j.interno, { discord: true, consultor: true })
  assert.ok(!JSON.stringify(r1.j).includes('@g.us') && !JSON.stringify(r1.j).includes('discord.com') && !JSON.stringify(r1.j).includes('712345678901234567'), 'a resposta nunca carrega o destino')
  assert.equal(salvo.notificacao.canais.email.destino, 'ja@tem.com', 'destino existente nunca é sobrescrito'); assert.equal(salvo.notificacao.canais.whatsapp.ligado, false, 'preencher não liga canal')
  assert.ok(!('discord' in salvo.notificacao.canais), 'o Discord interno nunca é gravado como canal do cliente'); assert.equal(salvo.notificacao.rotulo, 'Loja X Oficial', 'o nome na mensagem é preservado')
  assert.equal((await post({ cliente: '[Comercial] X', por: 'F' })).s, 404)
  srv.close()
  console.log('teste-gatilhos-destinos: rota de preenchimento pela central ok')
}
{
  const { listaNomes } = await import('../src/lib/gatilhos.js')
  assert.equal(listaNomes(['Guia X', 'Guia X', 'Guia X', 'Coleira Y']), 'Guia X e Coleira Y', 'nome repetido aparece uma vez')
  assert.equal(listaNomes(['A', 'B', 'C', 'D', 'D']), 'A, B e C e mais 1')
  console.log('teste-gatilhos-destinos: lista de nomes sem repetição ok')
}
