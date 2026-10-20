// Autoteste do aviso INTERNO ao consultor no Discord (src/lib/consultor-discord.js + gatilhos-envio.enviarInterno + rota de recibo): banco EM MEMÓRIA, fontes stub,
// fetch stub, relógio falso em São Paulo com o PROCESSO em outro fuso. Nada sai de verdade.
// Cobre: seções ✅ 🔁 🔔 📲 com dados sintéticos; menção só com id numérico de 15–21 dígitos; partes ≤ 1900 na ordem; idempotência semanal (cliente + semana ISO);
// só Mercado Livre («Webhook ML»; Shopee nunca); chave desligada não envia; o time recebe independente da liberação do cliente; urgente com cooldown de 7 dias por assunto;
// fim de promoção aparece SÓ aqui (nunca no plano ao cliente); «sem resultado mensurável não quer dizer inútil»; recibo pela rota dos gatilhos; n8n sem config = pendente.
// Decisões finais (12/10/2026), com a configuração REAL: terça 08:30; nada antes de 2026-10-20; destinatários = todo cliente Ativo com integração ML de fato e «Webhook ML»
// (independe da liberação/WhatsApp do cliente; exclusão por sync_estado.consultor_excluidos); os 3 cargos de config/discord-time.json sempre marcados + o consultor quando válido;
// urgente interno desligado por config (o teste do urgente liga só nele).
// Rodar: node scripts/teste-consultor-discord.mjs
process.env.PS_DB_MEMORIA = '1'
process.env.TZ = 'Pacific/Auckland'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import express from 'express'
import { criarConsultorDiscord, secoesConsultor, montarResumoConsultor, dividirDiscord, mencaoDe, semMarcacao, situacaoFamilia, urgentesConsultor, validarCfgConsultor, mencoesTime, validarTime, lerTime, comMencoes, RESERVA_MENCAO } from '../src/lib/consultor-discord.js'
import { criarGatilhos, lerConfig } from '../src/lib/gatilhos.js'
import { criarEnvio, verificarAssinatura } from '../src/lib/gatilhos-envio.js'
import { destinosDeProps } from '../src/lib/gatilhos-destinos-notion.js'
import { criarRotasGatilhosHmac, criarRotasConsultor } from '../src/rotas-gatilhos.js'

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const CFG = lerConfig(), K = CFG.consultor, POR = 'Carla Souza', validarPor = v => v === POR ? POR : ''
const SECRET = 'segredo-de-teste-nunca-impresso-32c'
const HOOK_ML = 'https://discord.com/api/webhooks/1483835626619932803/' + 'a'.repeat(60), HOOK_SHO = 'https://discord.com/api/webhooks/1483835626619932804/' + 'b'.repeat(60)
const rt = s => ({ type: 'rich_text', rich_text: [{ plain_text: s }] })
const CARGOS = ['1517119651522547774', '799352939873173575', '1356270093516013569']          // config/discord-time.json (Head de canais, Consultor Especialista Marketplace, Supervisão)
const PREFIXO = CARGOS.map(id => `<@&${id}>`).join(' ')
const cfgUrgente = () => { const c = JSON.parse(JSON.stringify(CFG)); c.consultor.urgente_ligado = true; return c }
const relogio = (hoje, hora) => { const r = {}; r.ir = (h, hr) => { r.ms = Date.parse(`${h}T${hr}:00-03:00`) }; r.ir(hoje, hora); r.agora = () => new Date(r.ms).toISOString(); return r }

// dados sintéticos de um cliente (hoje = 19/10/2026): uma entrega que vendeu, medidas recentes e antigas, famílias da base, abertas em curva C, alinhamento vencido
const HOJE = '2026-10-19'
const dadosSinteticos = () => ({
  medidas: [
    { tarefa: 'Otimizar título da Ração · PS-abc1234', tipo: 'Otimizar Anúncios', analista: 'Ana Lima', data: '2026-10-01', estado: 'melhorou', efeito_pct: 32.4, itens: ['MLB1'], confianca: { score: 44, classe: 'hipótese possível' }, receita: 820, aprende: true },
    { tarefa: 'Preço da coleira', tipo: 'Precificação', analista: 'Bruno Reis', data: '2026-10-05', estado: 'melhorou', efeito_pct: 50, itens: ['MLB2'], confianca: { score: 59, classe: 'hipótese possível' }, receita: 900, aprende: false },   // confundida: fora
    { tarefa: 'Melhoria antiga', tipo: 'Otimizar Anúncios', analista: 'Ana Lima', data: '2026-07-01', estado: 'melhorou', efeito_pct: 20, itens: ['MLB9'], confianca: { score: 70, classe: 'causa provável' }, receita: 300, aprende: true },   // fora dos 45 dias
    { tarefa: 'Novas imagens do shampoo', tipo: 'Criar Novas Imagens', analista: 'Bruno Reis', data: '2026-09-20', estado: 'sem_efeito', efeito_pct: 1.2, itens: ['MLB3'], aprende: true },
    { tarefa: 'Ajuste de Ads da cama', tipo: 'Ajuste ADS', analista: 'Bruno Reis', data: '2026-09-25', estado: 'piorou', efeito_pct: -18.5, itens: ['MLB5'], aprende: true },
    { tarefa: 'Otimizar areia 1', tipo: 'Otimizar Anúncios', analista: 'Ana Lima', data: '2026-08-01', estado: 'sem_efeito', efeito_pct: 0.5, itens: ['MLB6'], aprende: true },
    { tarefa: 'Otimizar areia 2', tipo: 'Otimizar Anuncios', analista: 'Ana Lima', data: '2026-08-20', estado: 'sem_efeito', efeito_pct: -1, itens: ['MLB6'], aprende: true },
  ],
  entregas: [{ titulo: 'Kit Coleira + Guia Premium', dia: '2026-09-10', criado: true, semVendaAntes: false, aumento: false, pre: 0, pos: 30, unidades: 41, receita: 2350, tarefa: 'Criar kit coleira e guia', analista: 'Gabriela Rezende' }],
  tarefasAbertas: [
    { titulo: 'Otimizar título da areia', tipo: 'Otimizar Anúncios', itens: ['MLB6'] },
    { titulo: 'Clips no brinquedo', tipo: 'Adicionar Clips', itens: ['MLB4'] },
    { titulo: 'Ajuste de lance', tipo: 'Ajuste ADS', itens: [] },
  ],
  itensDiag: [{ id: 'MLB1', titulo: 'Ração Premium 15kg', curva: 'A', u: 112 }, { id: 'MLB4', titulo: 'Brinquedo mordedor', curva: 'C', u: 0 }, { id: 'MLB6', titulo: 'Areia para gatos 4kg', curva: 'B', u: 40 }],
  titulos: { MLB6: 'Areia para gatos 4kg', MLB4: 'Brinquedo mordedor' },
  familias: [
    { id: 'otimizar', nome: 'Otimizar anúncios', n: 51, melhorou: 4, taxa_alto: 0.18 },          // candidata à aposentadoria (n ≥ 10, Wilson < 25%)
    { id: 'ads', nome: 'Ads', n: 9, melhorou: 0, taxa_alto: 0.3 },                                   // nenhuma melhora (n ≥ 5)
    { id: 'imagens', nome: 'Imagens', n: 3, melhorou: 0, taxa_alto: 0.6 },                            // amostra pequena: não é padrão
  ],
  alinhamentosVencidos: [{ rotulo: 'Pausa de produção', escopo: 'anuncio', chave: 'MLB4', revisar_em: '2026-10-10' }],
})
const INTERNOS = [{ tipo: 'promocao_encerrada', rotulo: 'Promoção terminou e o preço voltou ao cheio', texto: 'Promoção terminou e o preço voltou ao cheio em 3 anúncio(s) — avaliar renovar: Guia unificada U1, Guia unificada U2 e Guia unificada U3.', motivo: 'assessoria' },
  { tipo: 'preco_alterado_drastico', rotulo: 'Preço alterado', texto: 'O preço de Coleira mudou de R$ 50,00 para R$ 80,00 (+60%) em 11/10, fora das ações da Place2u.', motivo: 'origem_nao_verificada' }]
const PLANO_TXT = 'Oie, tudo bem? 👋\n\n*Plano para manter o ritmo de vendas · Acme · 12/10*\n\n🎯 *O plano da semana*\n\n*1.* 📦 *Abastecer o Full para os campeões de venda não pararem*\nx\n\n*2.* 📊 *Compartilhar a planilha de custos para darmos o próximo passo*\ny\n*Merovíngio · Place Sprints | Equipe Place2u*'
const URG_TXT = 'Oi, time Acme! Passando rapidinho com um ponto importante da sua conta no Mercado Livre:\n\n🚚 *Pedido com despacho vencido*\n2 pedido(s).\n\n*Merovíngio · Place Sprints | Equipe Place2u*'
const LOTES = [{ tipo: 'imediato', dia: '2026-10-15', estado: 'pendente', motivo: 'n8n_nao_configurado', canais: ['whatsapp'], texto_final: URG_TXT, criado_em: '2026-10-15T13:00:00Z' },
  { tipo: 'semanal', dia: '2026-10-12', estado: 'entregue', motivo: '', canais: ['whatsapp'], texto_final: PLANO_TXT, criado_em: '2026-10-12T12:00:00Z' },
  { tipo: 'semanal', dia: '2026-10-05', estado: 'entregue', motivo: '', canais: ['whatsapp'], texto_final: PLANO_TXT, criado_em: '2026-10-05T12:00:00Z' }]

await ok('seções ✅ 🔁 🔔 📲 com dados sintéticos: entrega com tarefa e analista, melhora com confiança honesta, sem efeito sem culpa, família fraca com tarefa aberta, repetida, curva C, assessoria, alinhamento vencido, o que o cliente leu', () => {
  const s = secoesConsultor({ hoje: HOJE, d: dadosSinteticos(), internos: INTERNOS, lotes: LOTES, cfg: K }), t = montarResumoConsultor({ cliente: 'Acme', hoje: HOJE, s, cfg: K })
  const secao = (de, ate) => t.slice(t.indexOf(de), ate ? t.indexOf(ate) : undefined)
  const a = secao('✅', '🔁'), b = secao('🔁', '🔔'), c = secao('🔔', '📲'), d = secao('📲')
  assert.match(t, /^\*\*Resumo semanal da conta · Acme · 19\/10\*\*\n_Interno da equipe \(o cliente não vê este canal\)/)
  // (a)
  assert.match(a, /• Anúncio Kit Coleira \+ Guia Premium \(criado pela equipe\) em 10\/09: desde então 41 un \(R\$ 2\.350\) — tarefa «Criar kit coleira e guia» · Gabriela Rezende/)
  assert.match(a, /• «Otimizar título da Ração» \(Ana Lima, 01\/10\): \+32,4% nas vendas contra o controle, ~R\$ 820 associados · hipótese possível 44\/100/, 'confiança com o rótulo honesto; sufixo PS- fora')
  assert.doesNotMatch(a, /Preço da coleira|Melhoria antiga/, 'confundida pelo preço e fora da janela de 45 dias não entram')
  assert.match(a, /não é prova de causa/)
  // (b)
  assert.match(b, /Sem resultado mensurável não quer dizer inútil/i)
  assert.match(b, /• «Novas imagens do shampoo» em 20\/09: sem efeito medido/); assert.match(b, /• «Ajuste de Ads da cama» em 25\/09: −?-18,5% nas vendas contra o controle/)
  assert.match(b, /• Família «Otimizar anúncios»: 4 de 51 tarefas medidas melhoraram na base \(candidata à aposentadoria\); 1 aberta\(s\) neste cliente/)
  assert.match(b, /• Família «Ads»: 0 de 9 tarefas medidas melhoraram na base \(nenhuma melhora\); 1 aberta\(s\) neste cliente/)
  assert.doesNotMatch(b, /Imagens/, 'amostra pequena (n = 3) não vira padrão')
  assert.match(b, /• Anúncio Areia para gatos 4kg: 2 tarefas de «Otimizar anúncios» sem resultado medido desde 01\/08/)
  assert.match(b, /• «Clips no brinquedo» \(aberta\) em anúncio curva C sem venda nos últimos 28 dias: Brinquedo mordedor/)
  assert.doesNotMatch(b, /Ana Lima|Bruno Reis|Gabriela/, 'a seção 🔁 nunca cita analista (sem culpa)')
  // (c)
  assert.match(c, /• \*\*Smith · Promoção terminou e o preço voltou ao cheio\*\*: Promoção terminou e o preço voltou ao cheio em 3 anúncio\(s\) — avaliar renovar/)
  assert.match(c, /Preço alterado\*\*: .*_\(origem do preço não verificada: confira antes de falar com o cliente\)_/)
  assert.match(c, /• Alinhamento vencido: Pausa de produção \(anúncio Brinquedo mordedor\), revisar desde 10\/10/)
  // (d): o último urgente e o último plano, com o estado e as ações que o cliente leu
  assert.match(d, /• Urgente de 15\/10 · não saiu \(n8n não configurado\) · whatsapp: 🚚 Pedido com despacho vencido/)
  assert.match(d, /• Plano da semana de 12\/10 · entregue · whatsapp: 📦 Abastecer o Full para os campeões de venda não pararem; 📊 Compartilhar a planilha de custos para darmos o próximo passo/)
  assert.doesNotMatch(d, /05\/10/, 'só o último plano'); assert.equal(d.trim().split('\n').length - 1, 2, '1 a 3 linhas')
  // vazio honesto: sem leitura das medidas não é «zero»
  const v = montarResumoConsultor({ cliente: 'Acme', hoje: HOJE, s: secoesConsultor({ hoje: HOJE, d: {}, cfg: K }), cfg: K })
  assert.match(v, /✅ \*\*Merovíngio — o que rendeu\*\*\n• Sem leitura das medidas nesta semana \(não quer dizer zero\)\./); assert.match(v, /• Nenhum ponto da assessoria aberto\./); assert.match(v, /• Nada foi enviado ao cliente até agora\./)
  assert.equal(situacaoFamilia({ n: 10, melhorou: 1, taxa_alto: 0.24 }), 'candidata à aposentadoria'); assert.equal(situacaoFamilia({ n: 4, melhorou: 0, taxa_alto: 0.5 }), '')
})

await ok('menção só com id numérico de 15–21 dígitos; @everyone/@here e «<@» vindos de título nunca marcam; partes ≤ 1900 em quebras de linha, na ordem', () => {
  assert.equal(mencaoDe('712345678901234567'), '<@712345678901234567>'); assert.equal(mencaoDe('123456789012345'), '<@123456789012345>'); assert.equal(mencaoDe('123456789012345678901'), '<@123456789012345678901>')
  for (const x of ['', '12345678901234', '1234567890123456789012', '<@712345678901234567>', 'Fulano', null, '7123456789012345a7']) assert.equal(mencaoDe(x), '', String(x))
  assert.equal(semMarcacao('Kit @everyone <@123> @here'), 'Kit @​everyone <​@123> @​here')
  const linhas = Array.from({ length: 300 }, (_, i) => `• linha ${String(i).padStart(3, '0')} ${'x'.repeat(i % 40)}`), texto = linhas.join('\n')
  const p = dividirDiscord(texto, 1900)
  assert.ok(p.length >= 3); assert.ok(p.every(x => x.length <= 1900)); assert.equal(p.join('\n'), texto, 'nenhuma linha perdida nem fora de ordem; corte só em quebra de linha')
  const longa = dividirDiscord('a\n' + 'b'.repeat(4000) + '\nc', 1900); assert.ok(longa.every(x => x.length <= 1900)); assert.equal(longa.join('').replace(/\n/g, ''), 'a' + 'b'.repeat(4000) + 'c')
  assert.throws(() => validarCfgConsultor({ ...K, discord_max_chars: 2000 }), /discord_max_chars/); assert.throws(() => validarCfgConsultor({ ...K, hora: '21:00' }), /antes/); assert.equal(validarCfgConsultor(K), K)
  assert.throws(() => validarCfgConsultor({ ...K, urgente_ligado: 'não' }), /urgente_ligado/)
})

await ok('menções (regra do David): os 3 cargos de config/discord-time.json SEMPRE, o consultor só com id válido; ids só numéricos de 15–21 dígitos; prefixo no topo da 1ª parte; id de cargo fora do formato derruba a carga', () => {
  const T = lerTime(); assert.deepEqual(T.cargos, CARGOS); assert.equal(T.marcar_consultor, true)
  assert.deepEqual(mencoesTime(T, '712345678901234567'), { roles: CARGOS, users: ['712345678901234567'], prefixo: `${PREFIXO} <@712345678901234567>` })
  for (const x of ['', 'Fulano', '12345678901234', '1234567890123456789012', '<@712345678901234567>', null, undefined]) assert.deepEqual(mencoesTime(T, x), { roles: CARGOS, users: [], prefixo: PREFIXO }, 'sem consultor válido: só os cargos — ' + String(x))
  assert.deepEqual(mencoesTime({ ...T, marcar_consultor: false }, '712345678901234567').users, [], 'marcar_consultor_do_cliente: false')
  for (const ruim of [{ mencoes_obrigatorias: [] }, { mencoes_obrigatorias: [{ id: '123' }] }, { mencoes_obrigatorias: [{ id: '<@&1517119651522547774>' }] }, {}]) assert.throws(() => validarTime(ruim), /discord-time/)
  assert.deepEqual(comMencoes(['a', 'b'], `${PREFIXO} <@712345678901234567>`), [`${PREFIXO} <@712345678901234567>\na`, 'b']); assert.deepEqual(comMencoes(['a'], ''), ['a'])
  assert.ok(RESERVA_MENCAO >= `${PREFIXO} <@123456789012345678901>\n`.length, 'a folga das partes cabe os 3 cargos + o consultor com ids de 21 dígitos')
  // título de produto/tarefa com «<@&…>» nunca marca cargo (só o prefixo legítimo marca)
  assert.equal(semMarcacao('Kit <@&1517119651522547774>'), 'Kit <​@&1517119651522547774>')
})

// mundo: central com 3 clientes (Acme liberado, Beta liberado sem id do consultor, Gama não liberado), gatilhos reais em memória, consultor com envio stub
function mundo({ props = {}, envioReal = null, cfg = CFG, integ = {} } = {}) {
  const h = new Database(':memory:')
  h.exec("CREATE TABLE clientes_central (cliente TEXT PRIMARY KEY, status_cs TEXT NOT NULL DEFAULT 'Ativo', notificacao_json TEXT NOT NULL DEFAULT '{}')")
  const lib = JSON.stringify({ canais: { whatsapp: { ligado: true, destino: '120363012345678901@g.us' } }, liberado_por: POR, liberado_em: '2026-10-10T12:00:00Z' })
  for (const [c, j] of [['Acme', lib], ['Beta', lib], ['Gama', '{}']]) h.prepare('INSERT INTO clientes_central (cliente, notificacao_json) VALUES (?,?)').run(c, j)
  const rl = relogio('2026-10-20', '08:40')
  const g = criarGatilhos({ handle: h, fontes: {}, agora: rl.agora, cfg, validarPor, elegiveis: () => ['Acme', 'Beta', 'Gama'].map(c => ({ cliente: c, status: 'Ativo' })), clienteCanonico: c => ['Acme', 'Beta', 'Gama'].includes(c) ? c : '',
    integracao: c => integ[c] || { ok: true, motivo: '' } })
  // destino como a fonte real: a linha da base Clientes do Notion passa por destinosDeProps (SÓ os campos do Mercado Livre)
  const central = { Acme: { 'Webhook ML': { type: 'url', url: HOOK_ML }, 'Discord ID Consultor ML': rt('<@712345678901234567>'), 'Webhook SHO': { type: 'url', url: HOOK_SHO } },
    Beta: { 'Webhook ML': { type: 'url', url: HOOK_ML }, 'Discord ID Consultor SHO': rt('812345678901234567') }, Gama: { 'Webhook ML': { type: 'url', url: HOOK_ML } }, ...props }
  const envios = [], notifs = [], diag = new Map(), lidas = []
  const envio = envioReal || { configurado: () => true, resposta: null, enviarInterno: async x => { envios.push(x); return envio.resposta || { estado: 'enviado', motivo: '' } } }
  const fontes = { dados: () => dadosSinteticos(), diagnostico: c => diag.get(c) || { disponivel: false }, destinoInterno: async c => { lidas.push(c); return destinosDeProps(central[c] || {}).interno } }
  const cons = criarConsultorDiscord({ handle: h, gatilhos: g, fontes, envio, agora: rl.agora, validarPor, notificar: o => notifs.push(o) })
  const rows = c => h.prepare('SELECT * FROM consultor_aviso WHERE cliente = ? ORDER BY criado_em, id').all(c)
  const interno = (c, tipo, itens = [], texto = 'x') => h.prepare("INSERT INTO gatilho_cliente (cliente, tipo, classe, assinatura, itens_json, texto, estado, motivo, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,'interno','assessoria',?,?)").run(c, tipo, CFG.gatilhos[tipo].classe, tipo + Math.random(), JSON.stringify(itens), texto, rl.agora(), rl.agora())
  return { h, rl, g, cons, envios, notifs, diag, rows, interno, central, lidas }
}

await ok('chave NASCE desligada e desligada não envia; ligada: TERÇA 08:30–20:00 no fuso do cliente, TODO cliente com integração ML e «Webhook ML» (independe da liberação do cliente), idempotente por semana ISO (o 2º tick não repete; a semana seguinte manda de novo)', async () => {
  const m = mundo()
  assert.deepEqual(m.cons.chaveEstado().ligado, false)
  assert.deepEqual(await m.cons.tick(), { pulou: 'desligado' }); assert.equal(m.rows('Acme').length + m.envios.length, 0, 'nada montado, nada enviado')
  assert.throws(() => m.cons.chave({ ligado: true, por: 'Fulano' }), /somente líder ou consultor/); assert.throws(() => m.cons.chave({ ligado: 'sim', por: POR }), /ligado/)
  m.cons.chave({ ligado: true, por: POR }); assert.equal(m.cons.chaveEstado().ligado, true)
  m.rl.ir('2026-10-20', '08:20'); await m.cons.tick(); assert.equal(m.envios.length, 0, '08:20 ainda não')
  m.rl.ir('2026-10-20', '08:40'); const r = await m.cons.tick()
  assert.equal(r.semanais, 3, 'Acme, Beta e Gama — Gama NÃO está liberado nos avisos ao cliente e recebe (o Discord do time independe do WhatsApp do cliente)'); assert.equal(m.g.notificacao('Gama').liberado_por, '')
  const [a] = m.rows('Acme'); assert.deepEqual([a.tipo, a.estado, a.chave, a.dia, a.mencao], ['interno_semanal', 'enviado', '2026-W43', '2026-10-20', 1])
  await m.cons.tick(); m.rl.ir('2026-10-20', '15:00'); await m.cons.tick(); assert.equal(m.envios.length, 3, 'mesma semana: nada de novo'); assert.equal(m.rows('Acme').length, 1)
  m.rl.ir('2026-10-21', '08:40'); await m.cons.tick(); m.rl.ir('2026-10-20', '20:30'); await m.cons.tick(); m.rl.ir('2026-10-26', '08:40'); await m.cons.tick()
  assert.equal(m.envios.length, 3, 'quarta, terça depois das 20:00 e a segunda (dia antigo): fora da janela')
  m.rl.ir('2026-10-27', '09:00'); await m.cons.tick(); assert.equal(m.rows('Acme').length, 2, 'terça seguinte: novo resumo'); assert.equal(m.rows('Acme')[1].chave, '2026-W44')
  m.cons.chave({ ligado: false, por: POR }); m.rl.ir('2026-11-03', '09:00'); assert.deepEqual(await m.cons.tick(), { pulou: 'desligado' }); assert.equal(m.envios.length, 6)
})

await ok('destinatários: sem integração ML de fato não recebe (motivo fixo na tela); exclusão opcional por sync_estado.consultor_excluidos; nada antes de 2026-10-20 (terça 13/10 = nada); cliente fora da central ou sem «Webhook ML» é pulado sem linha nem sino, lido 1× por dia', async () => {
  const m = mundo({ integ: { Gama: { ok: false, motivo: 'coleta_atrasada' } }, props: { Beta: {} } }); m.cons.chave({ ligado: true, por: POR })
  m.rl.ir('2026-10-13', '08:40'); await m.cons.tick(); assert.deepEqual([m.envios.length, m.lidas.length], [0, 0], 'terça 13/10, antes do início: nada (nem lê a central)')
  m.rl.ir('2026-10-20', '08:40'); let r = await m.cons.tick()
  assert.deepEqual([r.semanais, r.sem_integracao, r.sem_canal], [1, 1, 1], 'Acme sai; Gama sem integração; Beta sem Webhook ML'); assert.deepEqual(m.envios.map(e => e.lote.cliente), ['Acme'])
  assert.equal(m.rows('Beta').length, 0, 'sem Webhook ML: sem linha'); assert.ok(!m.notifs.some(x => x.tipo === 'consultor_discord_sem_destino'), 'nem sino (não é destinatário)')
  m.rl.ir('2026-10-20', '09:30'); await m.cons.tick(); assert.equal(m.lidas.filter(c => c === 'Beta').length, 1, 'a central do cliente sem canal é lida 1× por dia'); assert.equal(m.lidas.includes('Gama'), false, 'sem integração não lê a central')
  assert.deepEqual((await m.cons.listarCliente('Gama')).recebe, { ok: false, motivo: 'coleta_atrasada', mensagem: 'A coleta do Mercado Livre não roda há mais de 3 dias.' })
  m.h.prepare("INSERT INTO sync_estado (chave, valor) VALUES ('consultor_excluidos', ?)").run(JSON.stringify(['Acme']))
  assert.equal((await m.cons.listarCliente('Acme')).recebe.motivo, 'excluido'); m.rl.ir('2026-10-27', '08:40'); r = await m.cons.tick(); assert.equal(r.semanais, 0, 'Acme excluído: nada')
})

await ok('envio: só Mercado Livre («Webhook ML»; o webhook da Shopee nunca), os 3 cargos + o consultor no topo da 1ª parte, discord_partes ≤ 1900 na ordem; consultor sem id válido → só os cargos + aviso no sino; sem Webhook ML → não recebe', async () => {
  const m = mundo({ props: { Beta: { 'Webhook ML': { type: 'url', url: HOOK_ML }, 'Discord ID Consultor ML': rt('Fulano') }, Gama: {} } })
  m.cons.chave({ ligado: true, por: POR }); await m.cons.tick()
  const a = m.envios.find(e => e.lote.cliente === 'Acme'), b = m.envios.find(e => e.lote.cliente === 'Beta')
  assert.equal(a.destino, HOOK_ML, 'só o Webhook ML'); assert.ok(!JSON.stringify(m.envios).includes(HOOK_SHO))
  assert.ok(a.partes[0].startsWith(`${PREFIXO} <@712345678901234567>\n**Resumo semanal da conta · Acme · 20/10**`), 'cargos + consultor no topo da 1ª parte'); assert.deepEqual(a.mencionar, ['712345678901234567']); assert.deepEqual(a.mencionarCargos, CARGOS)
  assert.ok(a.partes.every(p => p.length <= 1900)); assert.equal(a.partes.join('\n').replace(/^[^\n]*\n/, ''), m.rows('Acme')[0].texto, 'partes na ordem = o texto gravado (menções só no topo)')
  assert.match(a.lote.assunto, /^Resumo semanal ao consultor · 20\/10\/2026$/); assert.equal(a.lote.tipo, 'interno_semanal')
  assert.ok(b.partes[0].startsWith(`${PREFIXO}\n**Resumo`), 'id inválido = só os 3 cargos'); assert.doesNotMatch(b.partes[0], /<@\d/); assert.deepEqual(b.mencionar, []); assert.deepEqual(b.mencionarCargos, CARGOS); assert.equal(m.rows('Beta')[0].mencao, 0)
  assert.ok(m.notifs.some(x => x.tipo === 'consultor_discord_sem_mencao' && x.cliente === 'Beta'))
  assert.ok(!m.envios.some(e => e.lote.cliente === 'Gama') && m.rows('Gama').length === 0, 'Gama sem Webhook ML: não recebe')
  // texto longo: várias partes, todas ≤ 1900 com a menção incluída
  const longo = mundo(); longo.cons.chave({ ligado: true, por: POR })
  const d0 = dadosSinteticos(); d0.entregas = Array.from({ length: 5 }, (_, i) => ({ ...d0.entregas[0], titulo: `Kit ${i} ${'nome comprido '.repeat(4)}`, tarefa: 'tarefa '.repeat(12) + i }))
  for (let i = 0; i < 10; i++) longo.interno('Acme', 'oferta_terminando', [], `${i} ` + 'promoção terminando em vários anúncios com nomes longos, '.repeat(6))
  const c2 = criarConsultorDiscord({ handle: longo.h, gatilhos: longo.g, fontes: { dados: () => d0, destinoInterno: async () => destinosDeProps(longo.central.Acme).interno }, envio: { configurado: () => true, enviarInterno: async x => { longo.envios.push(x); return { estado: 'enviado' } } }, agora: longo.rl.agora, validarPor })
  c2.chave({ ligado: true, por: POR }); await c2.tick()
  const e = longo.envios.find(x => x.lote.cliente === 'Acme'); assert.ok(e.partes.length >= 2, 'mais de uma parte'); assert.ok(e.partes.every(p => p.length <= 1900), 'toda parte ≤ 1900 com as menções')
  // só o webhook da Shopee: não é destinatário (sem linha, nada enviado)
  const s = mundo({ props: { Acme: { 'Webhook SHO': { type: 'url', url: HOOK_SHO }, 'Discord ID Consultor ML': rt('712345678901234567') } } }); s.cons.chave({ ligado: true, por: POR }); const rs = await s.cons.tick()
  assert.equal(s.rows('Acme').length, 0); assert.ok(!s.envios.some(x => x.lote.cliente === 'Acme')); assert.ok(rs.sem_canal >= 1)
})

await ok('entrega real pelo MESMO webhook (gatilhos-envio.enviarInterno): POST assinado, interno:true, só o canal discord, discord_partes e discord_mencionar; sem URL/segredo = pendente n8n_nao_configurado; webhook fora do Discord = pendente sem_destino; 5xx = falhou', async () => {
  const reqs = []; let resposta = { ok: true, status: 200 }
  const env = { PLACE_GATILHOS_URL: 'https://n8n.exemplo.test', PLACE_GATILHOS_SECRET: SECRET }, rl = relogio('2026-10-20', '08:40')
  const e = criarEnvio({ env, fetch: async (url, init) => { reqs.push({ url, init }); return resposta }, agora: rl.agora, webhook: CFG.webhook })
  const lote = { id: 'c0123456789abcde', tipo: 'interno_semanal', cliente: 'Acme', assunto: 'Resumo semanal ao consultor · 20/10/2026' }
  const p1 = `${PREFIXO} <@712345678901234567>\nparte 1`
  assert.deepEqual(await e.enviarInterno({ lote, destino: HOOK_ML, partes: [p1, 'parte 2'], mencionar: ['712345678901234567', 'Fulano'], mencionarCargos: [...CARGOS, '@everyone'] }), { estado: 'enviado', motivo: '' })
  const { url, init } = reqs[0], p = JSON.parse(init.body)
  assert.equal(url, 'https://n8n.exemplo.test/webhook/place-gatilhos'); assert.equal(verificarAssinatura({ secret: SECRET, headers: init.headers, raw: Buffer.from(init.body), agoraMs: rl.ms }), true)
  assert.deepEqual(Object.keys(p), ['lote_id', 'cliente_rotulo', 'tipo', 'interno', 'assunto', 'texto', 'texto_html', 'link', 'canais', 'discord_partes', 'discord_mencionar', 'discord_mencionar_cargos'])
  assert.deepEqual(p.canais, { discord: { ligado: true, destino: HOOK_ML } }); assert.equal(p.interno, true); assert.deepEqual(p.discord_partes, [p1, 'parte 2']); assert.equal(p.texto, `${p1}\nparte 2`)
  assert.deepEqual([p.discord_mencionar, p.discord_mencionar_cargos], [['712345678901234567'], CARGOS], 'ao n8n só ids numéricos de 15–21 dígitos (users e roles do allowed_mentions; nunca @everyone)')
  assert.deepEqual(await e.enviarInterno({ lote, destino: 'https://exemplo.com/hook', partes: ['x'] }), { estado: 'pendente', motivo: 'sem_destino' }); assert.equal(reqs.length, 1)
  resposta = { ok: false, status: 500 }; assert.deepEqual(await e.enviarInterno({ lote, destino: HOOK_ML, partes: ['x'] }), { estado: 'falhou', motivo: 'n8n_500' })
  const sem = criarEnvio({ env: {}, fetch: async () => { throw new Error('não chama') }, agora: rl.agora })
  assert.deepEqual(await sem.enviarInterno({ lote, destino: HOOK_ML, partes: ['x'] }), { estado: 'pendente', motivo: 'n8n_nao_configurado' })
  // no fluxo: n8n sem config → a linha fica pendente (honesto) e não é retentada enquanto o n8n não existir
  const m = mundo({ envioReal: sem }); m.cons.chave({ ligado: true, por: POR }); await m.cons.tick(); m.rl.ir('2026-10-20', '09:30'); await m.cons.tick()
  assert.deepEqual([m.rows('Acme')[0].estado, m.rows('Acme')[0].motivo], ['pendente', 'n8n_nao_configurado'])
})

await ok('recibo do n8n pela rota de recibo dos gatilhos: lote_id do consultor_aviso + canal discord = 200 (idempotente) e fecha entregue; canal do cliente nesse lote = 422; lote do cliente com canal discord continua 422; recibo «falhou» não é retentado', async () => {
  const m = mundo(); m.cons.chave({ ligado: true, por: POR }); await m.cons.tick()
  const id = m.rows('Acme')[0].id
  const app = express(); app.use(criarRotasGatilhosHmac({ gatilhos: m.g, consultor: m.cons, secret: () => SECRET, agoraMs: () => m.rl.ms }))
  const srv = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)) }), base = `http://127.0.0.1:${srv.address().port}`
  const post = async corpo => { const r = await fetch(base + '/webhook/gatilhos/recibo', { method: 'POST', headers: { 'content-type': 'application/json', 'x-place-key': SECRET }, body: JSON.stringify(corpo) }); return { status: r.status, j: await r.json() } }
  try {
    assert.deepEqual(await post({ lote_id: id, canal: 'discord', estado: 'entregue', em: '2026-10-20T11:41:00.000Z' }), { status: 200, j: { ok: true, duplicado: false } })
    assert.deepEqual(await post({ lote_id: id, canal: 'discord', estado: 'entregue' }), { status: 200, j: { ok: true, duplicado: true } })
    assert.equal(m.rows('Acme')[0].estado, 'entregue')
    assert.deepEqual(await post({ lote_id: id, canal: 'whatsapp', estado: 'entregue' }), { status: 422, j: { ok: false, motivo: 'canal_invalido' } })
    m.h.prepare("INSERT INTO gatilho_lote (id, cliente, tipo, dia, estado, canais_json, criado_em) VALUES ('L1', 'Acme', 'semanal', '2026-10-20', 'enviado', '[\"whatsapp\"]', ?)").run(m.rl.agora())
    assert.deepEqual(await post({ lote_id: 'L1', canal: 'discord', estado: 'entregue' }), { status: 422, j: { ok: false, motivo: 'canal_invalido' } }, 'lote do cliente: Discord não é canal do cliente')
    assert.deepEqual(await post({ lote_id: 'nao-existe', canal: 'discord', estado: 'entregue' }), { status: 422, j: { ok: false, motivo: 'lote_desconhecido' } })
    const idB = m.rows('Beta')[0].id
    assert.equal((await post({ lote_id: idB, canal: 'discord', estado: 'falhou' })).status, 200); assert.deepEqual([m.rows('Beta')[0].estado, m.rows('Beta')[0].motivo], ['falhou', 'recibo_falhou'])
    const antes = m.envios.length; m.rl.ir('2026-10-20', '10:00'); await m.cons.tick(); assert.equal(m.envios.length, antes, 'reenviar duplicaria as partes que já saíram: não retenta')
  } finally { srv.close() }
})

await ok('urgente interno: DESLIGADO na config real (quarta com queda forte = nada; vai no 🔔 de terça); ligado (urgente_ligado = true): queda forte da conta, fim de promoção em curva A, Ads sem retorno acima do gasto mínimo do config — 1 por assunto a cada 7 dias; sem diagnóstico não confere curva/gasto; abaixo do mínimo não sai', async () => {
  const d = mundo(); d.cons.chave({ ligado: true, por: POR }); d.rl.ir('2026-10-21', '10:00'); d.interno('Acme', 'queda_forte_conta', [], 'Faturamento caiu 32%.')
  assert.equal(K.urgente_ligado, false); const rd = await d.cons.tick(); assert.deepEqual([rd.urgentes, d.envios.length], [0, 0], 'só semanal: o urgente interno não sai')
  d.rl.ir('2026-10-27', '08:40'); await d.cons.tick(); assert.match(d.envios[0].partes.join('\n'), /🔔 \*\*Morpheus — pontos da assessoria\*\*\n• \*\*Merovíngio · Queda forte do faturamento\*\*: Faturamento caiu 32%\./, 'o que seria urgente vai no resumo de terça')
  const m = mundo({ cfg: cfgUrgente() }); m.cons.chave({ ligado: true, por: POR }); m.rl.ir('2026-10-21', '10:00')     // quarta: só o urgente
  m.interno('Acme', 'queda_forte_conta', [{ variacao_pct: -32 }], 'Faturamento caiu 32% nos últimos 14 dias contra os 14 anteriores (leitura de 07/10 a 20/10).')
  m.interno('Acme', 'promocao_encerrada', [{ item_id: 'U1' }, { item_id: 'U2' }], 'Promoção terminou e o preço voltou ao cheio em 2 anúncio(s) — avaliar renovar: Guia U1 e Guia U2.')
  m.interno('Acme', 'ads_sem_retorno', [{ item_id: 'MLB5', regra: 'anuncio_ads_reduzir' }], 'Anúncios pagos: 1 anúncio(s) gastando sem retorno (R$ 250 em 28 dias). A equipe vai ajustar; a verba é decisão sua.')
  let r = await m.cons.tick(); assert.equal(r.urgentes, 1, 'sem diagnóstico: só a queda forte (curva e gasto não dá para conferir)')
  assert.deepEqual(m.rows('Acme').map(x => x.chave), ['queda_forte_conta']); assert.ok(m.envios[0].partes[0].startsWith(`${PREFIXO} <@712345678901234567>\n**Morpheus · Ponto da assessoria · Acme**\n📉 **Queda forte do faturamento**: Faturamento caiu 32%`))
  m.diag.set('Acme', { disponivel: true, itens: [{ id: 'U1', titulo: 'Guia U1', curva: 'A' }, { id: 'U2', titulo: 'Guia U2', curva: 'C' }, { id: 'MLB5', titulo: 'Cama', curva: 'B', ads: { custo: 250 } }] })
  m.rl.ir('2026-10-21', '10:20'); r = await m.cons.tick()
  assert.equal(r.urgentes, 1, 'fim de promoção em curva A sai; Ads com R$ 250 < mínimo do config não'); assert.ok(K.urgente_ads_gasto_min > 250)
  assert.match(m.envios.at(-1).partes[0], /🏷️ \*\*Promoção terminou e o preço voltou ao cheio\*\* \(inclui anúncio curva A: Guia U1\)/)
  m.diag.set('Acme', { disponivel: true, itens: [{ id: 'U1', curva: 'A' }, { id: 'MLB5', curva: 'B', ads: { custo: K.urgente_ads_gasto_min } }] })
  m.rl.ir('2026-10-21', '10:40'); r = await m.cons.tick(); assert.equal(r.urgentes, 1, 'Ads com gasto ≥ mínimo sai')
  m.rl.ir('2026-10-25', '10:00'); r = await m.cons.tick(); assert.equal(r.urgentes, 0, 'cooldown de 7 dias por assunto')
  m.rl.ir('2026-10-28', '10:30'); r = await m.cons.tick(); assert.equal(r.urgentes, 2, 'Ads saiu às 10:40: ainda no cooldown'); m.rl.ir('2026-10-28', '10:50'); r = await m.cons.tick(); assert.equal(r.urgentes, 1, '7 dias depois, cada assunto volta (as condições continuam)')
  assert.ok(m.rows('Acme').every(x => x.tipo === 'interno_imediato'))
  assert.deepEqual(urgentesConsultor({ internos: [], diag: null, cfg: K }), [])
})

await ok('fim de promoção aparece SÓ aqui: o mesmo gatilho que vira item interno «promoção terminou… avaliar renovar» entra no 🔔 do consultor e nunca no plano ao cliente', async () => {
  const h = new Database(':memory:'); h.exec("CREATE TABLE clientes_central (cliente TEXT PRIMARY KEY, status_cs TEXT NOT NULL DEFAULT 'Ativo', notificacao_json TEXT NOT NULL DEFAULT '{}')")
  h.prepare('INSERT INTO clientes_central (cliente, notificacao_json) VALUES (?,?)').run('Acme', JSON.stringify({ canais: { whatsapp: { ligado: true, destino: '120363012345678901@g.us' } }, liberado_por: POR }))
  const rl = relogio('2026-10-12', '10:00'), promo = id => ({ item_id: id, inicio: '2026-09-08', fim: '2026-10-08', preco_original: 114.14 })
  const fontes = {
    diagnostico: () => ({ disponivel: true, itens: ['U1', 'U2', 'U4'].map(id => ({ id, titulo: id === 'U4' ? 'Coleira refletiva' : `Guia unificada ${id}`, curva: 'A', status: 'active' })) }),
    mudancasPreco: () => [...['U1', 'U2'].map(id => ({ item_id: id, titulo: `Guia unificada ${id}`, dia: '2026-10-12', de: '74.19', para: '114.14', variacao_pct: 53.85, fonte: 'coleta' })), { item_id: 'U4', titulo: 'Coleira refletiva', dia: '2026-10-11', de: '50', para: '80', variacao_pct: 60, fonte: 'coleta' }],
    atividadePreco: () => ({ tarefas: [], execucoes: [], promocoes: ['U1', 'U2'].map(promo), sync: '2026-10-13', promo_lida: '2026-10-12', leituras: ['2026-10-08'] }),
    planoSemana: () => ({ disponivel: true, resumo: { gmv: 12000, pedidos: 150, variacao_pct: 1 }, itens: [], fullParado: [], entregas: [], custosInformados: true }),
  }
  const g = criarGatilhos({ handle: h, fontes, agora: rl.agora, cfg: CFG, validarPor, elegiveis: () => [{ cliente: 'Acme', status: 'Ativo' }], clienteCanonico: c => c === 'Acme' ? 'Acme' : '' })
  await g.avaliar('Acme')
  const plano = g.montarLote('Acme', 'semanal', { gravar: false }).texto_final
  assert.doesNotMatch(plano, /Promoção terminou|Guia unificada/, 'nunca ao cliente'); assert.match(plano, /Coleira refletiva/, 'a mudança de verdade fora da Place2u vai ao cliente')
  const cons = criarConsultorDiscord({ handle: h, gatilhos: g, fontes: { dados: () => ({ medidas: [] }) }, agora: rl.agora })
  const t = cons.montarSemanal('Acme', { gravar: false }).texto, c = t.slice(t.indexOf('🔔'), t.indexOf('📲'))
  assert.match(c, /• \*\*Smith · Promoção terminou e o preço voltou ao cheio\*\*: Promoção terminou e o preço voltou ao cheio em 2 anúncios — avaliar renovar: Guia unificada U1 e Guia unificada U2\./)
  assert.doesNotMatch(c, /Coleira refletiva/, 'o que é do cliente não vira ponto da assessoria')
  // prévia = o que sai: sem gravar não cria linha; o desta semana já montado volta igual
  assert.equal(h.prepare('SELECT COUNT(*) n FROM consultor_aviso').get().n, 0)
  const gravado = cons.montarSemanal('Acme'); assert.equal(cons.montarSemanal('Acme', { gravar: false }).hash, gravado.hash); assert.equal(cons.montarSemanal('Acme', { gravar: false }).ja_existia, true)
})

await ok('rotas: GET /api/cliente/consultor-discord (estado leve; ?previa=1 monta sem gravar), GET|POST /api/consultor-discord/chave (415 sem JSON, 403 fora da central, mensagem sem eco); prospect 404', async () => {
  const m = mundo()
  const app = express(); app.use(express.json()); app.use(criarRotasConsultor({ consultor: m.cons, clienteCanonico: c => ['Acme', 'Beta', 'Gama'].includes(c) ? c : '' }))
  const srv = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)) }), base = `http://127.0.0.1:${srv.address().port}`
  const chama = async (rota, corpo, tipo = 'application/json') => { const r = await fetch(base + rota, corpo === undefined ? {} : { method: 'POST', headers: { 'Content-Type': tipo }, body: JSON.stringify(corpo) }); const t = await r.text(); return { status: r.status, t, j: JSON.parse(t) } }
  try {
    let r = await chama('/api/cliente/consultor-discord?cliente=Acme'); assert.equal(r.status, 200); assert.deepEqual([r.j.recebe, r.j.chave.ligado, r.j.ultimo, 'previa' in r.j], [{ ok: true, motivo: '', mensagem: '' }, false, null, false])
    assert.equal(m.lidas.length, 0, 'estado leve: sem ler a central')
    r = await chama('/api/cliente/consultor-discord?cliente=Acme&previa=1'); assert.match(r.j.previa.texto, /Resumo semanal da conta · Acme/); assert.equal(r.j.previa.estado, 'previa'); assert.equal(m.rows('Acme').length, 0, 'prévia não grava')
    assert.ok(r.j.previa.partes[0].startsWith(`${PREFIXO} <@712345678901234567>\n**Resumo semanal da conta · Acme`), 'a prévia mostra as partes EXATAS que saem (cargos + consultor no topo)'); assert.deepEqual([r.j.previa.mencoes, r.j.previa.canal], [{ cargos: 3, consultor: true }, true])
    r = await chama('/api/cliente/consultor-discord?cliente=Gama'); assert.equal(r.j.recebe.ok, true, 'Gama não liberado nos avisos ao cliente: o time recebe mesmo assim')
    r = await chama('/api/cliente/consultor-discord?cliente=' + encodeURIComponent('[Comercial] Loja X')); assert.equal(r.status, 404); assert.ok(!r.t.includes('Loja X'))
    assert.equal((await chama('/api/consultor-discord/chave', { ligado: true, por: POR }, 'text/plain')).status, 415)
    r = await chama('/api/consultor-discord/chave', { ligado: true, por: 'Fulano' }); assert.equal(r.status, 403); assert.ok(!r.t.includes('Fulano'))
    r = await chama('/api/consultor-discord/chave', { ligado: true, por: POR }); assert.deepEqual(r.j, { ok: true, ligado: true })
    r = await chama('/api/consultor-discord/chave'); assert.equal(r.j.ligado, true); assert.match(r.j.por, /^Carla Souza · /); assert.deepEqual([r.j.agenda, r.j.urgente_ligado, r.j.inicio_envios], [{ dia_semana: 2, hora: '08:30', ate: '20:00' }, false, '2026-10-20'])
  } finally { srv.close() }
})

// ── revisão das decisões finais (12/10/2026): achados corrigidos ──────────────────────────────────────────────────────────────────────────────────────────────────
await ok('consultor_excluidos casa sem acento/maiúscula/espaço e avisa no log 1× os nomes que não casam com nenhum Ativo; prévia com o Notion fora não afirma «falta o Webhook ML» (canal_motivo); antes de 20/10 recebe() diz antes_do_inicio com a data', async () => {
  const m = mundo(), logs = []
  const cons = criarConsultorDiscord({ handle: m.h, gatilhos: m.g, agora: m.rl.agora, validarPor, log: (nv, t) => logs.push(`${nv}: ${t}`),
    fontes: { dados: () => dadosSinteticos(), destinoInterno: async c => c === 'Beta' ? { discord: '', consultor: '', motivo: 'notion_indisponivel' } : destinosDeProps(m.central[c] || {}).interno },
    envio: { configurado: () => true, enviarInterno: async x => { m.envios.push(x); return { estado: 'enviado', motivo: '' } } } })
  m.h.prepare("INSERT INTO sync_estado (chave, valor) VALUES ('consultor_excluidos', ?)").run(JSON.stringify(['  ACMÉ ', 'Fulano Inexistente']))
  assert.equal((await cons.listarCliente('Acme')).recebe.motivo, 'excluido', 'nome digitado com acento/maiúscula/espaço exclui')
  cons.chave({ ligado: true, por: POR }); await cons.tick(); m.rl.ir('2026-10-20', '09:40'); await cons.tick()
  assert.deepEqual(m.envios.map(e => e.lote.cliente), ['Gama'], 'Acme excluído; Beta com o Notion fora não sai (tenta no próximo tick)')
  const soltos = logs.filter(l => /não casam/.test(l)); assert.equal(soltos.length, 1, 'aviso 1× por conteúdo da lista'); assert.match(soltos[0], /^aviso: .*1 nome\(s\).*fulano inexistente/)
  const pb = (await cons.listarCliente('Beta', { previa: true })).previa; assert.deepEqual([pb.canal, pb.canal_motivo], [false, 'notion_indisponivel'], 'Notion fora: motivo da leitura, não «sem Webhook ML»')
  const pg = (await cons.listarCliente('Gama', { previa: true })).previa; assert.deepEqual([pg.canal, pg.canal_motivo], [true, ''])
  const sem = mundo({ props: { Gama: {} } }); assert.equal((await sem.cons.listarCliente('Gama', { previa: true })).previa.canal_motivo, 'sem_destino', 'central lida sem «Webhook ML»')
  m.rl.ir('2026-10-13', '08:40'); const r = (await cons.listarCliente('Gama')).recebe
  assert.deepEqual([r.ok, r.motivo], [false, 'antes_do_inicio']); assert.match(r.mensagem, /20\/10\/2026/)
})

console.log(`\n${n} verificações do aviso ao consultor ok.`)
