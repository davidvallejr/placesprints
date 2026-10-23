// Autoteste dos gatilhos do Merovíngio ao cliente (src/lib/gatilhos.js): banco EM MEMÓRIA, fontes stub (nenhuma rede, nenhum Mercado Livre, nenhum Notion),
// relógio falso em São Paulo com o PROCESSO em outro fuso (Pacific/Auckland) para provar que janela, silêncio e dia são lidos via Intl no fuso do cliente.
// Cobre: catálogo (16 tipos, templates auditados), cada tipo dispara e resolve, dedupe por assinatura, cooldown por tipo, auditor suprimindo promessa, janela/silêncio,
// lote diário idempotente por (cliente, dia), teto de imediatos, texto final sem ID interno nem nome de analista, prospect nunca, recibos e envio manual.
// 12/10/2026: dono por tipo (assessoria nunca em lote/prévia/envio; interno + aviso_assessoria), origem do preço, queda_por_preco, reposição acionável e migração de estado.
// Achados de 12/10: janela do preço ancorada na leitura anterior, carimbos (sync/promoções/leituras), tarefas de desconto/oferta, preço riscado, curva A/B estrita,
// sugestão de Full só do plano e limitada ao estoque, premissa da quantidade, um nome por linha, aviso interno por nível e detecção no pós-coleta com a chave desligada.
// Decisões de 12/10/2026 (David): SÓ MERCADO LIVRE (Discord fora dos canais do cliente), plano SEMANAL de segunda 09:00 (idempotente por semana ISO, janela até 20:00)
// + urgente na hora só dos 6 tipos de ritmo 'hora' (ruptura A/B ≤ 3 dias, despacho vencido, reclamação, reputação, anúncio restrito, queda por preço); fim do lote diário e do
// título antigo; travas: fim de promoção ≠ mudança do cliente (item interno promocao_encerrada), janela de origem com lacuna de coleta, Full parado nunca com venda em 28 dias.
// DECISÕES FINAIS (David, 12/10/2026): agenda de TERÇA (time 08:30, cliente 09:00), só semanal (urgente nasce desligado; nada sai fora da terça), nenhum envio antes de
// inicio_envios (2026-10-20), só cliente com integração ML de fato (integracao-ml.js, 3 motivos) e liberação em lote (prepararLote / POST /api/gatilhos/preparar-lote).
// Os testes de MECÂNICA abaixo rodam com cfgMecanica() (a agenda antiga de segunda, sem trava de início, urgente ligado no cliente): o mecanismo é o mesmo, parametrizado
// pelo config; os blocos «decisões finais» no fim usam a configuração REAL.
// Rodar: node scripts/teste-gatilhos.mjs
process.env.PS_DB_MEMORIA = '1'
process.env.TZ = 'Pacific/Auckland'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import Database from 'better-sqlite3'
import { criarGatilhos, lerConfig, validarConfig, validarNotificacao, dentroDaJanela, listaNomes, TIPOS, DONOS, origemPreco, sha, semanaIso, CANAIS, quandoMudou, preencherVazios } from '../src/lib/gatilhos.js'
import { integracaoMlAtiva, MOTIVOS_INTEGRACAO } from '../src/lib/integracao-ml.js'
import { criarConsultorDiscord } from '../src/lib/consultor-discord.js'
import { criarRotasGatilhos, criarRotasGatilhosHmac } from '../src/rotas-gatilhos.js'
import express from 'express'
import { auditarTexto } from '../src/lib/relatorio-seguro.js'
import { ABERTURA, ASSINATURA, NOTA, semFixos, auditarMensagem } from '../src/lib/plano-semana-texto.js'

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const QUEM = ['Giovanna Torres', 'Carla Souza'], validarPor = v => QUEM.find(q => norm(q) === norm(v)) || ''
const POR = 'Carla Souza'
const relogio = (hoje = '2026-10-14', hora = '10:00') => { const r = { ms: Date.parse(`${hoje}T${hora}:00-03:00`) }; r.agora = () => new Date(r.ms).toISOString(); r.ir = (h, hr) => { r.ms = Date.parse(`${h}T${hr}:00-03:00`) }; r.avancarDias = d => { r.ms += d * 86_400_000 }; return r }
const SEM_ID = /MLB\d|PS-|\bT\d\b|Giovanna|Carla|Torres|Souza|\d{10,}|INV9|order|claim|question/i
const ANTIGO = /O que depende de você|Aviso Place2u|resumo di[aá]rio/i                                                     // título e ritmo extintos em 12/10/2026
const auditaMsg = (t, c = 'Acme') => auditarMensagem(t, auditarTexto, { nomesInternos: QUEM, permitidos: [c] })
// mecânica (agenda antiga de segunda, sem trava de início, urgente na hora permitido pelo config): o config real (terça, inicio_envios) é testado nos blocos «decisões finais»
// 14/10/2026: o urgente real é só estoque e preço (1 mensagem/dia, 5 pontos, sem corte de dias — scripts/teste-alerta-impacto.mjs); a MECÂNICA aqui segue com os 6 tipos de ritmo hora,
// ruptura ≤ 3 dias, 3 pontos e 3 mensagens por dia (o mecanismo é o mesmo, parametrizado pelo config)
const cfgMecanica = () => { const c = JSON.parse(JSON.stringify(lerConfig())); c.semanal = { dia_semana: 1, hora: '09:00', ate: '20:00' }; delete c.inicio_envios; c.urgente.na_hora_ligado = true; c.urgente.impacto_min_reais = 0   // 14/10: o piso em R$ é testado em teste-alerta-impacto
  c.urgente.ruptura_max_dias = 3; c.urgente.tipos = ['ruptura_curva_a', 'envio_atrasado', 'reclamacao_mediacao', 'reputacao_em_risco', 'anuncio_restrito', 'queda_por_preco']; c.teto.itens_urgente = 3; c.teto.lotes_imediatos_dia = 3; c.urgente.liberacao_automatica = ''; return validarConfig(c) }   // liberação só pelo líder
const INTEGRADO = () => ({ ok: true, motivo: '' })

// dados sintéticos que disparam os 16 tipos (queda forte e queda moderada são exclusivas: 15 + 1 na segunda passada)
const diagCompleto = () => ({ disponivel: true, itens: [
  { id: 'MLB1', titulo: 'Ração Premium 15kg', curva: 'A', status: 'active', cobertura: 2, estoque: 8, ponto_reposicao: 20, r: 2800, r0: 2600, logistica: '' },
  { id: 'MLB2', titulo: 'Coleira Pet ajustável', curva: 'B', status: 'active', cobertura: 15, estoque: 30, ponto_reposicao: 40, r: 500, r0: 480, logistica: '' },
  { id: 'MLB3', titulo: 'Shampoo Pet 500ml', curva: 'A', status: 'active', cobertura: 40, estoque: 100, ponto_reposicao: 20, r: 900, r0: 900, logistica: 'self_service', full_sug: 12 },
  { id: 'MLB4', titulo: 'Brinquedo mordedor', curva: 'C', status: 'paused', cobertura: null, estoque: 5, ponto_reposicao: null, r: 0, r0: 300, logistica: '' },
  { id: 'MLB5', titulo: 'Cama Pet média', curva: 'B', status: 'active', cobertura: 50, estoque: 200, ponto_reposicao: 10, r: 1000, r0: 950, logistica: 'fulfillment', ads: { custo: 120 } },
  { id: 'MLB6', titulo: 'Areia para gatos 4kg', curva: 'B', status: 'active', cobertura: 60, estoque: 120, ponto_reposicao: 10, r: 300, r0: 300, logistica: 'self_service' },
] })
const saudeCompleta = () => ({ dia: '2026-10-14', do_dia: true, pendente: {}, atrasos: 2, perguntas: { abertas: 3, mais_de_24h: 2 }, reclamacoes: { abertas: 1, mediacoes: 1 },
  reputacao: { nivel: '3_yellow', taxa_claims: 1.8, taxa_atraso: 2, taxa_cancel: 0.2, vendas_periodo: 500 },
  listas: { atrasos: [{ order_id: '2000000001' }, { order_id: '2000000002' }], claims: [{ claim_id: 'c1', estagio: 'mediation', prazo_resposta: '2026-10-15T12:00:00Z' }],
    perguntas: [{ question_id: 'q1', mais_de_24h: 1 }, { question_id: 'q2', mais_de_24h: 1 }, { question_id: 'q3', mais_de_24h: 0 }], full: [{ item_id: 'MLB9', inventory_id: 'INV9', disponivel: 12, dias_sem_venda: 75 }] } })
const saudeLimpa = () => ({ dia: '2026-10-14', do_dia: true, pendente: {}, atrasos: 0, perguntas: { abertas: 0, mais_de_24h: 0 }, reclamacoes: { abertas: 0, mediacoes: 0 }, reputacao: { nivel: '5_green', taxa_claims: 0.1, taxa_atraso: 0.5, taxa_cancel: 0.1, vendas_periodo: 500 }, listas: { atrasos: [], claims: [], perguntas: [], full: [] } })
const quedaForte = () => ({ estado: 'queda', forca: 'forte', significativo: true, variacao_pct: -32.4, janela_dias: 14, janela: { atual: ['2026-09-30', '2026-10-13'] }, sinal_misto: null })
const acoesCompletas = () => [{ id: 'PS-a1', regra: 'anuncio_cadastrar_custos', item_id: '', dados: { execucao: { caminho: 'cliente' } } }, { id: 'PS-a2', regra: 'anuncio_ads_reduzir', item_id: 'MLB5', dados: {} }, { id: 'PS-a3', regra: 'anuncio_preco_mudou_vendas_cairam', item_id: 'MLB6', dados: {} }, { id: 'PS-a4', regra: 'anuncio_full_envio', item_id: 'MLB3', dados: {} }]
// carimbos que o origemPreco confere por mudança (mudanças de 13/10, hoje 14/10): Notion sincronizado até o fim da janela, promoções lidas no dia, anúncios lidos em 30/09 e 12/10
const LIDO = { sync: '2026-10-14', promo_lida: '2026-10-14', leituras: ['2026-09-30', '2026-10-12'] }
// curva A/B no diagnóstico para os anúncios das mudanças de preço (sem cobertura, ponto de reposição nem pausa: não dispara outro gatilho)
const diagPreco = (extra = []) => ({ disponivel: true, itens: ['MLB6', 'MLB7', 'MLB8', ...extra].map(id => ({ id, titulo: id, curva: 'A', status: 'active' })) })
const precos = () => [{ item_id: 'MLB6', titulo: 'Areia para gatos 4kg', dia: '2026-10-13', de: '20.00', para: '29.99', variacao_pct: 49.95, fonte: 'coleta' }, { item_id: 'MLB7', titulo: 'Pequeno', dia: '2026-10-13', de: '10', para: '10.5', variacao_pct: 5, fonte: 'coleta' }, { item_id: 'MLB8', titulo: 'Oferta', dia: '2026-10-13', de: '10', para: '20', variacao_pct: 100, fonte: 'ofertas' }]
const promos = () => [{ item_id: 'MLB1', titulo: 'Ração Premium 15kg', nome: 'Semana Pet', fim: '2026-10-16T23:59:59', status: 'started' }, { item_id: 'MLB2', titulo: 'Coleira', nome: 'Longa', fim: '2026-10-30T23:59:59', status: 'started' }]
const pendencias = () => ({ itens: [
  { item: 'documentos_conta', canal: 'ml', rotulo: 'Documentos e validação da conta', canal_rotulo: 'Mercado Livre', fonte: 'tarefa', dias: 20, desde: '2026-09-24', desde_aproximado: false, tarefas: 2 },
  { item: 'documentos_conta', canal: 'amazon', rotulo: 'Documentos e validação da conta', canal_rotulo: 'Amazon', fonte: 'tarefa', dias: 25, desde: '2026-09-19', desde_aproximado: false, tarefas: 1 },
  { item: 'retorno_pendente', canal: 'geral', rotulo: 'Retorno pendente', canal_rotulo: '', fonte: 'tarefa', dias: 40, desde: '2026-09-01', desde_aproximado: false, tarefas: 1 },
  { item: 'documentos_conta', canal: 'shopee', rotulo: 'Documentos e validação da conta', canal_rotulo: 'Shopee', fonte: 'tarefa', dias: 5, desde: '2026-10-09', desde_aproximado: false, tarefas: 1 },
  { item: 'aprovacoes', canal: 'ml', rotulo: 'Aprovações', canal_rotulo: 'Mercado Livre', fonte: 'tarefa', dias: 30, desde: '2026-09-14', desde_aproximado: true, tarefas: 1 },
], tarefas: [{ id: 'T1', item: 'documentos_conta', canal: 'ml', dias: 20 }, { id: 'T2', item: 'documentos_conta', canal: 'ml', dias: 18 }, { id: 'T3', item: 'documentos_conta', canal: 'shopee', dias: 5 }, { id: 'T4', item: 'documentos_conta', canal: 'amazon', dias: 25 }] })

function mundo({ clientes = [['Acme', 'Ativo'], ['Beta', 'Ativo'], ['[Comercial] Loja X · 7', 'Ativo'], ['Congelado', 'Congelado']], hora = '10:00', cfg = cfgMecanica(), fontesExtra = {}, auditar, integracao = INTEGRADO, urgenteNaHora = true } = {}) {
  const h = new Database(':memory:')
  h.exec("CREATE TABLE clientes_central (cliente TEXT PRIMARY KEY, status_cs TEXT NOT NULL DEFAULT '', notificacao_json TEXT NOT NULL DEFAULT '{}')")
  for (const [c, st] of clientes) h.prepare('INSERT INTO clientes_central (cliente, status_cs) VALUES (?,?)').run(c, st)
  const rl = relogio('2026-10-14', hora)
  const D = { diag: new Map(), saude: new Map(), estado: new Map(), acoes: new Map(), preco: new Map(), promo: new Map(), pend: new Map(), ativ: new Map(), plano: new Map(), titulos: new Map([['Acme', { MLB9: 'Tapete higiênico 30un' }]]) }
  // dados do plano semanal (fonte real: dadosPlanoSemana): padrão = conta sem estoque a apontar e com custos — o plano leva só as linhas de gatilho do cliente
  const planoPadrao = () => ({ disponivel: true, resumo: { gmv: 12000, pedidos: 150, variacao_pct: 1 }, itens: [], fullParado: [], entregas: [], custosInformados: true })
  const fontes = {
    acoes: c => D.acoes.get(c) || [], pendencias: c => D.pend.get(c) || { itens: [], tarefas: [] }, explicar: () => ({ o_que_precisamos: 'Enviar os documentos pedidos pela equipe.' }),
    estadoConta: c => D.estado.get(c) || null, saude: c => D.saude.get(c) || null, diagnostico: c => D.diag.get(c) || { disponivel: false, motivo: 'sem dados' },
    sugestaoFull: i => i.full_sug ? { cobertura_planejada: 30, seguranca: 7, cenarios: { conservador: i.full_sug, base: i.full_sug + 5 } } : null,
    mudancasPreco: c => D.preco.get(c) || [], atividadePreco: c => D.ativ.has(c) ? D.ativ.get(c) : { tarefas: [], execucoes: [], promocoes: [], ...LIDO }, promocoes: c => D.promo.get(c) || [], titulos: (c, ids) => new Map(ids.map(id => [id, (D.titulos.get(c) || {})[id]])),
    planoSemana: c => D.plano.has(c) ? D.plano.get(c) : planoPadrao(),
    ...fontesExtra,
  }
  const envios = [], logs = [], notifs = []
  const envio = { resposta: null, configurado: () => true, enviar: async ({ lote, notificacao }) => { envios.push({ lote, canais: Object.keys(notificacao.canais).filter(k => notificacao.canais[k].ligado) }); return envio.resposta || { estado: 'enviado', motivo: '', recibos: {} } }, testar: async ({ canal }) => ({ estado: 'enviado', motivo: '', canal }) }
  const canon = nome => clientes.map(([c]) => c).find(c => norm(c) === norm(nome)) || ''
  const g = criarGatilhos({ handle: h, fontes, agora: rl.agora, nomesInternos: () => QUEM, cfg, validarPor, ...(auditar ? { auditar } : {}), elegiveis: () => clientes.map(([c, st]) => ({ cliente: c, status: st })), clienteCanonico: canon, envio, log: (nv, m) => logs.push(`${nv}: ${m}`), notificar: o => notifs.push(o), integracao: c => integracao(c), coletaCompleta: () => true })
  const m = { h, rl, D, g, envio, envios, logs, notifs }
  m.tudo = c => { D.diag.set(c, diagCompleto()); D.saude.set(c, saudeCompleta()); D.estado.set(c, quedaForte()); D.acoes.set(c, acoesCompletas()); D.preco.set(c, precos()); D.promo.set(c, promos()); D.pend.set(c, pendencias()) }
  m.nada = c => { for (const k of Object.keys(D)) if (k !== 'titulos') D[k].delete(c) }
  // mecânica: urgente na hora LIGADO no cliente (o padrão real é desligado — ver «decisões finais»); extra.ritmo sobrescreve
  m.configurar = (c, canais = { whatsapp: { ligado: true, destino: '120363012345678901@g.us' } }, extra = {}) => g.configurar({ cliente: c, por: POR, notificacao: { canais, ritmo: { critico_na_hora: urgenteNaHora }, ...extra } })
  m.liberar = c => g.liberar({ clientes: [c], por: POR })
  m.ligar = () => g.chave({ ligado: true, por: POR })
  m.pronto = c => { m.configurar(c); m.liberar(c); m.ligar() }
  m.rows = c => h.prepare('SELECT * FROM gatilho_cliente WHERE cliente = ? ORDER BY id').all(c)
  m.lotes = c => h.prepare('SELECT * FROM gatilho_lote WHERE cliente = ? ORDER BY criado_em, id').all(c)
  // manda tudo o que está na fila: urgentes (até 3 por mensagem, teto de 3 mensagens/dia) e o plano da semana
  m.plano = (c, extra = {}) => D.plano.set(c, { ...planoPadrao(), ...extra })
  m.esvaziar = async c => { for (let i = 0; i < 3; i++) { const l = g.montarLote(c, 'imediato'); if (!l.id || l.vazio || l.teto || l.ja_existia) break; await g.enviarLote(l.id) } const s = g.montarLote(c, 'semanal'); if (s.id && !s.ja_existia && !s.vazio) await g.enviarLote(s.id) }
  return m
}

await ok('catálogo: 18 tipos, templates passam no auditor; template com promessa ou tipo fora da lista derruba a carga', () => {
  const cfg = lerConfig()
  assert.deepEqual(Object.keys(cfg.gatilhos).sort(), [...TIPOS].sort()); assert.equal(TIPOS.length, 19, '14/10: + estoque_zerado (campeão que zerou)')
  assert.equal(cfg.preco_drastico_pct, 15); assert.deepEqual(cfg.janela, { inicio: '07:00', fim: '21:00' }); assert.deepEqual(cfg.cooldown_por_classe, { critico: 1, atencao: 7, info: 14 })
  const ruim = JSON.parse(JSON.stringify(cfg)); ruim.gatilhos.queda_conta.template = 'Garantimos que as vendas vão subir {x}%'
  assert.throws(() => validarConfig(ruim), /auditor/)
  const extra = JSON.parse(JSON.stringify(cfg)); extra.gatilhos.inventado = { rotulo: 'x', classe: 'info', ritmo: 'diario', template: 'x' }
  assert.throws(() => validarConfig(extra), /fora da lista/)
  // um só motor: nenhum limiar de decisão repetido aqui (vêm de config/algoritmo.json → limiares/foco); a carga recusa limiar próprio
  const bruto = JSON.parse(readFileSync(new URL('../config/gatilhos.json', import.meta.url), 'utf8')), alg = JSON.parse(readFileSync(new URL('../config/algoritmo.json', import.meta.url), 'utf8'))
  for (const k of ['ruptura_dias', 'lead_time_dias_premissa', 'full_dias_sem_venda', 'reputacao_limites_pct', 'reputacao_fracao_limite', ...Object.keys(alg.limiares)]) assert.ok(!(k in bruto), `gatilhos.json não repete ${k}`)
  const dup = JSON.parse(JSON.stringify(cfg)); dup.ruptura_dias = 10; assert.throws(() => validarConfig(dup), /limiar próprio/)
  assert.equal(cfg.gatilhos.preco_alterado_drastico.sem_resolucao, true); assert.equal(cfg.gatilhos.oferta_terminando.sem_resolucao, true); assert.ok(!cfg.gatilhos.preco_alterado_drastico.template.includes('{vendas}'), 'preço: só o fato, sem frase causal')
  assert.equal(listaNomes(['Ração Premium 15kg', 'B', 'C', 'D', 'E']), 'Ração Premium 15kg, B e C e mais 2')
  assert.equal(listaNomes(['A', 'A', 'B', 'C', 'C', 'D', 'E', 'E'], 3, ['anúncio', 'anúncios']), 'A, B e C e mais 3 anúncios', 'com unidade, o «e mais N» conta anúncios (fecha com o {n} do texto), não nomes')
  assert.equal(dentroDaJanela('10:00', { janela: cfg.janela, silencio: cfg.silencio_padrao }), true); assert.equal(dentroDaJanela('22:30', { janela: cfg.janela, silencio: cfg.silencio_padrao }), false)
  assert.equal(dentroDaJanela('08:00', { janela: cfg.janela, silencio: { de: '21:00', ate: '09:00' } }), false, 'silêncio que cruza a meia-noite')
})

// 12/10 (mudança de propósito): queda_por_preco não nasce aqui (a ação PS-a3 não traz evidencia_preco: sem número não nasce; ver o bloco do preço); os 4 tipos de dono
// 'assessoria' nascem no estado 'interno' (nunca pendente/agrupado); textos novos de reposição (nome: ~dias, repor ~qtd + premissa), sugestão de envio ao Full (da ação full_envio) e preço (fora das ações da Place2u)
await ok('cada um dos 16 tipos dispara (15 na 1ª passada + queda moderada na 2ª) com classe do catálogo, texto auditado e sem ID interno; depois todos resolvem', async () => {
  const m = mundo(); m.tudo('Acme')
  let r = await m.g.avaliar('Acme')
  const tipos = r.itens.map(i => i.tipo).sort()
  assert.equal(r.novos, 15); assert.equal(r.suprimidos, 0)
  assert.deepEqual(tipos, TIPOS.filter(t => !['queda_conta', 'queda_por_preco', 'promocao_encerrada', 'estoque_zerado'].includes(t)).sort(), 'promoção encerrada tem bloco próprio (fim de promoção); estoque zerado: scripts/teste-alerta-impacto.mjs')
  const por = Object.fromEntries(r.itens.map(i => [i.tipo, i]))
  assert.equal(por.ruptura_curva_a.texto, '• Ração Premium 15kg: tem 8 un (~2 dias)\nQuando o estoque zera, o anúncio pausa e sai da busca até a reposição chegar, e as vendas desses dias não voltam.\nConsideramos 21 dias até a reposição chegar (se for outro prazo, conta pra gente).', 'urgente: só o campeão com ≤ 3 dias (sem previsão de compras no fixture = sem quantidade, sem link); o prazo do R$ sempre declarado (14/10)')
  assert.equal(por.preco_alterado_drastico.classe, 'atencao', 'mudança de preço não herda a frase causal da regra (que mede uma alta de ≥ 7 dias)'); assert.equal(por.preco_alterado_drastico.texto, 'O preço de Areia para gatos 4kg mudou de R$ 20,00 para R$ 29,99 (+50%) em 13/10, fora das ações da Place2u. Se foi intencional, é só avisar para considerarmos no acompanhamento; se não foi, vale revisar.')
  assert.equal(por.ads_sem_retorno.texto, 'Anúncios pagos: 1 anúncio gastando sem retorno (R$ 120 em 28 dias). Rever lances e campanhas; mudança de verba se combina com o cliente.', 'texto para a equipe (nunca «sua»)')
  assert.equal(por.reputacao_em_risco.texto, 'Nível amarelo; taxa de reclamações em 1,8% (limite 2%). Vale olhar com a gente os pedidos dos últimos dias.'); assert.equal(por.reclamacao_mediacao.texto, '1 reclamação aguardando a sua resposta até 15/10. Responder dentro do prazo evita que ela pese na reputação.')
  assert.equal(por.full_estoque_antigo.texto, '1 produto parado no Full há 60 dias ou mais sem venda: Tapete higiênico 30un.'); assert.equal(por.oferta_terminando.texto, '1 promoção termina até 16/10: Ração Premium 15kg.')
  assert.equal(por.envio_atrasado.texto, '2 pedidos com prazo de despacho vencido. Despachar ainda hoje protege a reputação da sua conta.', 'plural sem «(s)»'); assert.equal(por.perguntas_sem_resposta.texto.slice(0, 13), '2 perguntas d')
  assert.equal(por.dependencia_vencida.texto, 'Documentos e validação da conta: com o seu retorno, a gente segue com esse ponto na sua conta. Enviar os documentos pedidos pela equipe. Se já está encaminhado, é só responder com a data prevista.', 'só a do Mercado Livre (a da Amazon nunca entra); sem «aguardando seu retorno desde»')
  assert.equal(m.rows('Acme').filter(x => x.tipo === 'dependencia_vencida').length, 1, 'a pendência da Amazon (25 dias) não vira linha')
  assert.equal(por.envio_full_sugerido.texto, 'Este anúncio vende bem e ainda está fora do Full: Shampoo Pet 500ml: enviar *12 a 17 un*. É sugestão: nada é movimentado por aqui.', 'singular e quantidade no formato do 📦'); assert.match(por.queda_forte_conta.texto, /^Faturamento caiu 32,4% nos últimos 14 dias contra os 14 anteriores \(leitura de 30\/09 a 13\/10\)/)
  for (const i of r.itens) { assert.ok(i.texto.length > 10, i.tipo); assert.doesNotMatch(i.texto, SEM_ID, i.tipo); assert.deepEqual(auditarTexto(i.texto, { nomesInternos: QUEM, permitidos: ['Acme'] }), [], i.tipo) }
  for (const t of ['ruptura_curva_a', 'envio_atrasado', 'reclamacao_mediacao', 'reputacao_em_risco', 'anuncio_restrito']) assert.equal(por[t].estado, 'pendente', t + ' crítico = pendente (lote imediato)')
  for (const t of ['ciclo_estoque_previsto', 'perguntas_sem_resposta', 'custos_nao_informados', 'dependencia_vencida', 'preco_alterado_drastico', 'envio_full_sugerido', 'full_estoque_antigo']) assert.equal(por[t].estado, 'agrupado', t + ' = agrupado (plano semanal)')
  for (const t of ['queda_forte_conta', 'oferta_terminando', 'ads_sem_retorno']) assert.deepEqual([por[t].estado, por[t].dono, por[t].motivo_codigo], ['interno', 'assessoria', 'assessoria'], t + ' = só para a equipe')
  // 2ª passada: queda moderada substitui a forte (resolve a forte, nasce queda_conta); o resto deduplica (novos 0 além dela)
  m.D.estado.set('Acme', { ...quedaForte(), forca: 'moderada', variacao_pct: -14 })
  r = await m.g.avaliar('Acme'); assert.equal(r.novos, 1); assert.equal(r.resolvidos, 1)
  assert.ok(r.itens.some(i => i.tipo === 'queda_conta' && i.estado === 'interno')); assert.ok(!r.itens.some(i => i.tipo === 'queda_forte_conta'))
  assert.equal(m.rows('Acme').find(x => x.tipo === 'queda_forte_conta').estado, 'resolvido')
  r = await m.g.avaliar('Acme'); assert.deepEqual([r.novos, r.resolvidos, r.reabertos], [0, 0, 0], 'mesma leitura = nada novo (dedupe por assinatura)')
  // fonte que sumiu NÃO resolve: sem saúde (sem_coleta) e sem diagnóstico (pendente) só as fontes lidas resolvem (acoes, pendências, estado, promoções = 5); os 9 de saúde/diagnóstico
  // ficam, e o preço também (a curva A/B vem do diagnóstico: sem ele o preço não é lido)
  m.nada('Acme'); r = await m.g.avaliar('Acme'); assert.equal(r.resolvidos, 5); assert.equal(r.itens.length, 10)
  assert.equal(r.cobertura.saude, 'pendente:sem_coleta'); assert.match(r.cobertura.diagnostico, /^pendente:/)
  assert.deepEqual([...new Set(r.itens.map(i => lerConfig().gatilhos[i.tipo].fonte))].sort(), ['diagnostico', 'preco', 'saude'], 'só itens de fonte não lida sobram')
  // saúde do dia pendente só no bloco atrasos: resolve os outros 4 de saúde, mantém envio_atrasado; diagnóstico vazio resolve os 4 dele
  const sp = saudeLimpa(); sp.pendente = { atrasos: 'indisponivel' }; m.D.saude.set('Acme', sp); m.D.diag.set('Acme', { disponivel: true, itens: [] })
  r = await m.g.avaliar('Acme'); assert.equal(r.resolvidos, 9); assert.deepEqual(r.itens.map(i => i.tipo), ['envio_atrasado'], 'bloco pendente não resolve o tipo dele')
  m.D.saude.set('Acme', saudeLimpa()); r = await m.g.avaliar('Acme'); assert.equal(r.resolvidos, 1); assert.equal(r.itens.length, 0)
  assert.ok(m.rows('Acme').every(x => x.estado === 'resolvido' && x.resolvido_em), 'tudo resolvido quando as fontes lidas deixam de apontar')
  assert.ok(m.rows('Acme').filter(x => ['preco_alterado_drastico', 'oferta_terminando'].includes(x.tipo)).every(x => x.avisado_resolucao === 1), 'tipos de janela nunca viram «Resolvido»')
  assert.ok(m.rows('Acme').every(x => x.cliente === 'Acme')); assert.equal(m.rows('Beta').length, 0, 'isolamento por cliente')
})

await ok('auditor: título de produto com promessa suprime o item (conteudo:promessa), texto vazio, nunca sai; estoque sem leitura não vira gatilho', async () => {
  const m = mundo(); const d = diagCompleto(); d.itens[0].titulo = 'Ração top 1 vendas garantidas'; m.D.diag.set('Acme', d)
  const r = await m.g.avaliar('Acme')
  const rup = r.itens.find(i => i.tipo === 'ruptura_curva_a')
  assert.equal(rup.estado, 'suprimido'); assert.match(rup.motivo_codigo, /^conteudo:/); assert.match(rup.motivo_codigo, /promessa/); assert.equal(rup.texto, '')
  assert.ok(m.logs.some(l => /ruptura_curva_a suprimido por conteúdo/.test(l))); assert.ok(!m.logs.some(l => /garantidas/.test(l)), 'o trecho não vai ao log')
  const l = m.g.montarLote('Acme', 'imediato', { gravar: false }); assert.equal(l.n, 1, 'só o anúncio restrito entra'); assert.ok(!l.itens.some(i => i.tipo === 'ruptura_curva_a') && !/garantid/i.test(l.texto_final), 'item suprimido nunca entra em lote')
  m.D.diag.set('Acme', { disponivel: true, itens: [{ id: 'MLB1', titulo: 'X', curva: 'A', status: 'active', cobertura: null, estoque: null, r: 10 }] })
  const r2 = await m.g.avaliar('Acme'); assert.ok(!r2.itens.some(i => i.tipo === 'ruptura_curva_a'), 'cobertura null = sem leitura, não zero')
})

await ok('um só motor: reputação exige amostra mínima e usa os limiares do Algoritmo; anúncio restrito = pausado/revisão/inativo com impacto mínimo (closed e irrelevante não); Full exige disponível > 0 e bloco lido; saúde velha (do_dia false) não nasce nem resolve', async () => {
  const m = mundo(), rep = (extra, vendas) => ({ ...saudeLimpa(), reputacao: { nivel: '5_green', taxa_claims: 0.1, taxa_atraso: 0.5, taxa_cancel: 0.1, vendas_periodo: vendas, ...extra } })
  const tipos = async () => (await m.g.avaliar('Acme')).itens.filter(i => i.estado !== 'resolvido').map(i => i.tipo)
  m.D.saude.set('Acme', rep({ taxa_claims: 50 }, 2)); assert.deepEqual(await tipos(), [], '1 reclamação em 2 vendas: sem amostra (reputacao_min_vendas) não é risco')
  m.D.saude.set('Acme', rep({ taxa_atraso: 7 }, 500)); assert.deepEqual(await tipos(), [], 'atraso 7% com limite do Algoritmo 15%: nada (o limite 8% próprio foi apagado)')
  m.D.saude.set('Acme', rep({ nivel: '4_light_green', taxa_claims: 0, taxa_atraso: 0, taxa_cancel: 0 }, 500)); assert.deepEqual(await tipos(), [], 'verde-claro com taxas em 0%: não é aviso ao cliente')
  m.D.saude.set('Acme', rep({ nivel: '3_yellow', taxa_claims: 0 }, 500)); assert.equal((await m.g.avaliar('Acme')).itens.find(i => i.tipo === 'reputacao_em_risco')?.texto, 'Nível amarelo no termômetro de reputação do Mercado Livre. Vale olhar com a gente os pedidos dos últimos dias.', 'amarelo sem taxa alta: sem "0% (limite 2%)"')
  m.D.saude.set('Acme', saudeLimpa()); await m.g.avaliar('Acme')
  m.D.saude.set('Acme', rep({ taxa_claims: 1.8 }, 500)); let r = await m.g.avaliar('Acme'); assert.equal(r.itens.find(i => i.tipo === 'reputacao_em_risco')?.texto, 'Nível verde; taxa de reclamações em 1,8% (limite 2%). Vale olhar com a gente os pedidos dos últimos dias.')
  // saúde velha: nem detecta nem resolve o que está vivo
  m.D.saude.set('Acme', { ...saudeCompleta(), dia: '2026-09-14', do_dia: false }); r = await m.g.avaliar('Acme')
  assert.equal(r.cobertura.saude, 'pendente:leitura_velha'); assert.deepEqual([r.novos, r.resolvidos], [0, 0]); assert.equal(r.itens.find(i => i.tipo === 'reputacao_em_risco')?.estado, 'pendente', 'o item vivo fica como está')
  assert.ok(!r.itens.some(i => i.tipo === 'envio_atrasado'), 'despacho vencido de um mês atrás não vira "hoje"')
  m.D.saude.set('Acme', saudeLimpa()); r = await m.g.avaliar('Acme'); assert.equal(r.resolvidos, 1)
  // anúncio restrito e Full
  m.D.diag.set('Acme', { disponivel: true, itens: [{ id: 'MLB1', titulo: 'Grande', curva: 'A', status: 'active', r: 5000, r0: 5000 }, { id: 'MLB2', titulo: 'Fechado', curva: 'B', status: 'closed', r: 0, r0: 300 }, { id: 'MLB3', titulo: 'Pausado mínimo', curva: 'C', status: 'paused', r: 0, r0: 5 }] })
  assert.deepEqual(await tipos(), [], 'closed (decisão do cliente) e pausado com r0 abaixo de 0,5% do GMV não disparam')
  m.D.diag.set('Acme', { disponivel: true, itens: [{ id: 'MLB1', titulo: 'Grande', curva: 'A', status: 'active', r: 5000, r0: 5000 }, { id: 'MLB4', titulo: 'Pausado relevante', curva: 'B', status: 'paused', r: 0, r0: 400 }] })
  assert.deepEqual(await tipos(), ['anuncio_restrito'])
  const sf = saudeLimpa(); sf.listas.full = [{ item_id: 'MLB9', inventory_id: 'INV9', disponivel: 0, dias_sem_venda: 90 }, { item_id: 'MLB8', inventory_id: 'INV8', disponivel: 3, dias_sem_venda: 20, idade_dias: 70 }]; m.D.saude.set('Acme', sf)
  r = await m.g.avaliar('Acme'); const full = r.itens.find(i => i.tipo === 'full_estoque_antigo'); assert.equal(full.texto, '1 produto parado no Full há 60 dias ou mais sem venda: produto em Full.', 'sem disponível não conta; idade_dias vale antes da estimativa')
  sf.pendente = { full: 'indisponivel' }; m.D.saude.set('Acme', sf); r = await m.g.avaliar('Acme'); assert.equal(r.resolvidos, 0); assert.equal(r.itens.find(i => i.tipo === 'full_estoque_antigo')?.estado, 'agrupado', 'bloco Full pendente: nem nasce nem resolve')
  // trava de 12/10: o produto que vendeu nos últimos 28 dias nunca é «parado no Full»; sem o diagnóstico não dá para conferir — não nasce nem resolve
  delete sf.pendente; m.D.saude.set('Acme', sf); const dg = m.D.diag.get('Acme'); m.D.diag.set('Acme', { ...dg, itens: [...dg.itens, { id: 'MLB8', titulo: 'Vendeu', curva: 'C', status: 'active', u: 2, r: 60 }] })
  r = await m.g.avaliar('Acme'); assert.ok(!r.itens.some(i => i.tipo === 'full_estoque_antigo'), 'vendeu em 28 dias: resolve, nunca parado'); assert.equal(m.rows('Acme').find(x => x.tipo === 'full_estoque_antigo').estado, 'resolvido')
  m.D.diag.set('Acme', dg); await m.g.avaliar('Acme'); m.D.diag.delete('Acme'); r = await m.g.avaliar('Acme')
  assert.equal(r.itens.find(i => i.tipo === 'full_estoque_antigo')?.estado, 'agrupado', 'sem diagnóstico (não sei quem vendeu): a linha fica como está')
})

await ok('elegível: chave global nasce desligada; exige cliente Ativo, canal ligado, liberação por líder e janela/silêncio no fuso do cliente (processo em Pacific/Auckland)', async () => {
  const m = mundo()
  assert.equal(new Date(m.rl.ms).getHours() !== 10, true, 'o processo NÃO está em São Paulo')
  assert.deepEqual(m.g.chaveEstado(), { ligado: false, por: '' })
  assert.deepEqual(m.g.elegivel('Acme'), { ok: false, motivo: 'sem_canal' })
  m.configurar('Acme'); assert.deepEqual(m.g.elegivel('Acme'), { ok: false, motivo: 'interruptor_desligado' })
  assert.throws(() => m.g.chave({ ligado: true, por: 'Fulano' }), e => e.status === 403 && !/Fulano/.test(e.message))
  assert.throws(() => m.g.chave({ ligado: 'true', por: POR }), /verdadeiro ou falso/)
  m.ligar(); assert.deepEqual(m.g.elegivel('Acme'), { ok: false, motivo: 'nao_liberado' })
  assert.deepEqual(m.liberar('Beta'), { ok: true, liberar: true, liberados: [], ignorados: [{ cliente: 'Beta', motivo: 'sem_canal' }] }, 'sem canal não libera')
  assert.deepEqual(m.liberar('Acme').liberados, ['Acme']); assert.deepEqual(m.g.elegivel('Acme'), { ok: true })
  assert.equal(m.g.notificacao('Acme').liberado_por, POR)
  m.rl.ir('2026-10-14', '22:00'); assert.deepEqual(m.g.elegivel('Acme'), { ok: false, motivo: 'fora_da_janela' }, '22:00 em São Paulo: fora da janela 07–21')
  m.rl.ir('2026-10-14', '06:30'); assert.deepEqual(m.g.elegivel('Acme'), { ok: false, motivo: 'fora_da_janela' })
  m.rl.ir('2026-10-14', '10:00'); m.configurar('Acme', undefined, { silencio: { de: '09:00', ate: '11:00' } }); assert.deepEqual(m.g.elegivel('Acme'), { ok: false, motivo: 'fora_da_janela' }, 'silêncio do cliente')
  m.configurar('Acme', undefined, { silencio: { de: '21:00', ate: '07:00' }, fuso: 'America/Manaus' }); assert.deepEqual(m.g.elegivel('Acme'), { ok: true }, '10:00 SP = 09:00 Manaus, dentro')
  m.rl.ir('2026-10-14', '07:30'); assert.deepEqual(m.g.elegivel('Acme'), { ok: false, motivo: 'fora_da_janela' }, '07:30 SP = 06:30 Manaus: antes da janela do cliente')
  assert.equal(m.g.notificacao('Acme').liberado_por, POR, 'reconfigurar ritmo/silêncio/fuso preserva a liberação')
  m.configurar('Acme', { whatsapp: { ligado: true, destino: '120363012345678902@g.us' } }); assert.equal(m.g.notificacao('Acme').liberado_por, '', 'destino novo = liberação revogada (quem liberou leu outro grupo)')
  assert.deepEqual(m.g.elegivel('Acme'), { ok: false, motivo: 'nao_liberado' }); m.liberar('Acme'); assert.equal(m.g.notificacao('Acme').liberado_por, POR)
  assert.deepEqual(m.g.elegivel('Congelado'), { ok: false, motivo: 'cliente_inelegivel' })
  m.g.chave({ ligado: false, por: POR }); m.rl.ir('2026-10-14', '10:00'); assert.deepEqual(m.g.elegivel('Acme'), { ok: false, motivo: 'interruptor_desligado' })
  assert.deepEqual(m.g.elegivel('Acme', { manual: true }), { ok: true }, 'manual ignora chave, janela e liberação (exige canal e Ativo)')
})

await ok('validarNotificacao: lista fechada (WhatsApp, e-mail, Notion — o Discord do cliente é interno e saiu em 12/10), só o grupo …@g.us, e-mail, nome na mensagem; erro nunca ecoa o valor; notion só ligado', () => {
  const cfg = lerConfig()
  assert.deepEqual(CANAIS, ['whatsapp', 'email', 'notion'])
  const v = validarNotificacao({ canais: { whatsapp: { ligado: true, destino: '120363012345678901@g.us' }, email: { ligado: false, destino: 'dono@loja.com.br' }, notion: { ligado: true, destino: 'ignorado' } }, ritmo: { resumo_hora: '09:30' }, rotulo: ' União Dog ' }, cfg)
  assert.deepEqual(v.canais.notion, { ligado: true }); assert.deepEqual(v.ritmo, { critico_na_hora: false }, 'a hora do resumo diário acabou (ignorada); o urgente na hora NASCE DESLIGADO (12/10/2026: só semanal)'); assert.deepEqual(v.silencio, cfg.silencio_padrao); assert.equal(v.rotulo, 'União Dog')
  assert.ok(!('discord' in v.canais))
  assert.equal(validarNotificacao({ canais: { whatsapp: { ligado: true, destino: '120363012345678901@g.us' } } }, cfg).canais.whatsapp.destino, '120363012345678901@g.us', 'grupo do ML («Id whatsapp meli») é aceito')
  // SÓ o grupo (12/10): número E.164 ou contato digitado à mão nunca vira destino ao cliente
  for (const d of ['+5513999990000', '5513999990000@s.whatsapp.net']) assert.throws(() => validarNotificacao({ canais: { whatsapp: { ligado: true, destino: d } } }, cfg), e => /WhatsApp inválido/.test(e.message) && !e.message.includes(d), d)
  for (const [b, rx, eco] of [
    [{ canais: { whatsapp: { ligado: true, destino: '13999990000' } } }, /WhatsApp inválido/, '13999990000'],
    [{ canais: { whatsapp: { ligado: true, destino: 'abc@g.us' } } }, /WhatsApp inválido/, 'abc@g.us'], [{ silencio: { de: '07:00', ate: '07:00' } }, /início e fim não podem ser iguais/, null],
    [{ canais: { whatsapp: { ligado: true, destino: '' } } }, /ligado sem destino/, null],
    [{ canais: { email: { ligado: true, destino: 'sem-arroba' } } }, /e-mail inválido/, 'sem-arroba'],
    [{ canais: { discord: { ligado: true, destino: 'https://discord.com/api/webhooks/1234567890123/abcdefghijklmnopqrstuvwxyz' } } }, /fora da lista/, 'discord.com'],
    [{ canais: { telegram: { ligado: true } } }, /fora da lista/, null], [{ extra: 1 }, /fora da lista/, null], [{ fuso: 'Marte/Base' }, /IANA/, null],
    [{ rotulo: 'x'.repeat(61) }, /rotulo/, null], [{ rotulo: '*Promo* top' }, /rotulo/, 'Promo'], [{ rotulo: 'Linha\nquebrada' }, /rotulo/, 'quebrada'],
  ]) assert.throws(() => validarNotificacao(b, cfg), e => rx.test(e.message) && (!eco || !e.message.includes(eco)))
})

await ok('lote imediato → envio → recibos por canal (idempotentes): entregue parcial/total; cooldown por tipo depois do envio e reabertura quando vence', async () => {
  const m = mundo(); m.configurar('Acme', { whatsapp: { ligado: true, destino: '120363012345678901@g.us' }, email: { ligado: true, destino: 'dono@loja.com.br' } }); m.liberar('Acme'); m.ligar()
  m.D.diag.set('Acme', diagCompleto()); await m.g.avaliar('Acme')
  const l = m.g.montarLote('Acme', 'imediato')
  assert.equal(l.estado, 'montado'); assert.equal(l.n, 2, 'ruptura + anúncio restrito (urgentes)'); assert.equal(l.titulo, 'Ponto importante da conta · 14/10/2026 · 10:00')
  const ls = l.texto_final.split('\n')
  assert.equal(ls[0], 'Oi, time Acme! Passando rapidinho com pontos importantes da sua conta no Mercado Livre:'); assert.match(ls[2], /^\*1\.\* 📦 \*Estoque acabando nos campeões de venda\*$/)
  assert.ok(ls.includes(ASSINATURA)); assert.equal(ls.at(-1), NOTA, 'há quantidade estimada (ruptura): a nota de estimativa fecha a mensagem')
  assert.doesNotMatch(l.texto_final, SEM_ID); assert.doesNotMatch(l.texto_final, ANTIGO); assert.deepEqual(auditaMsg(l.texto_final), [])
  const r = await m.g.enviarLote(l.id)
  assert.deepEqual([r.ok, r.estado], [true, 'enviado']); assert.equal(m.envios.length, 1); assert.deepEqual(m.envios[0].canais, ['whatsapp', 'email']); assert.equal(m.envios[0].lote.texto, l.texto_final)
  assert.ok(m.rows('Acme').filter(x => x.lote_id === l.id).every(x => x.estado === 'enviado' && x.enviado_em))
  const r2 = await m.g.enviarLote(l.id); assert.equal(r2.motivo, 'ja_enviado')
  assert.deepEqual(m.g.registrarRecibo({ lote_id: l.id, canal: 'whatsapp', estado: 'entregue', em: m.rl.agora() }), { ok: true, duplicado: false })
  assert.equal(m.lotes('Acme')[0].estado, 'enviado', 'ainda falta o recibo do e-mail'); assert.ok(m.rows('Acme').filter(x => x.lote_id === l.id).every(x => x.estado === 'entregue'))
  assert.deepEqual(m.g.registrarRecibo({ lote_id: l.id, canal: 'whatsapp', estado: 'entregue', em: m.rl.agora() }), { ok: true, duplicado: true })
  assert.deepEqual(m.g.registrarRecibo({ lote_id: l.id, canal: 'email', estado: 'falhou', em: m.rl.agora() }), { ok: true, duplicado: false }); assert.equal(m.lotes('Acme')[0].estado, 'parcial')
  assert.deepEqual(m.g.registrarRecibo({ lote_id: 'nao-existe', canal: 'email', estado: 'entregue' }), { ok: false, motivo: 'lote_desconhecido' })
  assert.deepEqual(m.g.registrarRecibo({ lote_id: l.id, canal: 'sms', estado: 'entregue' }), { ok: false, motivo: 'canal_invalido' })
  // cooldown: a ruptura muda (mais um produto) → assinatura nova → suprimido por cooldown (crítico = 1 dia); 2 dias depois reabre como pendente
  const d = diagCompleto(); d.itens.push({ id: 'MLB10', titulo: 'Petisco natural', curva: 'A', status: 'active', cobertura: 2, estoque: 2, ponto_reposicao: 10, r: 1400, r0: 1400 }); m.D.diag.set('Acme', d)
  let a = await m.g.avaliar('Acme'); const nova = a.itens.find(i => i.tipo === 'ruptura_curva_a')
  assert.deepEqual([nova.estado, nova.motivo_codigo], ['suprimido', 'cooldown']); assert.equal(m.rows('Acme').filter(x => x.tipo === 'ruptura_curva_a').length, 2); assert.equal(m.rows('Acme').find(x => x.tipo === 'ruptura_curva_a').estado, 'resolvido')
  assert.equal(m.g.montarLote('Acme', 'imediato', { gravar: false }).vazio, true, 'urgente em cooldown não sai')
  m.rl.avancarDias(2); a = await m.g.avaliar('Acme'); assert.equal(a.reabertos, 1); assert.equal(a.itens.find(i => i.tipo === 'ruptura_curva_a').estado, 'pendente')
})

await ok('parcial (Notion entregue, n8n falhou): o lote FICA parcial, itens pendentes com enviado_em (cooldown vale), aparece em falhas, equipe avisada; retry só após retry_min; lote concorrente sai uma vez', async () => {
  const m = mundo(); m.configurar('Acme', { whatsapp: { ligado: true, destino: '120363012345678901@g.us' }, notion: { ligado: true } }); m.liberar('Acme'); m.ligar()
  m.D.diag.set('Acme', diagCompleto()); await m.g.avaliar('Acme')
  const l = m.g.montarLote('Acme', 'imediato')
  m.envio.resposta = { estado: 'parcial', motivo: 'n8n_500', recibos: { notion: { estado: 'entregue', em: m.rl.agora() } } }
  const r = await m.g.enviarLote(l.id); assert.deepEqual([r.ok, r.estado, r.motivo], [false, 'parcial', 'n8n_500'])
  const lote = m.lotes('Acme')[0]; assert.equal(lote.estado, 'parcial', 'fecharLote não promove parcial a enviado'); assert.equal(lote.motivo, 'n8n_500')
  const itens = m.rows('Acme').filter(x => x.lote_id === l.id); assert.ok(itens.length >= 1); assert.ok(itens.every(x => x.estado === 'pendente' && x.motivo === 'n8n_500' && x.enviado_em), 'item não vira entregue sem recibo do canal; enviado_em marca o canal que entregou')
  assert.deepEqual(m.g.listarGeral().falhas.map(x => x.id), [l.id], 'aparece na tabela de falhas'); assert.equal(m.notifs.length, 1); assert.match(m.notifs[0].titulo, /não entregue em todos os canais/)
  assert.equal((await m.g.enviarLote(l.id)).motivo, 'retry_janela')
  m.envio.resposta = null; m.rl.ms += 6 * 60_000
  // dois envios do MESMO lote ao mesmo tempo (tick + clique): um só POST ao n8n
  const lento = m.envio.enviar; m.envio.enviar = async a => { await new Promise(r => setTimeout(r, 30)); return lento(a) }
  const [a1, a2] = await Promise.all([m.g.enviarLote(l.id, { origem: 'timer' }), m.g.enviarLote(l.id, { origem: 'manual' })])
  assert.deepEqual([a1.estado, a2.motivo], ['enviado', 'retry_janela']); assert.equal(m.envios.length, 2, '1 POST do parcial + 1 do reenvio (o concorrente não postou)')
  assert.equal(m.lotes('Acme')[0].estado, 'enviado'); assert.ok(m.rows('Acme').filter(x => x.lote_id === l.id).every(x => ['enviado', 'entregue'].includes(x.estado)), 'saiu pelo n8n; o recibo do Notion já marcava entregue')
})

await ok('prévia com o plano da semana já existente (pendente): devolve ESSE lote (mesmo hash); hash de outra prévia = 409 sem lote novo; confirmar com o hash certo reenvia o lote; ponto novo espera a próxima segunda', async () => {
  const m = mundo(); m.pronto('Acme'); m.D.saude.set('Acme', { ...saudeLimpa(), perguntas: { abertas: 2, mais_de_24h: 2 }, listas: { ...saudeLimpa().listas, perguntas: [{ question_id: 'q1', mais_de_24h: 1 }, { question_id: 'q2', mais_de_24h: 1 }] } })
  m.envio.resposta = { estado: 'pendente', motivo: 'n8n_nao_configurado', recibos: {} }; m.envio.configurado = () => false
  m.rl.ir('2026-10-19', '09:10'); let t = await m.g.tick(); assert.equal(t.semanais, 1)
  const plano = m.lotes('Acme').find(l => l.tipo === 'semanal'); assert.equal(plano.estado, 'pendente'); assert.match(plano.texto_final, /💬 \*Responder as perguntas dos compradores\*\n2 perguntas de compradores/)
  assert.ok(plano.texto_final.startsWith(ABERTURA)); assert.equal(plano.dia, '2026-10-19')
  // 15:00: nasce um ponto novo (ciclo de reposição); a prévia mostra o plano desta semana que já existe, não um texto que não vai sair
  m.rl.ir('2026-10-19', '15:00'); m.D.diag.set('Acme', { disponivel: true, itens: [{ id: 'MLB2', titulo: 'Coleira Pet ajustável', curva: 'B', status: 'active', cobertura: 15, estoque: 30, ponto_reposicao: 40, r: 500, r0: 480 }] }); await m.g.avaliar('Acme')
  const p = await m.g.enviar({ cliente: 'Acme', confirmar: false }); assert.equal(p.ja_existia, true); assert.equal(p.hash, plano.hash); assert.equal(p.texto_final, plano.texto_final); assert.equal(p.estado, 'pendente')
  const pv = await m.g.enviar({ cliente: 'Acme', tipo: 'semanal', confirmar: false }); assert.equal(pv.hash, plano.hash, 'tipo semanal explícito = o mesmo')
  await assert.rejects(m.g.enviar({ cliente: 'Acme', confirmar: true, por: POR, hash: 'f'.repeat(16) }), e => e.status === 409); assert.equal(m.lotes('Acme').length, 1, '409 não deixa lote para trás')
  m.envio.resposta = null; m.envio.configurado = () => true; m.rl.ir('2026-10-19', '15:10')
  const r = await m.g.enviar({ cliente: 'Acme', confirmar: true, por: POR, hash: p.hash }); assert.deepEqual([r.ok, r.estado, r.lote_id], [true, 'enviado', plano.id]); assert.equal(m.envios.at(-1).lote.hash, p.hash, 'saiu exatamente o que o líder leu')
  assert.equal(m.envios.at(-1).lote.titulo, 'Plano da semana · 19/10/2026')
  assert.equal(m.rows('Acme').find(x => x.tipo === 'ciclo_estoque_previsto').lote_id, '', 'o ponto novo espera o plano da próxima segunda (1 plano por semana)')
})

await ok('tick retenta mensagem do dia pendente/falhou quando o n8n volta (retry_min); urgente de ontem que não saiu vence e os pontos voltam à fila; avalia só cliente liberado ou com canal', async () => {
  const m = mundo({ clientes: [['Acme', 'Ativo'], ['Beta', 'Ativo'], ['Gama', 'Ativo']] }); m.pronto('Acme'); m.tudo('Beta'); m.tudo('Gama'); m.configurar('Beta')
  m.D.saude.set('Acme', saudeCompleta()); m.envio.resposta = { estado: 'falhou', motivo: 'n8n_rede', recibos: {} }
  m.rl.ir('2026-10-19', '10:00'); let t = await m.g.tick(); assert.deepEqual([t.avaliados, t.imediatos, t.semanais], [2, 0, 1], 'segunda 10:00: o plano sai primeiro e leva os 3 urgentes (uma mensagem só); Gama (Ativo, sem canal, não liberado) não é avaliado no tick')
  assert.equal(m.rows('Gama').length, 0); assert.ok(m.lotes('Acme').every(l => l.estado === 'falhou' && l.motivo === 'n8n_rede')); assert.equal(m.notifs.filter(x => x.tipo === 'gatilho_falhou').length, 1, 'equipe avisada por mensagem que falhou')
  assert.match(m.lotes('Acme')[0].texto_final, /🚚 \*Pedido com despacho vencido\*[\s\S]+⚠️ \*Reclamação aguardando a sua resposta\*[\s\S]+🛡️ \*Reputação pedindo atenção\*/, 'os urgentes no topo do plano')
  m.envio.resposta = null; m.rl.ir('2026-10-19', '10:03'); t = await m.g.tick(); assert.deepEqual([t.retentados, t.imediatos, t.semanais], [0, 0, 0], 'dentro de retry_min: espera'); assert.ok(m.lotes('Acme').every(l => l.estado === 'falhou'))
  m.rl.ir('2026-10-19', '10:20'); t = await m.g.tick(); assert.deepEqual([t.retentados, t.imediatos, t.semanais], [1, 0, 0], 'n8n voltou: a MESMA mensagem sai'); assert.ok(m.lotes('Acme').every(l => l.estado === 'enviado')); assert.equal(m.envios.length, 2)
  assert.ok(m.rows('Acme').filter(x => x.lote_id).every(x => x.estado === 'enviado'))
  // novo urgente que falha às 20:00 e o n8n só volta amanhã: a mensagem de ontem vence, o ponto volta para a fila e sai numa mensagem nova (de hoje)
  m.D.diag.set('Acme', { disponivel: true, itens: [{ id: 'MLB1', titulo: 'Grande', curva: 'A', status: 'active', r: 5000, r0: 5000 }, { id: 'MLB4', titulo: 'Pausado relevante', curva: 'B', status: 'paused', r: 0, r0: 400 }] }); m.envio.resposta = { estado: 'falhou', motivo: 'n8n_timeout', recibos: {} }
  // (14/10: no dia do plano — segunda, nesta mecânica — quem recebe o plano não recebe urgente; o cenário vai para terça e quarta)
  m.rl.ir('2026-10-19', '20:00'); t = await m.g.tick(); assert.deepEqual([t.imediatos, t.semanais], [0, 0], 'dia do plano: nenhum urgente para quem recebe o plano')
  m.rl.ir('2026-10-20', '20:00'); t = await m.g.tick(); assert.deepEqual([t.imediatos, t.semanais], [1, 0]); const l2 = m.lotes('Acme').at(-1); assert.equal(l2.estado, 'falhou')
  m.envio.resposta = null; m.rl.ir('2026-10-21', '07:30'); t = await m.g.tick()
  const l2d = m.lotes('Acme').find(l => l.id === l2.id); assert.deepEqual([l2d.estado, l2d.motivo], ['falhou', 'lote_vencido'])
  assert.equal(t.retentados, 0, 'mensagem de ontem não é reenviada'); assert.equal(t.imediatos, 1, 'o ponto preso saiu numa mensagem nova de hoje'); assert.equal(t.semanais, 0, 'quarta: o plano não sai')
  const q = m.rows('Acme').find(x => x.tipo === 'anuncio_restrito'); assert.equal(q.estado, 'enviado'); assert.notEqual(q.lote_id, l2.id); assert.ok(q.lote_id); assert.equal(m.lotes('Acme').at(-1).dia, '2026-10-21')
})

await ok('plano semanal: só segunda 09:00–20:00 no fuso do cliente, idempotente por semana ISO; fora da janela espera a próxima segunda (nunca «recupera» em outro dia); o não urgente que continua volta no plano seguinte; sem diagnóstico não há plano', async () => {
  assert.deepEqual(['2026-10-19', '2026-10-25', '2026-10-26', '2027-01-01', '2026-01-01', '2024-12-30', '2026-12-28'].map(semanaIso), ['2026-W43', '2026-W43', '2026-W44', '2026-W53', '2026-W01', '2025-W01', '2026-W53'])
  const m = mundo(); m.pronto('Acme'); m.D.acoes.set('Acme', acoesCompletas()); m.plano('Acme', { custosInformados: false })   // custos (cliente) + ads (assessoria, interno)
  for (const [d, h] of [['2026-10-19', '08:50'], ['2026-10-18', '10:00'], ['2026-10-14', '09:10'], ['2026-10-20', '09:10']]) { m.rl.ir(d, h); const t = await m.g.tick(); assert.equal(t.semanais, 0, `${d} ${h}: fora da janela do plano`) }
  m.rl.ir('2026-10-19', '09:10'); let t = await m.g.tick(); assert.equal(t.semanais, 1)
  let l = m.lotes('Acme').at(-1); assert.equal(l.tipo, 'semanal'); assert.match(l.texto_final, /\*1\.\* 📊 \*Compartilhar a planilha de custos para darmos o próximo passo\*/); assert.ok(!l.texto_final.includes('Anúncios pagos'), 'interno nunca entra')
  const custos = () => m.rows('Acme').find(x => x.tipo === 'custos_nao_informados')
  assert.deepEqual([custos().lote_id, custos().estado], [l.id, 'enviado'])
  for (const [d, h] of [['2026-10-19', '09:20'], ['2026-10-19', '19:50'], ['2026-10-20', '09:10'], ['2026-10-25', '09:10']]) { m.rl.ir(d, h); t = await m.g.tick(); assert.equal(t.semanais, 0, `${d} ${h}: o plano desta semana já saiu`) }
  m.rl.ir('2026-10-21', '11:00'); assert.equal(m.g.montarLote('Acme', 'semanal').ja_existia, true, 'idempotente por (cliente, semana ISO), em qualquer dia da semana')
  // a condição continua: o plano da segunda seguinte leva de novo (é o plano da semana, não um aviso único) — mesma linha, sem duplicata
  m.rl.ir('2026-10-26', '09:10'); t = await m.g.tick(); assert.equal(t.semanais, 1); l = m.lotes('Acme').at(-1)
  assert.equal(l.dia, '2026-10-26'); assert.match(l.texto_final, /planilha de custos/); assert.equal(m.rows('Acme').filter(x => x.tipo === 'custos_nao_informados').length, 1); assert.equal(custos().lote_id, l.id)
  // segunda inteira sem tick dentro da janela (Mac dormindo): o plano da W45 não sai na terça — espera a segunda seguinte
  m.rl.ir('2026-11-02', '20:30'); t = await m.g.tick(); assert.equal(t.semanais, 0); m.rl.ir('2026-11-03', '09:10'); t = await m.g.tick(); assert.equal(t.semanais, 0, 'sem recuperar em outro dia')
  m.rl.ir('2026-11-09', '09:00'); t = await m.g.tick(); assert.equal(t.semanais, 1, '09:00 em ponto já vale'); assert.equal(m.lotes('Acme').filter(x => x.tipo === 'semanal').length, 3)
  // fuso do cliente: 09:10 em São Paulo = 08:10 em Manaus (fora); 10:10 SP = 09:10 Manaus (dentro)
  const m2 = mundo(); m2.pronto('Acme'); m2.plano('Acme', { custosInformados: false }); m2.configurar('Acme', undefined, { fuso: 'America/Manaus' })
  m2.rl.ir('2026-10-19', '09:10'); assert.equal((await m2.g.tick()).semanais, 0); m2.rl.ir('2026-10-19', '10:10'); assert.equal((await m2.g.tick()).semanais, 1)
  // sem diagnóstico: nada de plano inventado (prévia diz por quê); tenta de novo no próximo tick da mesma segunda
  const m3 = mundo(); m3.pronto('Acme'); m3.D.plano.set('Acme', { disponivel: false, motivo: 'sem dados' }); m3.rl.ir('2026-10-19', '09:10'); assert.equal((await m3.g.tick()).semanais, 0)
  const pv = await m3.g.enviar({ cliente: 'Acme', confirmar: false }); assert.deepEqual([pv.vazio, pv.motivo], [true, 'sem_dados']); assert.match(m3.g.textoMotivo('sem_dados'), /diagnóstico/)
  m3.plano('Acme', { custosInformados: false }); m3.rl.ir('2026-10-19', '09:20'); assert.equal((await m3.g.tick()).semanais, 1, 'o diagnóstico voltou: o plano sai na mesma segunda')
  const n = await m.g.listarCliente('Acme'); assert.equal(n.notificacao.canais.whatsapp.destino_mascarado, 'grupo ••• 8901')
  m.configurar('Acme', { whatsapp: { ligado: true, destino: '120363012345678777@g.us' } }); assert.equal((await m.g.listarCliente('Acme', { reavaliar: false })).notificacao.canais.whatsapp.destino_mascarado, 'grupo ••• 8777')
})

await ok('chave desligada: tick sai no 1º if e nunca toca prospect; segunda antes das 09:00 só o urgente (até 3 pontos); 09:10 o plano sai ANTES do urgente e leva o resto do urgente com as linhas não urgentes do cliente (uma mensagem só); a linha só é marcada se a ação entrou no texto (teto de 5); preço sai uma vez', async () => {
  const m = mundo(); m.tudo('Acme'); m.tudo('Beta'); m.tudo('[Comercial] Loja X · 7')
  assert.deepEqual(await m.g.tick(), { pulou: 'desligado' }); assert.equal(m.envios.length, 0); assert.equal(m.rows('Acme').length, 0, 'chave desligada: nem avalia')
  m.pronto('Acme'); m.configurar('Beta'); m.ligar()                                  // Beta tem canal mas não foi liberado
  // 14/10: o urgente sai na véspera (domingo); no dia do plano (segunda, nesta mecânica) quem recebe o plano não recebe urgente — nem antes das 09:00
  m.rl.ir('2026-10-18', '07:30'); let t = await m.g.tick()
  assert.deepEqual([t.avaliados, t.imediatos, t.semanais], [2, 1, 0], 'domingo: só o urgente do Acme; Beta não liberado; prospect fora')
  assert.equal(m.rows('[Comercial] Loja X · 7').length, 0); assert.throws(() => m.g.elegivel('[Comercial] Loja X · 7'), e => e.status === 404)
  await assert.rejects(m.g.avaliar('[Comercial] Loja X · 7'), e => e.status === 404 && !/Loja X/.test(e.message))
  const urg = m.lotes('Acme')[0]; assert.equal(JSON.parse(urg.itens_ids_json).length, 3, 'urgente: até 3 pontos por mensagem (5 urgentes na fila)')
  assert.match(urg.texto_final, /^Oi, time Acme! Passando rapidinho com pontos importantes/); assert.doesNotMatch(urg.texto_final, ANTIGO); assert.deepEqual(auditaMsg(urg.texto_final), [])
  m.rl.ir('2026-10-19', '07:30'); t = await m.g.tick(); assert.deepEqual([t.imediatos, t.semanais], [0, 0], 'segunda (dia do plano) antes das 09:00: nem o urgente')
  m.rl.ir('2026-10-19', '09:10'); t = await m.g.tick(); assert.deepEqual([t.imediatos, t.semanais], [0, 1], 'os 2 urgentes restantes entram no plano (nunca o mesmo ponto em duas mensagens no mesmo tick)')
  const plano = m.lotes('Acme').find(l => l.tipo === 'semanal'), tipoDe = id => m.rows('Acme').find(x => x.id === id).tipo
  assert.ok(plano.texto_final.startsWith(ABERTURA)); assert.ok(plano.texto_final.endsWith(NOTA)); assert.match(plano.texto_final, /\n\*Plano para manter o ritmo de vendas · Acme · 19\/10\*\n/)
  assert.doesNotMatch(plano.texto_final, SEM_ID); assert.doesNotMatch(plano.texto_final, ANTIGO); assert.deepEqual(auditaMsg(plano.texto_final), [])
  assert.deepEqual(JSON.parse(plano.itens_ids_json).map(tipoDe).sort(), ['envio_full_sugerido', 'perguntas_sem_resposta', 'preco_alterado_drastico', 'reclamacao_mediacao', 'reputacao_em_risco'], 'urgentes pendentes no topo + linhas do cliente com bloco próprio, até 5 ações')
  assert.deepEqual(['estado', 'lote_id'].map(k => m.rows('Acme').find(x => x.tipo === 'dependencia_vencida')[k]), ['agrupado', ''], 'acima do teto de 5 ações: espera a próxima segunda (não é marcada)')
  for (const t0 of ['ciclo_estoque_previsto', 'full_estoque_antigo', 'custos_nao_informados']) assert.deepEqual(['estado', 'lote_id'].map(k => m.rows('Acme').find(x => x.tipo === t0)[k]), ['agrupado', ''], t0 + ': a ação dele (🔄/💡/📊) vem do diagnóstico e não entrou no plano deste fixture — a linha não é marcada como enviada')
  assert.ok(!plano.texto_final.includes('Anúncios pagos') && !/Faturamento|promoção\(ões\) terminam/.test(plano.texto_final), 'nada da assessoria')
  t = await m.g.tick(); assert.deepEqual([t.imediatos, t.semanais], [0, 0], 'mesmo dia: nada de novo')
  // segunda seguinte: o que continua de pé volta; a mudança de preço (janela) já saiu e não repete
  m.rl.ir('2026-10-26', '09:10'); t = await m.g.tick(); assert.equal(t.semanais, 1)
  const p2 = m.lotes('Acme').filter(l => l.tipo === 'semanal').at(-1)
  // 14/10: o anúncio pausado (urgente nesta mecânica) dito há mais de urgente.repeticao_dias e ainda de pé volta, como os outros avisos de estoque (memória por produto)
  assert.deepEqual(JSON.parse(p2.itens_ids_json).map(tipoDe).sort(), ['anuncio_restrito', 'dependencia_vencida', 'envio_full_sugerido', 'perguntas_sem_resposta']); assert.ok(!p2.texto_final.includes('O preço de Areia'))
  const geral = m.g.listarGeral(); assert.deepEqual(geral.liberados.map(x => x.cliente), ['Acme']); assert.equal(geral.automatico.ligado, true); assert.ok(!JSON.stringify(geral).includes('Loja X'))
})

// 12/10 (de propósito): o 3º crítico era a queda forte (agora interna, nunca sai); passou a ser a reputação fora do verde
await ok('teto: 3 lotes imediatos por dia; o 4º fica pendente com teto_diario', async () => {
  const m = mundo(); m.pronto('Acme')
  const passos = [() => m.D.diag.set('Acme', diagCompleto()), () => m.D.saude.set('Acme', { ...saudeCompleta(), listas: { ...saudeCompleta().listas, claims: [] }, reclamacoes: { abertas: 0, mediacoes: 0 }, reputacao: { nivel: '5_green' } }), () => { m.D.saude.get('Acme').reputacao = { nivel: '3_yellow' } }, () => { const s = m.D.saude.get('Acme'); s.listas.claims = saudeCompleta().listas.claims; s.reclamacoes = { abertas: 1, mediacoes: 1 } }]
  for (const [i, p] of passos.entries()) {
    p(); await m.g.avaliar('Acme'); const l = m.g.montarLote('Acme', 'imediato')
    if (i < 3) { assert.equal(l.estado, 'montado', `lote ${i + 1}`); await m.g.enviarLote(l.id) } else { assert.equal(l.teto, true); assert.equal(l.motivo, 'teto_diario'); assert.equal(m.rows('Acme').find(x => x.tipo === 'reclamacao_mediacao').motivo, 'teto_diario') }
  }
  assert.equal(m.lotes('Acme').length, 3)
})

await ok('envio manual: confirmar não-true = prévia (nada gravado); confirmar exige líder (403 sem eco); sem canal = 200 ok:false; com canal envia mesmo com a chave desligada; hash divergente = 409; n8n não configurado = pendente honesto', async () => {
  const m = mundo(); m.tudo('Acme'); await m.g.avaliar('Acme')
  let p = await m.g.enviar({ cliente: 'Acme', confirmar: 'true' }); assert.equal(p.previa, true); assert.equal(p.tipo, 'semanal', 'sem tipo = o plano da semana'); assert.ok(p.texto_final.startsWith(ABERTURA)); assert.equal(m.lotes('Acme').length, 0); assert.deepEqual(p.elegivel, { ok: false, motivo: 'sem_canal' })
  const pu = await m.g.enviar({ cliente: 'Acme', tipo: 'imediato', confirmar: false }); assert.match(pu.texto_final, /^Oi, time Acme!/); assert.equal(pu.titulo, 'Ponto importante da conta · 14/10/2026 · 10:00')
  await assert.rejects(m.g.enviar({ cliente: 'Acme', tipo: 'diario', confirmar: false }), /tipo de lote inválido/, 'o lote diário acabou')
  await assert.rejects(m.g.enviar({ cliente: 'Acme', confirmar: true }), /informe "por"/)
  await assert.rejects(m.g.enviar({ cliente: 'Acme', confirmar: true, por: 'Fulano Z9' }), e => e.status === 403 && !/Z9/.test(e.message))
  let r = await m.g.enviar({ cliente: 'Acme', confirmar: true, por: POR }); assert.deepEqual([r.ok, r.estado], [false, 'sem_canal']); assert.equal(m.lotes('Acme').length, 0)
  m.configurar('Acme'); await assert.rejects(m.g.enviar({ cliente: 'Acme', confirmar: true, por: POR, hash: 'x'.repeat(16) }), e => e.status === 409)
  r = await m.g.enviar({ cliente: 'Acme', confirmar: true, por: POR, hash: p.hash }); assert.deepEqual([r.ok, r.estado], [true, 'enviado']); assert.equal(m.g.chaveEstado().ligado, false, 'manual não depende da chave')
  assert.equal(m.lotes('Acme')[0].origem, 'manual'); assert.equal(m.lotes('Acme')[0].por, POR)
  const t = await m.g.testar({ cliente: 'Acme', canal: 'whatsapp', por: POR }); assert.deepEqual([t.ok, t.estado], [true, 'enviado'])
  assert.deepEqual((await m.g.testar({ cliente: 'Acme', canal: 'notion', por: POR })).estado, 'nao_aplicavel'); assert.equal((await m.g.testar({ cliente: 'Acme', canal: 'email', por: POR })).motivo, 'sem_canal')
  // n8n sem URL/secret: o envio devolve pendente com motivo fixo; itens ficam pendentes, nada "enviado"
  const m2 = mundo(); m2.tudo('Beta'); m2.configurar('Beta'); m2.envio.resposta = { estado: 'pendente', motivo: 'n8n_nao_configurado', recibos: {} }; await m2.g.avaliar('Beta')
  const r2 = await m2.g.enviar({ cliente: 'Beta', confirmar: true, por: POR }); assert.deepEqual([r2.ok, r2.estado, r2.motivo], [false, 'pendente', 'n8n_nao_configurado']); assert.match(r2.mensagem, /PLACE_GATILHOS_URL/)
  assert.ok(m2.rows('Beta').filter(x => x.lote_id).every(x => x.estado === 'pendente' && x.motivo === 'n8n_nao_configurado'))
  const lst = await m2.g.listarCliente('Beta'); assert.equal(lst.ultimo_lote.estado, 'pendente'); assert.match(lst.ultimo_lote.motivo, /n8n/); assert.equal(lst.notificacao.canais.whatsapp.destino_mascarado, 'grupo ••• 8901')
  assert.deepEqual(Object.keys(lst).sort(), ['automatico', 'catalogo', 'cliente', 'cobertura', 'elegivel', 'fila', 'lotes', 'notificacao', 'resolvidos', 'ultimo_lote'])
  assert.ok(!JSON.stringify(m2.logs).includes('120363012345678901@g.us'), 'destino nunca vai a log')
})

// ═════════ alinhamentos com o cliente (PLANO ATIVO 4): o predicado único do núcleo decide; nenhum gatilho nasce para item/regra/conta alinhado ═════════
await ok('alinhamentos: item/regra/conta alinhado não gera aviso; item vivo que passa a ser coberto vira suprimido/alinhado (nunca resolvido, nunca «Resolvido»); ja_informado silencia o aviso e a regra do plano continua; encerrar reabre', async () => {
  const { criarAlinhamentos, SCHEMA_ALINHAMENTO } = await import('../src/lib/alinhamentos.js')
  let A
  const m = mundo({ fontesExtra: { alinhado: c => A.predicado(c, { hoje: '2026-10-14' }) } })
  m.h.exec(SCHEMA_ALINHAMENTO)
  A = criarAlinhamentos({ handle: m.h, hoje: () => '2026-10-14', agora: m.rl.agora, nomesInternos: () => QUEM, validarPor })
  const reg = (c, e) => A.registrar({ cliente: c, por: POR, confirmar: true, ...e })
  const tipos = c => m.rows(c).map(r => r.tipo)
  // 1) alinhado ANTES da 1ª avaliação: o gatilho nem nasce
  m.tudo('Beta')
  reg('Beta', { escopo: 'anuncio', chave: 'MLB1', tipo: 'pausa_producao' })                             // ruptura do MLB1 (único item em ruptura)
  reg('Beta', { escopo: 'anuncio', chave: 'MLB4', tipo: 'ja_informado' })                               // restrito do MLB4: o consultor já falou com o seller
  reg('Beta', { escopo: 'anuncio', chave: 'MLB5', tipo: 'campanha_visibilidade', acos_alvo: 30 })       // Ads do MLB5
  reg('Beta', { escopo: 'conta', tipo: 'intencional', regras: ['reputacao_em_risco'] })                 // conta: regra coberta
  const rb = await m.g.avaliar('Beta')
  for (const t of ['ruptura_curva_a', 'anuncio_restrito', 'ads_sem_retorno', 'reputacao_em_risco']) assert.ok(!tipos('Beta').includes(t), 'nasceu gatilho alinhado: ' + t)
  for (const t of ['ciclo_estoque_previsto', 'envio_atrasado', 'queda_forte_conta', 'preco_alterado_drastico']) assert.ok(tipos('Beta').includes(t), 'o que não está alinhado continua: ' + t)
  assert.equal(rb.alinhados, 0)
  assert.equal(A.alinhado('Beta', { item: 'MLB4', regra: 'anuncio_restrito' }).sim, false, 'ja_informado: a regra do plano continua')
  assert.equal(A.alinhado('Beta', { item: 'MLB4', regra: 'anuncio_restrito', aviso: true }).sim, true, 'ja_informado: o aviso silencia')
  // 2) já avisado, depois alinhado: vira suprimido/alinhado, nunca resolvido, e o resumo seguinte não diz «Resolvido»
  m.tudo('Acme'); m.pronto('Acme'); await m.g.avaliar('Acme')
  await m.esvaziar('Acme')                                                  // 12/10: urgentes (até 3 por mensagem) + plano da semana
  for (const t of ['ruptura_curva_a', 'anuncio_restrito', 'reputacao_em_risco']) assert.ok(m.rows('Acme').find(r => r.tipo === t && r.enviado_em), 'avisado antes: ' + t)
  assert.equal(m.rows('Acme').find(r => r.tipo === 'ads_sem_retorno').estado, 'interno', '12/10 (de propósito): Ads é da assessoria — interno, nunca avisado ao cliente; o alinhamento também o cobre')
  const vMLB1 = reg('Acme', { escopo: 'anuncio', chave: 'MLB1', tipo: 'pausa_producao', motivo: 'erro de produção do fornecedor' })
  reg('Acme', { escopo: 'anuncio', chave: 'MLB4', tipo: 'ja_informado' })
  reg('Acme', { escopo: 'anuncio', chave: 'MLB5', tipo: 'campanha_visibilidade', acos_alvo: 30 })
  reg('Acme', { escopo: 'conta', tipo: 'intencional', regras: ['reputacao_em_risco'] })
  m.rl.avancarDias(1)
  const ra = await m.g.avaliar('Acme')
  assert.equal(ra.alinhados, 4)
  for (const t of ['ruptura_curva_a', 'anuncio_restrito', 'ads_sem_retorno', 'reputacao_em_risco']) {
    const r = m.rows('Acme').find(x => x.tipo === t)
    assert.deepEqual([r.estado, r.motivo, r.avisado_resolucao], ['suprimido', 'alinhado', 1], 'coberto por alinhamento: ' + t)
  }
  assert.ok(!m.rows('Acme').some(r => r.estado === 'resolvido' && ['ruptura_curva_a', 'anuncio_restrito', 'ads_sem_retorno', 'reputacao_em_risco'].includes(r.tipo)), 'nunca resolvido')
  assert.equal((await m.g.avaliar('Acme')).alinhados, 0, 'segunda passada não regrava')
  const l2 = m.g.montarLote('Acme', 'semanal', { gravar: false })
  assert.ok(!(l2.texto_final || '').includes('Resolvido'), 'nunca linha «Resolvido» para o que foi alinhado')
  assert.match(ra.itens.find(x => x.tipo === 'ruptura_curva_a').motivo, /alinhamento com o cliente/, 'a tela diz por que não sai')
  // 3) alinhamento encerrado e a condição persiste: a mesma assinatura reabre (nunca nasce duplicada)
  A.encerrar({ cliente: 'Acme', id: vMLB1.id, por: POR })
  m.rl.avancarDias(2)
  await m.g.avaliar('Acme')
  const rup = m.rows('Acme').filter(r => r.tipo === 'ruptura_curva_a')
  assert.equal(rup.length, 1, 'mesma assinatura, sem duplicata'); assert.notEqual(rup[0].motivo, 'alinhado'); assert.ok(['pendente', 'agrupado', 'suprimido'].includes(rup[0].estado))
  assert.equal(rup[0].avisado_resolucao, 0, 'reaberto volta a poder dizer «Resolvido» quando resolver de verdade')
  // 4) sem a fonte de alinhamentos nada muda (compatível) e a dependência vencida também respeita a conta alinhada
  m.tudo('Beta'); reg('Beta', { escopo: 'conta', tipo: 'outro', regras: ['bloqueio_cliente'] }); m.rl.avancarDias(1); await m.g.avaliar('Beta')
  assert.ok(m.rows('Beta').filter(r => r.tipo === 'dependencia_vencida').every(r => r.estado === 'suprimido' && r.motivo === 'alinhado'), 'dependência vencida coberta')
})

// mundo com o núcleo REAL dos alinhamentos sobre o banco do mundo (o predicado é o mesmo que a fiação real liga)
async function mundoAlinhado(o = {}) {
  const { criarAlinhamentos, SCHEMA_ALINHAMENTO } = await import('../src/lib/alinhamentos.js')
  const ref = {}
  const m = mundo({ ...o, fontesExtra: { alinhado: c => ref.A.predicado(c, { hoje: '2026-10-14' }), ...(o.fontesExtra || {}) } })
  m.h.exec(SCHEMA_ALINHAMENTO)
  ref.A = criarAlinhamentos({ handle: m.h, hoje: () => '2026-10-14', agora: m.rl.agora, nomesInternos: () => QUEM, validarPor })
  m.A = ref.A; m.reg = (c, e) => ref.A.registrar({ cliente: c, por: POR, confirmar: true, ...e })
  return m
}

await ok('alinhamentos com a fonte REAL de pendências (já filtrada pelo predicado) e com a ação de Ads que virou obsoleta: a linha já enviada fica suprimido/alinhado, nunca «Resolvido»', async () => {
  const { montar: montarPend, tarefa: tarefaDep } = await import('./fixtures/pendencias-mundo.mjs')
  let P
  const m = await mundoAlinhado({ fontesExtra: { pendencias: c => P.p.avaliar(c), explicar: p => P.p.explicar(p) } })
  P = montarPend({ tarefas: [tarefaDep({ cliente: 'Acme', processo: 'Mercado Livre', tipo: 'documentos', dias: 35 })], alinhado: (c, dia) => m.A.predicado(c, { hoje: dia }), idAcao: (c, r, alvo) => `PS-${r}-${alvo}` })
  m.D.diag.set('Acme', diagCompleto()); m.D.acoes.set('Acme', acoesCompletas()); m.pronto('Acme')
  await m.g.avaliar('Acme')
  await m.esvaziar('Acme')
  assert.ok(m.rows('Acme').find(r => r.tipo === 'dependencia_vencida' && r.enviado_em), 'avisado antes: dependencia_vencida')
  assert.equal(m.rows('Acme').find(r => r.tipo === 'ads_sem_retorno').estado, 'interno', '12/10 (de propósito): Ads é da assessoria — interno, nunca enviado; ao ser alinhado também vira suprimido/alinhado')
  m.reg('Acme', { escopo: 'conta', tipo: 'ja_informado', regras: ['bloqueio_cliente'] })                // a cobrança do retorno já foi conversada com o seller
  m.reg('Acme', { escopo: 'anuncio', chave: 'MLB5', tipo: 'campanha_visibilidade' })                    // Ads do MLB5 combinado…
  m.D.acoes.set('Acme', acoesCompletas().filter(a => a.item_id !== 'MLB5'))                              // …e o plano regerado tirou a ação (obsoleta): a fonte não a traz mais
  assert.equal(P.p.avaliar('Acme').itens.filter(p => p.fonte === 'tarefa').length, 0, 'fixture: a fonte de pendências já vem filtrada pelo predicado')
  m.rl.avancarDias(1)
  const ra = await m.g.avaliar('Acme')
  for (const t of ['dependencia_vencida', 'ads_sem_retorno']) { const r = m.rows('Acme').find(x => x.tipo === t); assert.deepEqual([r.estado, r.motivo, r.avisado_resolucao], ['suprimido', 'alinhado', 1], t) }
  assert.equal(ra.resolvidos, 0); assert.ok(ra.alinhados >= 2)
  assert.doesNotMatch(m.g.montarLote('Acme', 'semanal', { gravar: false }).texto_final || '', /Resolvido/, 'nunca «Resolvido» para o que foi alinhado')
})

await ok('Ads acima do ACOS alvo combinado AVISA: visibilidade com alvo 30% e ACOS 60% → ads_sem_retorno nasce; ACOS 25% → silencia; sem leitura de ACOS, a ação gravada com o alvo (criada acima dele) também avisa', async () => {
  const m = await mundoAlinhado({ clientes: [['Acme', 'Ativo'], ['Beta', 'Ativo'], ['Gama', 'Ativo']] })
  const comAcos = acos => { const d = diagCompleto(); d.itens.find(i => i.id === 'MLB5').ads = { custo: 120, ...(acos != null ? { acos } : {}) }; return d }
  for (const [c, acos] of [['Acme', 60], ['Beta', 25], ['Gama', null]]) { m.reg(c, { escopo: 'anuncio', chave: 'MLB5', tipo: 'campanha_visibilidade', acos_alvo: 30 }); m.D.diag.set(c, comAcos(acos)) }
  m.D.acoes.set('Acme', acoesCompletas()); m.D.acoes.set('Beta', acoesCompletas())
  m.D.acoes.set('Gama', acoesCompletas().map(a => a.item_id === 'MLB5' ? { ...a, dados: { alinhamento: { acos_alvo: 30, texto: 'ACOS acima do alvo de 30% alinhado com o cliente em 14/10' } } } : a))
  for (const c of ['Acme', 'Beta', 'Gama']) await m.g.avaliar(c)
  const tem = c => m.rows(c).some(r => r.tipo === 'ads_sem_retorno')
  assert.deepEqual([tem('Acme'), tem('Beta'), tem('Gama')], [true, false, true])
})

await ok('reenvio do lote do dia: item alinhado depois da falha → o lote é cancelado (conteudo_mudou), o aviso alinhado nunca sai e a linha segue suprimido/alinhado; os outros pontos saem num lote novo no mesmo tick', async () => {
  const m = await mundoAlinhado()
  m.pronto('Acme'); m.tudo('Acme'); m.envio.resposta = { estado: 'falhou', motivo: 'n8n_rede', recibos: {} }
  m.rl.ir('2026-10-14', '10:00'); await m.g.tick()
  const imed = m.lotes('Acme').find(l => l.tipo === 'imediato'), rupTexto = m.rows('Acme').find(r => r.tipo === 'ruptura_curva_a').texto
  assert.equal(imed.estado, 'falhou'); assert.ok(imed.texto_final.includes(rupTexto), 'fixture: a ruptura do MLB1 estava no lote que falhou')
  m.reg('Acme', { escopo: 'anuncio', chave: 'MLB1', tipo: 'pausa_producao' })
  m.envio.resposta = null; m.envios.length = 0; m.rl.ir('2026-10-14', '10:20'); const t = await m.g.tick()
  const imed2 = m.lotes('Acme').find(l => l.id === imed.id)
  assert.deepEqual([imed2.estado, imed2.motivo], ['falhou', 'conteudo_mudou'])
  assert.ok(m.envios.length && !m.envios.some(e => e.lote.texto.includes(rupTexto)), 'o cliente nunca recebe o aviso do item alinhado')
  const rup = m.rows('Acme').find(r => r.tipo === 'ruptura_curva_a'); assert.deepEqual([rup.estado, rup.motivo], ['suprimido', 'alinhado'], 'nunca regravada como enviada')
  assert.equal(t.imediatos, 1, 'os demais críticos voltaram à fila e saíram num lote novo')
  // 12/10: urgente leva até 3 pontos; os do lote cancelado (menos o alinhado) saem no lote novo, que sai enviado
  const novo = m.lotes('Acme').filter(l => l.tipo === 'imediato' && l.id !== imed.id).at(-1), ids = l => JSON.parse(l.itens_ids_json), row = id => m.rows('Acme').find(x => x.id === id)
  assert.ok(ids(imed).filter(id => row(id).tipo !== 'ruptura_curva_a').every(id => ids(novo).includes(id)), 'os pontos do lote cancelado saíram no lote novo')
  assert.ok(ids(novo).length <= 3 && ids(novo).every(id => row(id).estado === 'enviado' && row(id).lote_id === novo.id))
})

// ═════════ «Só o que depende do cliente» (pedido do David, 12/10/2026): dono por tipo; assessoria vira aviso interno; preço só com origem verificada; queda por preço; reposição acionável ═════════
await ok('dono (12/10): todo tipo tem dono; assessoria = Ads sem retorno, promoção terminando, promoção encerrada e quedas genéricas; reposição, Full, despacho, SAC, reputação, restrito, custos, retorno e preço são do cliente; urgente = só os 6 tipos de ritmo hora; título antigo e resumo diário fora da configuração', () => {
  const cfg = lerConfig()
  assert.ok(TIPOS.every(t => DONOS.includes(cfg.gatilhos[t].dono)), 'todo tipo tem dono')
  assert.deepEqual(TIPOS.filter(t => cfg.gatilhos[t].dono === 'assessoria').sort(), ['ads_sem_retorno', 'oferta_terminando', 'promocao_encerrada', 'queda_conta', 'queda_forte_conta'])
  assert.deepEqual(TIPOS.filter(t => cfg.gatilhos[t].ritmo === 'hora').sort(), ['anuncio_restrito', 'envio_atrasado', 'estoque_zerado', 'queda_por_preco', 'reclamacao_mediacao', 'reputacao_em_risco', 'ruptura_curva_a'], 'ritmo hora = os 6 tipos + estoque zerado (14/10)')
  assert.deepEqual([...cfg.urgente.tipos].sort(), ['ciclo_estoque_previsto', 'estoque_zerado', 'preco_alterado_drastico', 'queda_por_preco', 'ruptura_curva_a'], '14/10: o que sai na hora = só estoque e preço')
  assert.ok(TIPOS.every(t => (cfg.gatilhos[t].dono === 'assessoria') === (cfg.gatilhos[t].ritmo === 'interno')), 'assessoria ⇔ interno'); assert.equal(cfg.urgente.ruptura_max_dias, undefined, '14/10: sem corte (predicado do Algoritmo)')
  assert.deepEqual(cfg.semanal, { dia_semana: 2, hora: '09:00', ate: '20:00' }, 'terça (decisões finais de 12/10/2026)'); for (const k of ['titulo', 'rodape', 'resumo_hora_padrao']) assert.ok(!(k in cfg), k + ' saiu')
  for (const [k, v] of [['titulo', { diario: 'x' }], ['resumo_hora_padrao', '08:00']]) assert.throws(() => validarConfig({ ...JSON.parse(JSON.stringify(cfg)), [k]: v }), /saiu em 12\/10\/2026/)
  const urgSemCrit = JSON.parse(JSON.stringify(cfg)); urgSemCrit.gatilhos.perguntas_sem_resposta.ritmo = 'hora'; assert.throws(() => validarConfig(urgSemCrit), /exige classe critico/)
  const assSemInt = JSON.parse(JSON.stringify(cfg)); assSemInt.gatilhos.ads_sem_retorno.ritmo = 'semanal'; assert.throws(() => validarConfig(assSemInt), /assessoria ⇔ ritmo interno/)
  assert.deepEqual(TIPOS.filter(t => cfg.gatilhos[t].dono === 'cliente').sort(), ['anuncio_restrito', 'ciclo_estoque_previsto', 'custos_nao_informados', 'dependencia_vencida', 'envio_atrasado', 'envio_full_sugerido', 'estoque_zerado', 'full_estoque_antigo',
    'perguntas_sem_resposta', 'preco_alterado_drastico', 'queda_por_preco', 'reclamacao_mediacao', 'reputacao_em_risco', 'ruptura_curva_a'])
  assert.deepEqual(['dono', 'classe', 'ritmo', 'sem_resolucao'].map(k => cfg.gatilhos.queda_por_preco[k]), ['cliente', 'critico', 'hora', true])
  assert.deepEqual(['dono', 'classe', 'ritmo'].map(k => cfg.gatilhos.preco_alterado_drastico[k]), ['cliente', 'atencao', 'semanal'], 'preço mudado fora da Place2u vai no plano da segunda (não é urgente)')
  for (const v of [undefined, 'equipe']) { const x = JSON.parse(JSON.stringify(cfg)); if (v === undefined) delete x.gatilhos.ruptura_curva_a.dono; else x.gatilhos.ruptura_curva_a.dono = v; assert.throws(() => validarConfig(x), /dono inválido/) }
  assert.ok(!JSON.stringify(cfg).includes('O que depende de você'), 'o título antigo não existe mais na configuração')
})

await ok('assessoria NUNCA vai ao cliente: os tipos de dono assessoria ficam internos e fora de prévia, lote imediato, diário e envio (tick); aviso_assessoria com nível da classe, dedupe de 24 h e link do Resumo; resolvem sem «Resolvido»', async () => {
  const m = mundo(), cfg = lerConfig(), ASS = TIPOS.filter(t => cfg.gatilhos[t].dono === 'assessoria')
  m.tudo('Acme'); m.pronto('Acme')
  let r = await m.g.avaliar('Acme')
  const internos = r.itens.filter(i => i.dono === 'assessoria')
  assert.deepEqual(internos.map(i => i.tipo).sort(), ['ads_sem_retorno', 'oferta_terminando', 'queda_forte_conta'])
  assert.ok(internos.every(i => i.estado === 'interno' && i.para_cliente === false && i.motivo_codigo === 'assessoria' && i.texto), 'interno, com o texto para a equipe ler')
  assert.ok(r.itens.filter(i => i.dono === 'cliente').every(i => i.para_cliente === true))
  const textos = internos.map(i => i.texto)
  const ni = () => m.notifs.filter(x => /^aviso_assessoria/.test(x.tipo))
  assert.equal(ni().length, 1, 'uma notificação interna por passada')
  assert.deepEqual([ni()[0].tipo, ni()[0].nivel, ni()[0].dedupeMin, ni()[0].cliente, ni()[0].link], ['aviso_assessoria_critico', 'alerta', 1440, 'Acme', '/cliente?cliente=Acme&aba=resumo'], 'queda forte (crítico) → alerta, tipo próprio (dedupe por nível); dedupe 24 h')
  assert.equal(ni()[0].titulo, 'Só para a equipe (não vai ao cliente): 3 avisos · Acme')
  await m.g.avaliar('Acme'); assert.equal(ni().length, 1, 'nada novo interno = nenhuma chamada nova')
  m.D.estado.set('Acme', { ...quedaForte(), forca: 'moderada', variacao_pct: -14 }); await m.g.avaliar('Acme')
  assert.equal(ni().length, 2); assert.deepEqual([ni()[1].tipo, ni()[1].nivel, ni()[1].dedupeMin], ['aviso_assessoria', 'info', 1440], 'queda moderada (atenção) → info; o dedupe por cliente fica com o notificar')
  textos.push(m.rows('Acme').find(x => x.tipo === 'queda_conta').texto)
  const nenhum = (txt, onde) => { for (const t of textos) assert.ok(!String(txt || '').includes(t), `${onde} levou linha da assessoria`); assert.doesNotMatch(String(txt || ''), /Anúncios pagos|Faturamento|promoção\(ões\) terminam/, onde) }
  for (const tipo of ['imediato', 'semanal']) { const l = m.g.montarLote('Acme', tipo, { gravar: false }); nenhum(l.texto_final, 'montarLote ' + tipo); assert.ok(l.n > 0 && l.itens.every(i => i.dono === 'cliente' && i.para_cliente)) }
  const pv = await m.g.enviar({ cliente: 'Acme', confirmar: false }); nenhum(pv.texto_final, 'prévia'); assert.ok(pv.texto_final.startsWith(ABERTURA))
  // 14/10: no dia do plano só o plano sai (o urgente vai na véspera)
  m.rl.ir('2026-10-18', '09:10'); await m.g.tick(); m.rl.ir('2026-10-19', '09:10'); await m.g.tick(); assert.equal(m.envios.length, 2, 'urgente (domingo) + plano da semana (segunda)')
  for (const e of m.envios) { nenhum(e.lote.texto, 'envio'); assert.match(e.lote.titulo, /^(Plano da semana · 19\/10\/2026|Ponto importante da conta · 18\/10\/2026 · 09:10)$/); assert.doesNotMatch(e.lote.texto, ANTIGO) }
  assert.ok(m.rows('Acme').filter(x => ASS.includes(x.tipo)).every(x => ['interno', 'resolvido'].includes(x.estado) && !x.lote_id && !x.enviado_em), 'nunca em lote, nunca enviado (a queda forte resolveu quando virou moderada)')
  // a condição some: o interno resolve com avisado_resolucao = 1 e nunca aparece em mensagem nenhuma
  m.D.acoes.set('Acme', []); m.D.promo.set('Acme', []); m.D.estado.set('Acme', null)
  m.rl.ir('2026-10-26', '09:10'); await m.g.tick()
  assert.ok(m.rows('Acme').filter(x => ASS.includes(x.tipo)).every(x => x.estado === 'resolvido' && x.avisado_resolucao === 1))
  for (const l of m.lotes('Acme')) { assert.doesNotMatch(l.texto_final, /Resolvido|Anúncios pagos|Faturamento|promoção\(ões\) terminam/); nenhum(l.texto_final, 'lote ' + l.tipo) }
  const lst = await m.g.listarCliente('Acme', { reavaliar: false }); assert.ok(lst.catalogo.every(t => DONOS.includes(t.dono)))
})

await ok('migração: aviso já gravado de tipo que virou assessoria e ainda não saiu (agrupado, ou falhou num lote) passa a interno — mesma linha, não some, não vira «Resolvido»; lote montado antes com ele é cancelado sem sair; o que já saiu fica no histórico e resolve sem «Resolvido»', async () => {
  const m = mundo(); m.pronto('Acme'); m.D.acoes.set('Acme', acoesCompletas()); m.D.promo.set('Acme', promos()); m.D.estado.set('Acme', quedaForte())
  const em = m.rl.agora()
  const ins = (tipo, classe, estado, { assinatura, lote_id = '', enviado_em = '' }) => Number(m.h.prepare(`INSERT INTO gatilho_cliente (cliente, tipo, classe, assinatura, itens_json, texto, estado, motivo, lote_id, enviado_em, criado_em, atualizado_em)
    VALUES ('Acme', ?, ?, ?, '[]', ?, ?, '', ?, ?, ?, ?)`).run(tipo, classe, assinatura, 'texto antigo de ' + tipo, estado, lote_id, enviado_em, em, em).lastInsertRowid)
  // assinaturas que a detecção de hoje reproduz (mesma condição de pé)
  const ads = ins('ads_sem_retorno', 'atencao', 'agrupado', { assinatura: sha('ads_sem_retorno|MLB5') })
  const ofe = ins('oferta_terminando', 'info', 'agrupado', { assinatura: sha('oferta_terminando|MLB1|2026-10-16') })
  const qf = ins('queda_forte_conta', 'critico', 'falhou', { assinatura: sha('queda_forte_conta|forte'), lote_id: 'lote-velho' })
  ins('queda_conta', 'atencao', 'enviado', { assinatura: sha('queda_conta|moderada'), enviado_em: '2026-10-10T12:00:00.000Z' })
  m.h.prepare(`INSERT INTO gatilho_lote (id, cliente, tipo, dia, itens_ids_json, texto_final, hash, canais_json, estado, origem, por, criado_em) VALUES ('lote-velho', 'Acme', 'imediato', '2026-10-14', ?, ?, 'h', '["whatsapp"]', 'falhou', 'automatico', '', ?)`)
    .run(JSON.stringify([qf]), 'Aviso Place2u · 14/10/2026 · 09:00\n• texto antigo de queda_forte_conta\nPlace2u · aviso automático; associação não prova causa', em)
  // o reenvio do lote antigo, ANTES de qualquer avaliação, já não sai: a linha da assessoria cancela o lote e vai para o interno
  const re = await m.g.enviarLote('lote-velho'); assert.deepEqual([re.ok, re.motivo], [false, 'conteudo_mudou']); assert.equal(m.envios.length, 0, 'nada saiu ao cliente')
  assert.deepEqual(['estado', 'motivo', 'lote_id'].map(k => m.rows('Acme').find(x => x.id === qf)[k]), ['interno', 'assessoria', ''])
  const r = await m.g.avaliar('Acme')
  for (const [id, t] of [[ads, 'ads_sem_retorno'], [ofe, 'oferta_terminando'], [qf, 'queda_forte_conta']]) {
    const row = m.rows('Acme').find(x => x.id === id); assert.deepEqual([row.estado, row.motivo], ['interno', 'assessoria'], t + ' migrou na mesma linha')
    assert.equal(m.rows('Acme').filter(x => x.tipo === t).length, 1, t + ': sem duplicata'); assert.notEqual(row.texto, 'texto antigo de ' + t, 'texto atualizado pela detecção')
  }
  const qc = m.rows('Acme').find(x => x.tipo === 'queda_conta'); assert.deepEqual([qc.estado, qc.avisado_resolucao], ['resolvido', 1], 'já saiu (histórico): resolve sem «Resolvido»')
  assert.ok(r.internos >= 2); assert.ok(m.notifs.some(x => /^aviso_assessoria/.test(x.tipo)))
  const d = m.g.montarLote('Acme', 'semanal', { gravar: false }); assert.doesNotMatch(d.texto_final, /Resolvido: Faturamento|texto antigo|Anúncios pagos/)
})

await ok('preço (12/10): só mudança feita FORA da assessoria vai ao cliente — fonte ofertas/promo/acomp/chaveiro não; tarefa da equipe no anúncio em [dia−2, dia+1] não; promoção no ar/mudando não; Ofertas publicada não; tarefas não lidas ou tarefa de preço sem anúncio = interno «origem não verificada»; coleta sem tarefa = sim', async () => {
  const m0 = { item_id: 'MLB6', dia: '2026-10-13', fonte: 'coleta' }, vazio = { tarefas: [], execucoes: [], promocoes: [], ...LIDO }
  assert.equal(origemPreco(m0, vazio), 'externa'); assert.equal(origemPreco({ ...m0, fonte: 'webhook' }, vazio), 'externa')
  for (const f of ['ofertas', 'promo', 'acomp', 'ads', 'chaveiro', '']) assert.equal(origemPreco({ ...m0, fonte: f }, vazio), 'sistema', f)
  assert.equal(origemPreco(m0, null), 'nao_verificada', 'sem leitura das tarefas')
  const conc = fim => ({ ...vazio, tarefas: [{ itens: ['MLB6'], aberta: false, inicio: '', fim, preco: false }] })
  assert.equal(origemPreco(m0, conc('2026-10-11')), 'assessoria', 'dia−2 entra'); assert.equal(origemPreco(m0, conc('2026-10-14')), 'assessoria', 'dia+1 entra')
  assert.equal(origemPreco(m0, conc('2026-10-10')), 'externa', 'dia−3 fora'); assert.equal(origemPreco(m0, conc('2026-10-15')), 'externa', 'dia+2 fora')
  assert.equal(origemPreco(m0, { ...vazio, tarefas: [{ itens: ['MLB7'], aberta: false, fim: '2026-10-13' }] }), 'externa', 'tarefa de OUTRO anúncio não conta')
  assert.equal(origemPreco(m0, { ...vazio, tarefas: [{ itens: ['MLB6'], aberta: true, inicio: '2026-10-01' }] }), 'assessoria', 'tarefa aberta no anúncio desde antes')
  assert.equal(origemPreco(m0, { ...vazio, tarefas: [{ itens: ['MLB6'], aberta: true, inicio: '2026-10-20' }] }), 'externa', 'tarefa aberta que começou depois')
  assert.equal(origemPreco(m0, { ...vazio, execucoes: [{ item_id: 'MLB6', dia: '2026-10-12' }] }), 'assessoria', 'publicação de Ofertas na janela')
  assert.equal(origemPreco(m0, { ...vazio, promocoes: [{ item_id: 'MLB6', inicio: '2026-10-01', fim: '2026-10-31' }] }), 'promocao')
  assert.equal(origemPreco(m0, { ...vazio, promocoes: [{ item_id: 'MLB6', inicio: '2026-09-01', fim: '2026-09-30' }] }), 'externa', 'promoção que acabou antes')
  assert.equal(origemPreco(m0, { ...vazio, promocoes: [{ item_id: 'MLB6', dia: '2026-10-13' }] }), 'promocao', 'evento de promoção no change-log')
  assert.equal(origemPreco(m0, { ...vazio, tarefas: [{ itens: [], aberta: false, fim: '2026-10-13', preco: true }] }), 'nao_verificada', 'tarefa de preço sem anúncio na janela')
  // carimbos por mudança (achados de 12/10): ausente ≠ zero — sem eles nada é «fora das ações da Place2u»
  assert.equal(origemPreco(m0, { tarefas: [], execucoes: [], promocoes: [] }), 'nao_verificada', 'sem carimbos de leitura')
  assert.equal(origemPreco(m0, { ...vazio, sync: '2026-10-13' }), 'nao_verificada', 'Notion sincronizado só até o dia da mudança: a metade [dia, dia+1] ainda não existe')
  assert.equal(origemPreco(m0, { ...vazio, promo_lida: '2026-10-12' }), 'nao_verificada', 'promoções lidas antes do dia da mudança')
  assert.equal(origemPreco(m0, { ...vazio, leituras: ['2026-10-13'] }), 'nao_verificada', 'leitura anterior dos anúncios desconhecida')
  assert.equal(origemPreco(m0, { ...vazio, promocoes: [{ item_id: 'MLB6', dia: '2026-10-20', campo: 'promocao' }] }), 'nao_verificada', 'evento de promoção depois da janela (datado pela coleta de promoções)')
  assert.equal(origemPreco(m0, { ...vazio, promocoes: [{ item_id: 'MLB6', dia: '2026-10-20', campo: 'preco_original' }] }), 'externa', 'preço riscado da coleta diária tem a data real')
  assert.equal(origemPreco(m0, { ...vazio, promocoes: [{ item_id: 'MLB6', inicio: '', fim: '' }] }), 'promocao', 'preço riscado hoje')
  assert.equal(origemPreco(m0, { ...vazio, tarefas: [{ itens: ['MLB6'], aberta: false, inicio: '', fim: '' }] }), 'nao_verificada', 'concluída sem data no anúncio')
  // coleta com lacuna (achado crítico): mudança vista em 12/10, anúncios lidos antes só em 08/10 — a janela começa em 08/10
  const g12 = { item_id: 'X', dia: '2026-10-12', fonte: 'coleta' }, lacuna = { tarefas: [], execucoes: [], promocoes: [], sync: '2026-10-13', promo_lida: '2026-10-12', leituras: ['2026-10-07', '2026-10-08'] }
  assert.equal(origemPreco(g12, { ...lacuna, promocoes: [{ item_id: 'X', inicio: '2026-09-08', fim: '2026-10-08' }] }), 'promocao', 'promoção que acabou em 08/10')
  assert.equal(origemPreco(g12, { ...lacuna, tarefas: [{ itens: ['X'], aberta: false, inicio: '2026-10-09', fim: '2026-10-09' }] }), 'assessoria', 'tarefa da equipe concluída em 09/10')
  assert.equal(origemPreco(g12, { ...lacuna, leituras: ['2026-10-11'], promocoes: [{ item_id: 'X', inicio: '2026-09-08', fim: '2026-10-08' }] }), 'externa', 'controle: lido em 11/10, a promoção de 08/10 está fora da janela')
  // no fluxo (MLB6 +50% coleta; MLB8 +100% fonte ofertas; MLB7 +5%)
  const m = mundo(); m.pronto('Acme'); m.D.preco.set('Acme', precos()); m.D.diag.set('Acme', diagPreco())
  const preco = () => m.rows('Acme').filter(x => x.tipo === 'preco_alterado_drastico')
  const passa = async (ativ, esperado, msg, limpar = true) => { if (limpar) m.h.exec('DELETE FROM gatilho_cliente'); if (ativ === undefined) m.D.ativ.delete('Acme'); else m.D.ativ.set('Acme', ativ); await m.g.avaliar('Acme'); assert.deepEqual(preco().map(x => x.estado), esperado, msg); return preco() }
  let p = await passa(undefined, ['agrupado'], 'coleta, nenhuma tarefa da equipe na janela: vai ao cliente'); assert.match(p[0].texto, /fora das ações da Place2u/)
  assert.ok(!preco().some(x => JSON.parse(x.itens_json)[0].item_id === 'MLB8'), 'fonte ofertas nunca vira aviso')
  assert.equal(JSON.parse(p[0].itens_json)[0].origem, 'externa')
  // «em anúncio curva A/B»: só anúncio PRESENTE no diagnóstico com curva A/B — curva C ou fora dele (sem venda nem Ads em 56 dias) não; sem diagnóstico não detecta nem resolve
  m.D.diag.set('Acme', { disponivel: true, itens: [{ id: 'MLB6', titulo: 'x', curva: 'C', status: 'active' }] }); await passa(undefined, [], 'curva C')
  m.D.diag.set('Acme', { disponivel: true, itens: [] }); await passa(undefined, [], 'anúncio fora do diagnóstico')
  m.D.diag.set('Acme', diagPreco()); await passa(undefined, ['agrupado'], 'curva A de volta')
  m.D.diag.delete('Acme'); await passa(undefined, ['agrupado'], 'sem diagnóstico: a linha fica (não resolve) e nada novo nasce', false)
  m.D.diag.set('Acme', diagPreco())
  await passa({ ...vazio, tarefas: [{ itens: ['MLB6'], aberta: false, inicio: '2026-10-10', fim: '2026-10-13' }] }, [], 'tarefa da assessoria no anúncio na janela')
  await passa({ ...vazio, promocoes: [{ item_id: 'MLB6', inicio: '2026-10-13', fim: '2026-10-20' }] }, [], 'promoção ativa explica o preço')
  await passa({ ...vazio, execucoes: [{ item_id: 'MLB6', dia: '2026-10-13' }] }, [], 'publicação de Ofertas')
  p = await passa(null, ['interno'], 'tarefas não lidas: não verificável → só para a equipe')
  assert.deepEqual([p[0].motivo, JSON.parse(p[0].itens_json)[0].origem], ['origem_nao_verificada', 'nao_verificada'])
  assert.ok(m.notifs.some(x => /^aviso_assessoria/.test(x.tipo)), 'a equipe é avisada'); assert.ok(!(m.g.montarLote('Acme', 'semanal', { gravar: false }).texto_final || '').includes('fora das ações'), 'nunca no lote')
  await passa({ ...vazio, tarefas: [{ itens: [], aberta: false, fim: '2026-10-12', preco: true }] }, ['interno'], 'tarefa de preço sem anúncio identificado na janela')
  const sem = mundo({ fontesExtra: { atividadePreco: undefined } }); sem.D.preco.set('Acme', precos()); sem.D.diag.set('Acme', diagPreco()); await sem.g.avaliar('Acme')
  assert.deepEqual(sem.rows('Acme').filter(x => x.tipo === 'preco_alterado_drastico').map(x => [x.estado, x.motivo]), [['interno', 'origem_nao_verificada']], 'sem a fonte de atividade: não verificável')
  // a mesma linha muda de lado quando a leitura muda (ainda sem sair): verificada → cliente; leitura perdida → interno
  p = await passa(vazio, ['agrupado'], 'interno → verificada fora da Place2u: entra no fluxo do cliente', false)
  assert.equal(preco().length, 1, 'mesma linha'); await passa(null, ['interno'], 'agrupado → não verificável de novo: volta a interno', false); assert.equal(preco().length, 1)
})

await ok('queda_por_preco: nasce SÓ da ação da regra preco_mudou_vendas_cairam com os números da evidência (dados.evidencia_preco); sem número não nasce; mudança do sistema, tarefa da equipe na janela, promoção ou alinhamento → não; origem não verificada = interno; crítico na hora', async () => {
  const m = await mundoAlinhado(); m.pronto('Acme')
  const evid = (extra = {}) => ({ dia: '2026-10-01', de: 20, para: 26, subiu_pct: 30, queda_pct: 42.5, controle_pct: 1.2, dias_desde_alta: 13, fonte: 'coleta', incerteza: '', ...extra })
  const acao = (dados = {}, extra = {}) => ({ id: 'PS-q1', regra: 'anuncio_preco_mudou_vendas_cairam', item_id: 'MLB6', dados: { item: { id: 'MLB6', titulo: 'Areia para gatos 4kg' }, evidencia: 'texto da evidência', ...dados }, ...extra })
  const roda = async (acoes, ativ) => {
    m.h.exec("DELETE FROM gatilho_cliente WHERE tipo = 'queda_por_preco'"); m.D.acoes.set('Acme', acoes)
    if (ativ === undefined) m.D.ativ.delete('Acme'); else m.D.ativ.set('Acme', ativ)
    await m.g.avaliar('Acme'); return m.rows('Acme').filter(x => x.tipo === 'queda_por_preco')
  }
  let r = await roda([acao({ evidencia_preco: evid() })])
  assert.equal(r.length, 1); assert.deepEqual([r[0].classe, r[0].estado], ['critico', 'pendente'], 'crítico: sai no lote imediato')
  assert.equal(r[0].texto, '• Areia para gatos 4kg: preço de R$ 20,00 para R$ 26,00 em 01/10; desde então, as vendas desse anúncio caíram 42,5% enquanto os anúncios sem mudança ficaram estáveis.\nÉ uma associação medida, não prova de causa: vale revisar o preço com a gente.')
  assert.doesNotMatch(r[0].texto, SEM_ID); assert.deepEqual(auditarTexto(r[0].texto, { nomesInternos: QUEM, permitidos: ['Acme'] }), [])
  assert.deepEqual(JSON.parse(r[0].itens_json)[0], { item_id: 'MLB6', acao: 'PS-q1', regra: 'anuncio_preco_mudou_vendas_cairam', dia: '2026-10-01', de: 20, para: 26, queda_pct: 42.5, controle_pct: 1.2, fonte: 'coleta', origem: 'externa', aumento: true, impacto: null }, '14/10: aumento e impacto (sem previsão na ação stub = sem número)')
  assert.ok(m.g.montarLote('Acme', 'imediato', { gravar: false }).texto_final.includes('as vendas desse anúncio caíram 42,5%'))
  assert.match((await roda([acao({ evidencia_preco: evid({ controle_pct: 12 }) })]))[0].texto, /anúncios sem mudança subiram 12%\./, 'controle que subiu não vira "estáveis"')
  assert.equal((await roda([acao()])).length, 0, 'ação sem evidencia_preco (gravada antes): sem número não nasce')
  assert.equal((await roda([acao({ evidencia_preco: evid({ queda_pct: null }) })])).length, 0, 'sem a queda medida não nasce')
  assert.equal((await roda([acao({ evidencia_preco: evid() }, { regra: 'anuncio_estoque_ruptura' })])).length, 0, 'só a regra do preço')
  for (const f of ['ofertas', 'promo', 'acomp', '']) assert.equal((await roda([acao({ evidencia_preco: evid({ fonte: f }) })])).length, 0, 'mudança do próprio sistema: ' + f)
  assert.equal((await roda([acao({ evidencia_preco: evid() })], { tarefas: [{ itens: ['MLB6'], aberta: false, fim: '2026-09-30' }], execucoes: [], promocoes: [] })).length, 0, 'tarefa da equipe no anúncio na janela')
  assert.equal((await roda([acao({ evidencia_preco: evid() })], { tarefas: [], execucoes: [], promocoes: [{ item_id: 'MLB6', inicio: '2026-09-30', fim: '' }] })).length, 0, 'promoção no ar')
  // link do anúncio (do diagnóstico) na linha; fim de promoção (o preço novo = preço cheio de uma promoção que acabou) nunca vira queda «do cliente»
  m.D.diag.set('Acme', { disponivel: true, itens: [{ id: 'MLB6', titulo: 'Areia para gatos 4kg', curva: 'A', status: 'active', permalink: 'https://produto.mercadolivre.com.br/MLB-6-areia-_JM' }] })
  r = await roda([acao({ evidencia_preco: evid() })]); assert.match(r[0].texto, /ficaram estáveis\.\n  https:\/\/produto\.mercadolivre\.com\.br\/MLB-6-areia-_JM\nÉ uma associação/)
  assert.doesNotMatch(semFixos(m.g.montarLote('Acme', 'imediato', { gravar: false }).texto_final), /MLB/, 'o link do anúncio sai do crivo de ID (é o anúncio do próprio cliente)')
  assert.equal((await roda([acao({ evidencia_preco: evid() })], { tarefas: [], execucoes: [], promocoes: [{ item_id: 'MLB6', inicio: '2026-09-01', fim: '2026-09-25', preco_original: 26 }], ...LIDO })).length, 0, 'fim de promoção: o preço voltou ao cheio')
  m.D.diag.delete('Acme')
  r = await roda([acao({ evidencia_preco: evid() })], null); assert.deepEqual([r[0].estado, r[0].motivo], ['interno', 'origem_nao_verificada'], 'tarefas não lidas: só para a equipe')
  assert.ok(!(m.g.montarLote('Acme', 'imediato', { gravar: false }).texto_final || '').includes('caíram 42,5%'), 'interno nunca entra no lote')
  m.reg('Acme', { escopo: 'anuncio', chave: 'MLB6', tipo: 'intencional' })
  assert.equal((await roda([acao({ evidencia_preco: evid() })])).length, 0, 'anúncio alinhado com o cliente')
})

await ok('reposição acionável: urgente = campeão A/B com ≤ 3 dias, uma linha por anúncio no tom do plano («• nome (Full): tem N un (~d dias | menos de 1 dia) → sugerimos enviar|repor *conservador a base un*» + link do anúncio); nomes repetidos ganham o título completo; 4–9 dias ficam para o plano; hora de repor e «Sugestão de envio ao Full» (só da ação full_envio, limitada ao estoque) vão no plano semanal', async () => {
  // 14/10: fora do Full a quantidade é o pedido ao fornecedor (previsão de compras, a mesma do relatório focado) com a premissa dele; no Full, o envio (sugestaoFull)
  const pc = (id, conservador, base) => ({ id, quanto_pedir: { conservador, base, cobre_dias: 58 }, lead_time: { dias: 21, fonte: 'premissa' }, tendencia: { fator: 1 }, datas_comerciais: [], ruptura: false })
  const m = mundo({ fontesExtra: { compras: () => ({ disponivel: true, itens: [pc('MLB1', 30, 35), pc('MLB2', 25, 25)] }) } }), d = diagCompleto(), LINK = 'https://produto.mercadolivre.com.br/MLB-6882472560-kit-2-roldana-guia-porto-de-correr-_JM'
  const PREM = 'Prazo usado: 21 dias entre o pedido e a chegada (premissa: se o seu fornecedor entrega em outro prazo, conta pra gente que ajustamos) + 7 dias de folga. A quantidade cobre esse prazo e o próximo ciclo de compra de 30 dias pelo ritmo dos últimos 28 dias. Se houver pedido a caminho ou estoque fora do Mercado Livre, desconte.'
  Object.assign(d.itens[0], { full_sug: 30, titulo: 'Ração Premium 15kg Para Cães Adultos Carne', permalink: LINK }); d.itens[1].full_sug = 25
  d.itens.push({ id: 'MLB10', titulo: 'Ração Premium 15kg Para Cães Adultos Frango', curva: 'A', status: 'active', cobertura: 0, estoque: 0, ponto_reposicao: 20, r: 0, r0: 0, logistica: 'fulfillment', full_sug: 20 },
    { id: 'MLB11', titulo: 'Bebedouro automático', curva: 'A', status: 'active', cobertura: 5, estoque: 10, ponto_reposicao: 20, r: 0, r0: 0, logistica: 'fulfillment', full_sug: 64 },
    { id: 'MLB12', titulo: 'Tapete higiênico', curva: 'A', status: 'active', cobertura: 60, estoque: 10, ponto_reposicao: 5, r: 0, r0: 0, logistica: 'xd_drop_off', full_sug: 44 },
    { id: 'MLB13', titulo: 'Comedouro inox', curva: 'A', status: 'active', cobertura: 60, estoque: 50, ponto_reposicao: null, r: 0, r0: 0, logistica: '', full_sug: 9 })
  m.D.diag.set('Acme', d); m.D.acoes.set('Acme', ['MLB2', 'MLB3', 'MLB5', 'MLB12', 'MLB13'].map((id, k) => ({ id: `PS-f${k}`, regra: 'anuncio_full_envio', item_id: id, dados: {} })))
  const P = '(cobre ~37 dias de venda no ritmo atual, já descontado o estoque)'
  let por = Object.fromEntries((await m.g.avaliar('Acme')).itens.map(i => [i.tipo, i]))
  assert.equal(por.ruptura_curva_a.texto, `• Ração Premium 15kg Para Cães Adultos Frango: tem 0 un no Full (menos de 1 dia) → vai faltar no Full: sugerimos enviar *20 a 25 un*\n• Ração Premium 15kg Para Cães Adultos Carne: tem 8 un (~2 dias) → sugerimos repor *30 a 35 un*\n  ${LINK}\nQuando o estoque zera, o anúncio pausa e sai da busca até a reposição chegar, e as vendas desses dias não voltam.\n${PREM}\nNo Full, o envio sugerido cobre ~37 dias de venda e a estimativa considera que nada é enviado nesse período.`,
    'só ≤ 3 dias (o Bebedouro com 5 dias fica para o plano), menor cobertura primeiro, nome repetido = título completo, «no Full → vai faltar no Full» (14/10), enviar (Full) × repor, link do anúncio')
  assert.equal(por.ruptura_curva_a.estado, 'pendente', 'urgente: sai na hora'); assert.deepEqual(JSON.parse(m.rows('Acme').find(x => x.tipo === 'ruptura_curva_a').itens_json).map(x => x.repor), [20, 30], 'a quantidade fica no item interno')
  assert.equal(por.ciclo_estoque_previsto.texto, `• Coleira Pet ajustável: tem 30 un (~15 dias) → pedir *25 un*\n${PREM}\nQuanto antes o pedido sair, menos dias o anúncio fica sem estoque e fora da busca.`)
  assert.equal(por.envio_full_sugerido.texto, 'Estes anúncios vendem bem e ainda estão fora do Full: Shampoo Pet 500ml: enviar *12 a 17 un* e Tapete higiênico: enviar *10 un* (limitado ao estoque atual). É sugestão: nada é movimentado por aqui.',
    'só a ação full_envio do plano; Coleira (hora de repor), Cama (já no Full) e Comedouro (logística não lida) ficam fora; nunca mais que o estoque')
  for (const t of ['ciclo_estoque_previsto', 'envio_full_sugerido']) assert.equal(por[t].estado, 'agrupado', t + ': plano semanal')
  for (const t of ['ruptura_curva_a', 'ciclo_estoque_previsto', 'envio_full_sugerido']) { assert.deepEqual(auditaMsg(por[t].texto), [], t); assert.doesNotMatch(por[t].texto.replace(LINK, ''), SEM_ID, t) }
  assert.ok(auditarTexto(LINK).some(v => v.codigo === 'id_interno'), 'controle: o link cru seria barrado como ID — por isso só o link do anúncio do ML sai do crivo')
  // sem a ação full_envio no plano não há sugestão de Full (resolve); plano não lido (fonte com erro) não detecta nem resolve
  const quebra = mundo({ fontesExtra: { acoes: () => { throw new Error('banco') } } }); quebra.D.diag.set('Acme', d); await quebra.g.avaliar('Acme')
  assert.ok(!quebra.rows('Acme').some(x => x.tipo === 'envio_full_sugerido'), 'plano não lido: sem sugestão de Full')
  m.D.acoes.set('Acme', []); por = Object.fromEntries((await m.g.avaliar('Acme')).itens.map(i => [i.tipo, i]))
  assert.ok(!por.envio_full_sugerido, 'sem ação full_envio no plano: resolve'); assert.equal(m.rows('Acme').find(x => x.tipo === 'envio_full_sugerido').estado, 'resolvido')
})

await ok('pós-coleta: com a chave desligada e sem liberação, a detecção roda para todo cliente elegível (o aviso interno da equipe nunca depende do piloto) e nada sai ao cliente; o timer continua saindo no 1º if', async () => {
  const m = mundo(); m.tudo('Acme'); m.tudo('Beta')
  assert.deepEqual(await m.g.tick(), { pulou: 'desligado' })
  const r = await m.g.tick({ origem: 'coleta' })
  assert.equal(r.avaliados, 2, 'Acme e Beta (Ativos); prospect e Congelado não'); assert.equal(m.envios.length, 0, 'nada sai sem chave e liberação')
  assert.deepEqual(m.notifs.filter(x => /^aviso_assessoria/.test(x.tipo)).map(x => x.cliente).sort(), ['Acme', 'Beta'])
  assert.ok(m.rows('Beta').some(x => x.tipo === 'ads_sem_retorno' && x.estado === 'interno')); assert.equal(m.lotes('Acme').length + m.lotes('Beta').length, 0, 'nenhum lote montado')
})

await ok('fonte REAL atividadePreco (banco em memória): tarefa que cita o MLB vincula pelo vinculos.js (dependência do cliente conta, só a cancelada sai); tarefa de preço/desconto/oferta/precificação/margem sem anúncio (família ou palavra no tipo ou no título) e concluída sem data = não verificável; Ofertas, promoção e preço riscado (evento e hoje) entram; sync, promoções e leituras conferidos por mudança; sem tarefas = null', async () => {
  const { atividadePreco } = await import('../src/lib/gatilhos-real.js')
  const { db, setEstado } = await import('../src/lib/db.js')
  const J = { de: '2026-10-11', ate: '2026-10-14' }
  setEstado('ultimo_sync', '2026-10-14T09:00:00.000Z')
  assert.equal(atividadePreco('Zeta', ['MLB4000000006'], J), null, 'cliente sem nenhuma tarefa lida: não verificável')
  for (const id of ['MLB4000000006', 'MLB4000000007']) db.prepare("INSERT INTO meli_item (cliente, item_id, titulo) VALUES ('Zeta', ?, 'x')").run(id)
  const t = (id, titulo, status, extra = {}, cli = 'Zeta') => db.prepare("INSERT INTO tarefas (id, fonte, cliente, titulo, status, tipo_demanda, data_inicio, data_conclusao, last_edited) VALUES (?, 'f', ?, ?, ?, ?, ?, ?, ?)")
    .run(id, cli, titulo, status, extra.tipo || '', extra.inicio ?? null, extra.fim ?? null, extra.editado || '')
  t('t1', 'Ajustar título MLB4000000006 premium', 'concluida', { fim: '2026-10-12' }); t('t2', 'Fotos MLB4000000007', 'andamento', { inicio: '2026-10-01' })
  t('t3', 'Atualizar preços da linha pet', 'concluida', { tipo: 'Atualizar Preços', fim: '2026-10-13' }); t('t4', 'Revisar MLB4000000006', 'cancelada', { fim: '2026-10-12' }); t('t5', 'Preço MLB4000000006', 'dependencia_cliente')
  const a = atividadePreco('Zeta', ['MLB4000000006'], J)
  assert.deepEqual(a.tarefas, [{ itens: ['MLB4000000006'], aberta: false, preco: false, inicio: '', fim: '2026-10-12' }, { itens: [], aberta: false, preco: true, inicio: '', fim: '2026-10-13' }, { itens: ['MLB4000000006'], aberta: true, preco: true, inicio: '', fim: '' }],
    'MLB citado + preço sem anúncio + «aguardando o cliente» no anúncio; o de outro anúncio e a cancelada ficam fora')
  assert.deepEqual([a.sync, a.promo_lida, a.leituras], ['2026-10-14', '', []])
  assert.equal(origemPreco({ item_id: 'MLB4000000006', dia: '2026-10-13', fonte: 'coleta' }, a), 'assessoria')
  db.prepare("INSERT INTO meli_item_mudanca (cliente, item_id, dia, campo, de, para, variacao_pct, fonte, em) VALUES ('Zeta', 'MLB4000000006', '2026-10-13', 'promocao', 'nenhuma', 'DEAL −10%', NULL, 'promo', 'x')").run()
  assert.deepEqual(atividadePreco('Zeta', ['MLB4000000006'], J).promocoes, [{ item_id: 'MLB4000000006', dia: '2026-10-13', campo: 'promocao' }])
  db.prepare("INSERT INTO of_publicacao (id, job_id, cliente, canal, anuncio_id, versao, chave_idem, operacao, estado, criado_em, atualizado_em, verificado_em) VALUES ('p1', 'j1', 'Zeta', 'ML', 'MLB4000000006', 1, 'k1', 'atualizar', 'verificada', '2026-10-12T15:00:00Z', '2026-10-12T15:00:00Z', '2026-10-13T15:00:00Z')").run()
  assert.deepEqual(atividadePreco('Zeta', ['MLB4000000006'], J).execucoes, [{ item_id: 'MLB4000000006', dia: '2026-10-12' }, { item_id: 'MLB4000000006', dia: '2026-10-13' }], 'publicação de Ofertas: dia de criação e de verificação')

  // cliente Yota: anúncios lidos em 12/10, promoções lidas em 14/10, Notion em 14/10; UMA tarefa concluída em 13/10 sem MLB no card (o caso do achado)
  const Y = 'MLB4000000016', M = { item_id: Y, dia: '2026-10-13', fonte: 'coleta' }
  db.prepare("INSERT INTO meli_item (cliente, item_id, titulo, preco) VALUES ('Yota', ?, 'Areia para gatos 4kg', 80)").run(Y)
  db.prepare("INSERT INTO meli_coleta_dia (cliente, dia, pedidos, truncado, coletado_em) VALUES ('Yota', '2026-10-12', 3, 0, '2026-10-12T08:00:00.000Z')").run()
  const promoLida = em => { db.prepare("DELETE FROM promo_coleta WHERE cliente = 'Yota'").run(); if (em) db.prepare("INSERT INTO promo_coleta (cliente, coleta_id, estado, iniciada_em, concluida_em) VALUES ('Yota', 'c1', 'concluida', ?, ?)").run(em, em) }
  promoLida('2026-10-14T03:00:00.000Z')
  const so = (tipo, titulo, extra = {}) => { db.prepare("DELETE FROM tarefas WHERE cliente = 'Yota'").run(); t('y1', titulo, extra.status || 'concluida', { tipo, fim: extra.semData ? null : '2026-10-13' }, 'Yota'); return origemPreco(M, atividadePreco('Yota', [Y], J)) }
  assert.equal(so('Fotos', 'Trocar a capa'), 'externa', 'controle: tarefa que não é de preço nem do anúncio, tudo lido = fora da Place2u')
  assert.equal(so('Atualizar Preços', 'Linha pet'), 'nao_verificada', 'controle: família precos')
  for (const [tipo, titulo] of [['Precificação estratégica', 'Rever linha pet'], ['Campanhas de Desconto', 'Linha pet'], ['Campanha de Oferta', 'Linha pet'], ['Cupom', 'Linha pet'], ['Oferta Relâmpago', 'Linha pet'], ['Ajuste de margem', 'Linha pet'], ['', 'Subir promoção da semana'], ['Fotos', 'Desconto de 10% na linha']])
    assert.equal(so(tipo, titulo), 'nao_verificada', `tarefa de preço sem anúncio: ${tipo || titulo}`)
  assert.equal(so('Atualizar Preços', `Ajustar preço ${Y} — aguardando ok do cliente`, { status: 'dependencia_cliente' }), 'assessoria', 'tarefa no anúncio aguardando o cliente conta')
  assert.equal(so('Atualizar Preços', 'Linha pet', { semData: true }), 'nao_verificada', 'concluída sem data, de preço')
  assert.equal(so('Fotos', `Fotos ${Y}`, { semData: true }), 'nao_verificada', 'concluída sem data, no anúncio')
  so('Fotos', 'Trocar a capa')
  // preço riscado: fim do desconto (preco_original X→null da coleta) e desconto no ar hoje (preco_original > preco) = promoção; promoções não lidas desde o dia = não verificável
  db.prepare("INSERT INTO meli_item_mudanca (cliente, item_id, dia, campo, de, para, variacao_pct, fonte, em) VALUES ('Yota', ?, '2026-10-13', 'preco_original', '100', NULL, NULL, 'coleta', 'x')").run(Y)
  assert.equal(origemPreco(M, atividadePreco('Yota', [Y], J)), 'promocao', 'fim de desconto visto pela coleta diária')
  db.prepare("DELETE FROM meli_item_mudanca WHERE cliente = 'Yota'").run(); assert.equal(origemPreco(M, atividadePreco('Yota', [Y], J)), 'externa')
  db.prepare("UPDATE meli_item SET preco_original = 100 WHERE cliente = 'Yota'").run(); assert.equal(origemPreco(M, atividadePreco('Yota', [Y], J)), 'promocao', 'preço riscado hoje')
  db.prepare("UPDATE meli_item SET preco_original = NULL WHERE cliente = 'Yota'").run()
  promoLida('2026-10-10T03:00:00.000Z'); assert.equal(origemPreco(M, atividadePreco('Yota', [Y], J)), 'nao_verificada', 'promoções lidas antes do dia da mudança: ausente ≠ zero')
  promoLida(''); assert.equal(origemPreco(M, atividadePreco('Yota', [Y], J)), 'nao_verificada', 'promoções nunca lidas')
  promoLida('2026-10-14T03:00:00.000Z')
  // coleta com lacuna (anúncios lidos em 08/10 e só de novo em 12/10): a janela começa em 08/10 e pega a promoção que acabou lá
  db.prepare("INSERT INTO meli_coleta_dia (cliente, dia, pedidos, truncado, coletado_em) VALUES ('Yota', '2026-10-05', 3, 0, '2026-10-08T07:00:00.000Z')").run()
  db.prepare("INSERT INTO promo_oferta (cliente, item_id, pid, status, inicio, fim, atualizado_em) VALUES ('Yota', ?, 'P1', 'finished', '2026-09-08T00:00:00', '2026-10-08T23:59:59', 'x')").run(Y)
  const M12 = { ...M, dia: '2026-10-12' }, J12 = { de: '2026-10-10', ate: '2026-10-13' }
  assert.equal(origemPreco(M12, atividadePreco('Yota', [Y], J12)), 'promocao', 'fim de promoção antes da lacuna da coleta')
  db.prepare("DELETE FROM promo_oferta WHERE cliente = 'Yota'").run(); assert.equal(origemPreco(M12, atividadePreco('Yota', [Y], J12)), 'externa', 'sem a promoção, tudo lido = fora da Place2u')
  setEstado('ultimo_sync', '2026-10-12T09:00:00.000Z'); assert.equal(origemPreco(M12, atividadePreco('Yota', [Y], J12)), 'nao_verificada', 'Notion sem sync até o fim da janela (dia+1)')
  setEstado('ultimo_sync', '2026-10-14T09:00:00.000Z')
})

// ═════════ Decisões de 12/10/2026 (David): só Mercado Livre, plano semanal + urgente, travas de preço ═════════
await ok('só Mercado Livre: Discord fora dos canais do cliente — a configuração gravada perde só o discord (WhatsApp, e-mail, Notion e liberação ficam); urgente nunca leva linha não urgente', async () => {
  const h = new Database(':memory:')
  h.exec("CREATE TABLE clientes_central (cliente TEXT PRIMARY KEY, status_cs TEXT NOT NULL DEFAULT 'Ativo', notificacao_json TEXT NOT NULL DEFAULT '{}')")
  const velho = { canais: { whatsapp: { ligado: true, destino: '120363012345678901@g.us' }, email: { ligado: false, destino: 'dono@loja.com.br' }, discord: { ligado: true, destino: 'https://discord.com/api/webhooks/1234567890123/abcdefghijklmnopqrstuvwxyz' }, notion: { ligado: true } }, ritmo: { critico_na_hora: true, resumo_hora: '08:00' }, liberado_por: POR, liberado_em: '2026-10-10T10:00:00.000Z' }
  h.prepare('INSERT INTO clientes_central (cliente, notificacao_json) VALUES (?, ?), (?, ?)').run('Acme', JSON.stringify(velho), 'Beta', JSON.stringify({ canais: { discord: { ligado: true, destino: 'x' } } }))
  const g = criarGatilhos({ handle: h, fontes: {}, agora: relogio().agora, elegiveis: () => [{ cliente: 'Acme', status: 'Ativo' }, { cliente: 'Beta', status: 'Ativo' }], clienteCanonico: c => ['Acme', 'Beta'].includes(c) ? c : '' })
  const gravado = c => JSON.parse(h.prepare('SELECT notificacao_json j FROM clientes_central WHERE cliente = ?').get(c).j)
  const a = gravado('Acme'); assert.ok(!('discord' in a.canais)); assert.deepEqual(a.canais.whatsapp, velho.canais.whatsapp); assert.deepEqual(a.canais.email, velho.canais.email); assert.deepEqual(a.canais.notion, { ligado: true }); assert.equal(a.liberado_por, POR)
  assert.deepEqual(gravado('Beta').canais, {}, 'só o discord sai'); assert.deepEqual(g.elegivel('Beta'), { ok: false, motivo: 'sem_canal' }, 'quem só tinha Discord fica sem canal (honesto)')
  assert.deepEqual(Object.keys(g.notificacao('Acme').canais), ['whatsapp', 'email', 'notion'])
  criarGatilhos({ handle: h, fontes: {}, agora: relogio().agora }); assert.deepEqual(gravado('Acme'), a, 'idempotente')
  // urgente: só ritmo hora; preço, perguntas, retorno, Full e custos nunca saem no imediato
  const m = mundo(); m.tudo('Acme'); await m.g.avaliar('Acme')
  const SEIS = ['ruptura_curva_a', 'envio_atrasado', 'reclamacao_mediacao', 'reputacao_em_risco', 'anuncio_restrito', 'queda_por_preco']
  for (let i = 0; i < 3; i++) { const l = m.g.montarLote('Acme', 'imediato'); if (l.vazio) break; assert.ok(l.itens.every(x => SEIS.includes(x.tipo)), 'imediato só com os 6 tipos'); assert.ok(l.n <= 3); await m.g.enviarLote(l.id) }
  assert.equal(m.g.montarLote('Acme', 'imediato', { gravar: false }).vazio, true)
  assert.ok(m.rows('Acme').filter(x => !SEIS.includes(x.tipo) && x.estado !== 'interno').every(x => x.estado === 'agrupado' && !x.lote_id), 'o resto espera o plano da segunda')
})

await ok('fim de promoção (achado da União Dog, 12/10): preço novo ≈ preço cheio de uma promoção que terminou há ≤ 14 dias (tolerância 1%) = fim_de_promocao — nunca ao cliente; vira item interno «promoção terminou… avaliar renovar» com a lista dos anúncios', async () => {
  const at = (promos, extra = {}) => ({ tarefas: [], execucoes: [], promocoes: promos, sync: '2026-10-13', promo_lida: '2026-10-07', leituras: ['2026-10-08'], ...extra })
  const m0 = { item_id: 'U1', dia: '2026-10-12', fonte: 'coleta', para: '114.14' }, promo = (o = {}) => ({ item_id: 'U1', inicio: '2026-09-08', fim: '2026-10-08', preco_original: 114.14, ...o })
  assert.equal(origemPreco(m0, at([promo()])), 'fim_de_promocao')
  assert.equal(origemPreco({ ...m0, para: '115.20' }, at([promo()])), 'fim_de_promocao', 'dentro de 1%')
  assert.equal(origemPreco({ ...m0, para: '116.00' }, at([promo()])), 'promocao', 'fora de 1%: não é o preço cheio (a promoção na janela ainda explica: não avisa)')
  assert.equal(origemPreco(m0, at([promo({ fim: '2026-09-27' })])), 'nao_verificada', 'terminou há 15 dias: não é fim de promoção (e promoções lidas antes da mudança = não verificável)')
  assert.equal(origemPreco(m0, at([promo({ fim: '2026-10-20' })])), 'promocao', 'ainda no ar: promoção, não fim')
  assert.equal(origemPreco(m0, at([promo({ preco_original: undefined })])), 'promocao', 'sem preço cheio gravado não afirma fim de promoção')
  assert.equal(origemPreco(m0, at([promo({ item_id: 'U2' })], { promo_lida: '2026-10-12' })), 'externa', 'promoção de outro anúncio não conta')
  assert.equal(origemPreco(m0, at([promo()]), { fimPromocaoDias: 3 }), 'promocao', 'parâmetro da janela (config preco_origem)')
  assert.equal(origemPreco({ ...m0, fonte: 'ofertas' }, at([promo()])), 'sistema')
  // no fluxo: 3 anúncios com o preço de volta ao cheio + 1 mudança de verdade fora da Place2u
  const m = mundo(); m.pronto('Acme'); m.rl.ir('2026-10-12', '10:00')
  m.D.diag.set('Acme', { disponivel: true, itens: ['U1', 'U2', 'U3', 'U4'].map(id => ({ id, titulo: id === 'U4' ? 'Coleira refletiva' : `Guia unificada ${id}`, curva: 'A', status: 'active' })) })
  m.D.preco.set('Acme', [...['U1', 'U2', 'U3'].map(id => ({ item_id: id, titulo: `Guia unificada ${id}`, dia: '2026-10-12', de: '74.19', para: '114.14', variacao_pct: 53.85, fonte: 'coleta' })), { item_id: 'U4', titulo: 'Coleira refletiva', dia: '2026-10-11', de: '50', para: '80', variacao_pct: 60, fonte: 'coleta' }])
  m.D.ativ.set('Acme', { tarefas: [], execucoes: [], promocoes: ['U1', 'U2', 'U3'].map(id => promo({ item_id: id })), sync: '2026-10-13', promo_lida: '2026-10-12', leituras: ['2026-10-08'] })
  const r = await m.g.avaliar('Acme'), enc = r.itens.find(i => i.tipo === 'promocao_encerrada')
  assert.deepEqual([enc.estado, enc.dono, enc.para_cliente], ['interno', 'assessoria', false]); assert.equal(enc.texto, 'Promoção terminou e o preço voltou ao cheio em 3 anúncios — avaliar renovar: Guia unificada U1, Guia unificada U2 e Guia unificada U3.')
  assert.deepEqual(r.itens.filter(i => i.tipo === 'preco_alterado_drastico').map(i => i.texto), ['O preço de Coleira refletiva mudou de R$ 50,00 para R$ 80,00 (+60%) entre 09/10 e 11/10, fora das ações da Place2u. Se foi intencional, é só avisar para considerarmos no acompanhamento; se não foi, vale revisar.'], 'só a mudança de verdade vai ao cliente (anúncios lidos em 08/10 e só de novo na detecção: o dia exato não é afirmado)')
  assert.ok(m.notifs.some(x => x.tipo === 'aviso_assessoria' && /Promoção terminou/.test(x.corpo)), 'a equipe recebe o aviso interno')
  m.plano('Acme'); const p = m.g.montarLote('Acme', 'semanal', { gravar: false }); assert.doesNotMatch(p.texto_final, /Guia unificada|Promoção terminou/); assert.match(p.texto_final, /Coleira refletiva/)
})

await ok('janela da origem com LACUNA de coleta (achado de 12/10): com dias sem leitura antes da detecção, a janela começa na última leitura antes da detecção −2 (tarefa da equipe e promoção também); sem lacuna, dia−2', () => {
  const vazio = { tarefas: [], execucoes: [], promocoes: [], sync: '2026-10-13', promo_lida: '2026-10-12' }, m = { item_id: 'X', dia: '2026-10-12', fonte: 'coleta', para: '10' }
  const tarefa = fim => ({ itens: ['X'], aberta: false, inicio: fim, fim })
  // coleta parou depois de 08/10 (só voltou em 12/10): janela [06/10, 13/10]
  const lac = { ...vazio, leituras: ['2026-10-01', '2026-10-08'] }
  assert.equal(origemPreco(m, { ...lac, tarefas: [tarefa('2026-10-06')] }), 'assessoria', 'tarefa concluída em 06/10 (última leitura 08/10 −2) entra')
  assert.equal(origemPreco(m, { ...lac, tarefas: [tarefa('2026-10-05')] }), 'externa', '05/10 fica fora')
  assert.equal(origemPreco(m, { ...lac, promocoes: [{ item_id: 'X', inicio: '2026-09-01', fim: '2026-10-07' }] }), 'promocao', 'promoção que acabou em 07/10 entra na janela')
  // sem lacuna (lido em 11/10): janela [10/10, 13/10]
  const ok0 = { ...vazio, leituras: ['2026-10-10', '2026-10-11'] }
  assert.equal(origemPreco(m, { ...ok0, tarefas: [tarefa('2026-10-10')] }), 'assessoria'); assert.equal(origemPreco(m, { ...ok0, tarefas: [tarefa('2026-10-09')] }), 'externa', 'sem lacuna: dia−2')
  // um único dia sem leitura (11/10) já é lacuna: última leitura 10/10 −2 = 08/10
  assert.equal(origemPreco(m, { ...vazio, leituras: ['2026-10-10'], tarefas: [tarefa('2026-10-08')] }), 'assessoria')
})

await ok('urgente desta semana não volta como novidade no plano: o campeão já avisado ganha «lembrete» no 📦 e a queda por preço que continua vira bloco «Lembrete: …»', async () => {
  const m = mundo(); m.pronto('Acme'); m.rl.ir('2026-10-15', '10:00')
  const item = { id: 'MLB1', titulo: 'Ração Premium 15kg', curva: 'A', status: 'active', cobertura: 2, estoque: 8, ponto_reposicao: 20, vel_dia: 4, r: 2800, u: 112, logistica: '', permalink: 'https://produto.mercadolivre.com.br/MLB-1000000001-racao-_JM', sug: { conservador: 30, base: 35 } }
  m.D.diag.set('Acme', { disponivel: true, itens: [item, { id: 'MLB6', titulo: 'Areia para gatos 4kg', curva: 'A', status: 'active' }] })
  m.D.acoes.set('Acme', [{ id: 'PS-q1', regra: 'anuncio_preco_mudou_vendas_cairam', item_id: 'MLB6', dados: { item: { id: 'MLB6', titulo: 'Areia para gatos 4kg' }, evidencia_preco: { dia: '2026-10-01', de: 20, para: 26, queda_pct: 42.5, controle_pct: 1, fonte: 'coleta' } } }])
  await m.g.tick(); assert.equal(m.lotes('Acme').filter(l => l.tipo === 'imediato').length, 1, 'quinta: ruptura + queda por preço no urgente')
  m.plano('Acme', { itens: [item] }); m.rl.ir('2026-10-19', '09:10'); await m.g.tick()
  const p = m.lotes('Acme').find(l => l.tipo === 'semanal').texto_final
  assert.match(p, /• Ração Premium 15kg: tem 8 un \(~2 dias\) → sugerimos repor \*30 a 35 un\* _\(lembrete: já avisamos nos últimos dias\)_/)
  assert.match(p, /📉 \*Lembrete: rever o preço que pode estar segurando as vendas\*\n• Areia para gatos 4kg/)
  assert.deepEqual(auditaMsg(p), []); assert.doesNotMatch(p, ANTIGO)
  // a semana seguinte já não tem urgente recente: sem «lembrete»
  m.rl.ir('2026-10-26', '09:10'); await m.g.tick(); const p2 = m.lotes('Acme').filter(l => l.tipo === 'semanal').at(-1).texto_final
  assert.doesNotMatch(p2, /lembrete|Lembrete/); assert.match(p2, /• Ração Premium 15kg: tem 8 un/)
})

// ═════════ Revisão de 12/10/2026: achados corrigidos (um teste por correção) ═════════
const G = '120363012345678901@g.us'
const saudeAtraso = () => ({ ...saudeLimpa(), atrasos: 2, listas: { ...saudeLimpa().listas, atrasos: [{ order_id: '2000000001' }, { order_id: '2000000002' }] } })
const semanaMarcada = (m, c) => m.h.prepare('SELECT valor FROM sync_estado WHERE chave = ?').get(`gatilhos_semanal:${c}`)?.valor || ''

await ok('recibo do n8n (achado CRÍTICO): lote com recibo de WhatsApp/e-mail NUNCA sai de novo sozinho — plano «parcial» (WhatsApp falhou, e-mail entregue) e urgente «falhou» por recibo saem UMA vez no dia inteiro e nos seguintes; a equipe é avisada; o «Reenviar» manual vai só ao canal sem entrega e o recibo novo é aceito', async () => {
  const m = mundo(); m.configurar('Acme', { whatsapp: { ligado: true, destino: G }, email: { ligado: true, destino: 'dono@loja.com.br' } }); m.liberar('Acme'); m.ligar(); m.plano('Acme', { custosInformados: false })
  m.rl.ir('2026-10-19', '09:00'); await m.g.tick(); const plano = m.lotes('Acme').find(l => l.tipo === 'semanal'); assert.equal(m.envios.length, 1)
  assert.deepEqual(m.g.registrarRecibo({ lote_id: plano.id, canal: 'whatsapp', estado: 'falhou', em: m.rl.agora() }), { ok: true, duplicado: false }); m.g.registrarRecibo({ lote_id: plano.id, canal: 'email', estado: 'entregue', em: m.rl.agora() })
  assert.equal(m.lotes('Acme').find(l => l.id === plano.id).estado, 'parcial'); assert.ok(m.notifs.some(x => x.tipo === 'gatilho_falhou' && /whatsapp/.test(x.titulo)), 'a equipe é avisada no recibo que falhou')
  for (let i = 0; i < 70; i++) { m.rl.ms += 10 * 60_000; await m.g.tick() }
  assert.equal(m.envios.length, 1, 'o plano saiu UMA vez (antes: ~66 vezes, das 09:00 às 20:50, em WhatsApp + e-mail)')
  // urgente: os dois recibos falharam → 'falhou' por recibo; nem no mesmo dia, nem no seguinte (o lote de ontem com recibo não «vence» nem volta à fila)
  m.D.saude.set('Acme', saudeAtraso()); m.rl.ir('2026-10-20', '10:00'); await m.g.tick(); const urg = m.lotes('Acme').find(l => l.tipo === 'imediato'); assert.equal(m.envios.length, 2)
  for (const k of ['whatsapp', 'email']) m.g.registrarRecibo({ lote_id: urg.id, canal: k, estado: 'falhou', em: m.rl.agora() })
  assert.equal(m.lotes('Acme').find(l => l.id === urg.id).estado, 'falhou')
  for (let i = 0; i < 20; i++) { m.rl.ms += 60 * 60_000; await m.g.tick() }
  assert.equal(m.envios.length, 2, 'o urgente saiu UMA vez'); assert.equal(m.lotes('Acme').find(l => l.id === urg.id).motivo, '', 'nem «lote_vencido»: fica para a equipe decidir')
  // «Reenviar» manual do plano: só o WhatsApp (o e-mail já entregou); o recibo 'falhou' antigo saiu, então o recibo novo é aceito e fecha o lote
  const r = await m.g.enviar({ cliente: 'Acme', lote_id: plano.id, confirmar: true, por: POR }); assert.deepEqual([r.ok, r.estado], [true, 'enviado'])
  assert.deepEqual(m.envios.at(-1).canais, ['whatsapp'], 'o canal que já entregou não recebe de novo')
  assert.deepEqual(m.g.registrarRecibo({ lote_id: plano.id, canal: 'whatsapp', estado: 'entregue', em: m.rl.agora() }), { ok: true, duplicado: false }); assert.equal(m.lotes('Acme').find(l => l.id === plano.id).estado, 'entregue')
  // a chamada ao n8n que falha de fato (sem recibo) continua sendo retentada sozinha
  const m2 = mundo(); m2.pronto('Acme'); m2.plano('Acme', { custosInformados: false }); m2.envio.resposta = { estado: 'falhou', motivo: 'n8n_500', recibos: {} }
  m2.rl.ir('2026-10-19', '09:00'); await m2.g.tick(); m2.envio.resposta = null; m2.rl.ir('2026-10-19', '09:10'); assert.equal((await m2.g.tick()).retentados, 1)
})

await ok('título barrado pelo auditor (achado da Rotec, «Nº1»): o plano sai sem a linha daquele produto; plano bloqueado inteiro avisa a equipe e NÃO marca a semana em silêncio (sai no próximo tick em que passar)', async () => {
  const it = (id, titulo, o = {}) => ({ id, titulo, curva: 'A', status: 'active', cobertura: 5, estoque: 5, ponto_reposicao: 20, vel_dia: 1, r: 800, u: 26, logistica: 'xd_drop_off', sug: { conservador: 30, base: 40 }, ...o })
  const m = mundo(); m.pronto('Acme')
  m.plano('Acme', { itens: [it('MLB5146645627', 'Dobradiça Gonzo Com Abas Nº1 -5/8 X  3/4 N1- 2 Peças'), it('MLB2', 'Kit 2 Roldana Guia Portão', { cobertura: 6, estoque: 30, vel_dia: 5, r: 4000, u: 140 })] })
  m.rl.ir('2026-10-19', '09:10'); assert.equal((await m.g.tick()).semanais, 1)
  const p = m.lotes('Acme')[0].texto_final; assert.match(p, /• Kit 2 Roldana Guia Portão: tem 30 un/); assert.doesNotMatch(p, /Dobradiça/); assert.deepEqual(auditaMsg(p), [])
  let barra = true
  const m2 = mundo({ auditar: (t, o) => barra && /ritmo estável/.test(t) ? [{ codigo: 'teste' }] : auditarTexto(t, o) }); m2.pronto('Acme'); m2.plano('Acme', { custosInformados: false })
  m2.rl.ir('2026-10-19', '09:10'); let t = await m2.g.tick(); assert.equal(t.semanais, 0)
  assert.ok(m2.notifs.some(x => x.tipo === 'gatilho_falhou' && /Plano da semana não saiu/.test(x.titulo) && x.cliente === 'Acme'), 'a equipe é avisada'); assert.equal(semanaMarcada(m2, 'Acme'), '', 'a semana não fica marcada como feita')
  barra = false; m2.rl.ir('2026-10-19', '09:20'); t = await m2.g.tick(); assert.equal(t.semanais, 1, 'quando passa, sai na mesma segunda'); assert.equal(semanaMarcada(m2, 'Acme'), '2026-W43')
})

await ok('plano da semana não se perde (achado): o n8n falha às 09:00 e uma linha se resolve antes do reenvio → o lote é cancelado (conteudo_mudou) e o plano REMONTA na mesma segunda, sem a linha resolvida; sai uma vez só; o «Enviar» manual também remonta', async () => {
  const perg = n => ({ ...saudeLimpa(), perguntas: { abertas: n, mais_de_24h: n }, listas: { ...saudeLimpa().listas, perguntas: n ? [{ question_id: 'q1', mais_de_24h: 1 }, { question_id: 'q2', mais_de_24h: 1 }] : [] } })
  const m = mundo(); m.pronto('Acme'); m.plano('Acme', { custosInformados: false }); m.D.saude.set('Acme', perg(2)); m.envio.resposta = { estado: 'falhou', motivo: 'n8n_500', recibos: {} }
  m.rl.ir('2026-10-19', '09:00'); await m.g.tick(); const l1 = m.lotes('Acme')[0]; assert.deepEqual([l1.estado, m.envios.length], ['falhou', 1]); assert.match(l1.texto_final, /💬/)
  m.D.saude.set('Acme', perg(0)); m.envio.resposta = null
  m.rl.ir('2026-10-19', '09:10'); const t = await m.g.tick()
  assert.deepEqual(['estado', 'motivo'].map(k => m.lotes('Acme').find(l => l.id === l1.id)[k]), ['falhou', 'conteudo_mudou']); assert.equal(t.semanais, 1)
  const l2 = m.lotes('Acme').find(l => l.id !== l1.id); assert.equal(l2.estado, 'enviado'); assert.doesNotMatch(l2.texto_final, /💬/); assert.match(l2.texto_final, /planilha de custos/)
  for (const h of ['09:20', '12:00', '19:50']) { m.rl.ir('2026-10-19', h); await m.g.tick() } assert.equal(m.envios.length, 2, 'o plano novo sai uma vez só')
  assert.equal((await m.g.enviar({ cliente: 'Acme', confirmar: false })).id, l2.id, 'a prévia mostra o plano que saiu')
  // via «Reenviar» manual: cancela, e o «Enviar» remonta (antes devolvia sempre o lote cancelado)
  const m2 = mundo(); m2.configurar('Acme'); m2.plano('Acme', { custosInformados: false }); m2.D.saude.set('Acme', perg(2)); m2.envio.resposta = { estado: 'falhou', motivo: 'n8n_500', recibos: {} }
  m2.rl.ir('2026-10-21', '10:00'); await m2.g.avaliar('Acme'); const r1 = await m2.g.enviar({ cliente: 'Acme', confirmar: true, por: POR }); assert.equal(r1.estado, 'falhou')
  m2.D.saude.set('Acme', perg(0)); m2.envio.resposta = null; await m2.g.avaliar('Acme'); m2.rl.ir('2026-10-21', '10:10')
  assert.equal((await m2.g.enviar({ cliente: 'Acme', lote_id: r1.lote_id, confirmar: true, por: POR })).motivo, 'conteudo_mudou')
  const r2 = await m2.g.enviar({ cliente: 'Acme', confirmar: true, por: POR }); assert.deepEqual([r2.ok, r2.estado], [true, 'enviado']); assert.notEqual(r2.lote_id, r1.lote_id)
})

await ok('«urgente sai na hora» DESLIGADO (achado): despacho vencido (e os outros urgentes) entram no plano da segunda com bloco próprio e são marcados como enviados — nunca ficam «Aguardando» para sempre', async () => {
  // 14/10/2026: a caixa por cliente saiu do efeito — quem desliga o urgente é o config (urgente.na_hora_ligado = false)
  const desl = JSON.parse(JSON.stringify(cfgMecanica())); desl.urgente.na_hora_ligado = false
  const m = mundo({ cfg: validarConfig(desl) }); m.configurar('Acme', undefined, { ritmo: { critico_na_hora: false } }); m.liberar('Acme'); m.ligar(); m.plano('Acme', { custosInformados: false }); m.D.saude.set('Acme', saudeAtraso())
  m.rl.ir('2026-10-15', '10:00'); let t = await m.g.tick(); assert.deepEqual([t.imediatos, t.semanais, m.envios.length], [0, 0, 0], 'quinta: nada sai na hora')
  m.rl.ir('2026-10-19', '09:10'); t = await m.g.tick(); assert.deepEqual([t.imediatos, t.semanais], [0, 1])
  const p = m.lotes('Acme')[0]; assert.match(p.texto_final, /\*1\.\* 🚚 \*Pedido com despacho vencido\*\n2 pedidos com prazo de despacho vencido/); assert.deepEqual(auditaMsg(p.texto_final), [])
  const r = m.rows('Acme').find(x => x.tipo === 'envio_atrasado'); assert.deepEqual([r.estado, r.lote_id], ['enviado', p.id])
})

await ok('segunda (achado): urgente e plano no MESMO tick viram UMA mensagem — o plano sai primeiro e leva a ruptura pendente no 📦, sem «lembrete» falso; o lembrete diz «nos últimos dias» (não «nesta semana»)', async () => {
  const m = mundo(); m.pronto('Acme')
  const item = { id: 'MLB1', titulo: 'Coleira Azul Grande', curva: 'A', status: 'active', cobertura: 2, estoque: 4, ponto_reposicao: 20, vel_dia: 2, r: 2000, u: 56, logistica: 'fulfillment', sug: { conservador: 30, base: 36 } }
  m.D.diag.set('Acme', { disponivel: true, itens: [item] }); m.plano('Acme', { itens: [item] })
  m.rl.ir('2026-10-19', '09:00'); const t = await m.g.tick(); assert.deepEqual([t.imediatos, t.semanais, m.envios.length], [0, 1, 1])
  const p = m.lotes('Acme')[0]; assert.equal(p.tipo, 'semanal'); assert.match(p.texto_final, /• Coleira Azul Grande: tem 4 un \(~2 dias\) → sugerimos enviar \*30 a 36 un\*/); assert.doesNotMatch(p.texto_final, /lembrete/i)
  assert.equal(m.rows('Acme').find(x => x.tipo === 'ruptura_curva_a').lote_id, p.id, 'a linha urgente saiu junto com o plano')
})

await ok('data da mudança de preço com LACUNA de coleta (achado): anúncios lidos até 08/10 e de novo só em 12/10 → «entre 09/10 e 12/10», nunca «em 12/10»; sem lacuna, «em 12/10»; o mesmo na queda por preço', async () => {
  assert.equal(quandoMudou('2026-10-12', ['2026-10-08', '2026-10-12']), 'entre 09/10 e 12/10'); assert.equal(quandoMudou('2026-10-12', ['2026-10-11', '2026-10-12']), 'em 12/10')
  const m = mundo(); m.pronto('Acme'); m.D.diag.set('Acme', diagPreco())
  m.D.preco.set('Acme', [{ item_id: 'MLB6', titulo: 'Coleira Azul Grande', dia: '2026-10-12', de: '100', para: '130', variacao_pct: 30, fonte: 'coleta' }])
  m.D.ativ.set('Acme', { tarefas: [], execucoes: [], promocoes: [], sync: '2026-10-14', promo_lida: '2026-10-14', leituras: ['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-12', '2026-10-13'] })
  const p = (await m.g.avaliar('Acme')).itens.find(i => i.tipo === 'preco_alterado_drastico')
  assert.match(p.texto, /\(\+30%\) entre 09\/10 e 12\/10, fora das ações da Place2u/); assert.doesNotMatch(p.texto, /em 12\/10/)
  m.D.acoes.set('Acme', [{ id: 'PS-q1', regra: 'anuncio_preco_mudou_vendas_cairam', item_id: 'MLB6', dados: { item: { titulo: 'Areia para gatos 4kg' }, evidencia_preco: { dia: '2026-10-12', de: 20, para: 26, queda_pct: 40, controle_pct: 0, fonte: 'coleta' } } }])
  const q = (await m.g.avaliar('Acme')).itens.find(i => i.tipo === 'queda_por_preco'); assert.match(q.texto, /para R\$ 26,00 entre 09\/10 e 12\/10; desde então/); assert.doesNotMatch(q.texto, /em 12\/10/)
})

await ok('queda por preço depois do FIM de promoção (trava 1, achado): nunca ao cliente; vira exatamente 1 item interno «promoção terminou… avaliar renovar» com o anúncio e a queda medida', async () => {
  const m = mundo(); m.pronto('Acme'); m.D.diag.set('Acme', { disponivel: true, itens: [{ id: 'MLB1', titulo: 'Guia Longa 10m', curva: 'A', status: 'active', u: 30 }] })
  m.D.acoes.set('Acme', [{ id: 'A1', regra: 'anuncio_preco_mudou_vendas_cairam', item_id: 'MLB1', dados: { item: { titulo: 'Guia Longa 10m' }, evidencia_preco: { dia: '2026-10-04', de: 74.19, para: 114.14, queda_pct: 40, controle_pct: 0, fonte: 'coleta' } } }])
  m.D.ativ.set('Acme', { tarefas: [], execucoes: [], promocoes: [{ item_id: 'MLB1', inicio: '2026-09-01', fim: '2026-10-02', preco_original: 114.14 }], sync: '2026-10-14', promo_lida: '2026-10-14', leituras: ['2026-10-02', '2026-10-03', '2026-10-04'] })
  const r = await m.g.avaliar('Acme')
  assert.equal(r.itens.filter(i => i.para_cliente).length, 0, 'nada ao cliente'); const enc = r.itens.filter(i => i.tipo === 'promocao_encerrada')
  assert.equal(enc.length, 1); assert.deepEqual([enc[0].estado, enc[0].dono], ['interno', 'assessoria']); assert.match(enc[0].texto, /^Promoção terminou e o preço voltou ao cheio em 1 anúncio — avaliar renovar: Guia Longa 10m \(vendas −40% desde então\)\.$/)
  assert.ok(m.notifs.some(x => /^aviso_assessoria/.test(x.tipo)), 'a equipe recebe o aviso interno')
})

await ok('só Mercado Livre nas pendências (achado): pendência vencida de Shopee/Amazon/TikTok/Magalu nunca vira item; a do ML vira, no tom aprovado (sem «aguardando seu retorno desde»)', async () => {
  const m = mundo(), p = canal => ({ item: 'aprovar_cadastro', rotulo: 'Aprovação dos cadastros', canal, canal_rotulo: canal, fonte: 'tarefa', dias: 20, desde: '2026-09-22', desde_aproximado: false })
  m.D.pend.set('Acme', { itens: ['shopee', 'amazon', 'tiktok', 'magalu'].map(p), tarefas: [] }); await m.g.avaliar('Acme')
  assert.equal(m.rows('Acme').filter(x => x.tipo === 'dependencia_vencida').length, 0)
  m.D.pend.set('Acme', { itens: [p('ml')], tarefas: [] }); await m.g.avaliar('Acme')
  const r = m.rows('Acme').filter(x => x.tipo === 'dependencia_vencida'); assert.equal(r.length, 1); assert.match(r[0].texto, /^Aprovação dos cadastros: com o seu retorno, a gente segue/); assert.doesNotMatch(r[0].texto, /aguardando seu retorno desde|\(ml\)/)
})

await ok('catálogo no singular e no plural (achado): «1 anúncio que vendia está pausado» × «2 anúncios que vendiam estão pausados»; a carga audita as duas formas', async () => {
  const m = mundo(), d = n => ({ disponivel: true, itens: [{ id: 'MLB1', titulo: 'Grande', curva: 'A', status: 'active', r: 5000, r0: 5000 }, ...Array.from({ length: n }, (_, k) => ({ id: `MLB4${k}`, titulo: `Pausado ${k}`, curva: 'B', status: 'paused', r: 0, r0: 400 }))] })
  m.D.diag.set('Acme', d(1)); assert.match((await m.g.avaliar('Acme')).itens.find(i => i.tipo === 'anuncio_restrito').texto, /^1 anúncio que vendia está pausado ou em revisão:\n/)
  m.D.diag.set('Acme', d(2)); assert.match((await m.g.avaliar('Acme')).itens.find(i => i.tipo === 'anuncio_restrito' && i.estado !== 'resolvido').texto, /^2 anúncios que vendiam estão pausados ou em revisão:\n/)
  // 13/10: pausado por falta de estoque pede reposição; sem estoque conhecido, «vale conferir»
  assert.match((await m.g.avaliar('Acme')).itens.find(i => i.tipo === 'anuncio_restrito' && i.estado !== 'resolvido').texto, /\nVale conferir a situação na sua conta\.$/)
  m.D.diag.set('Acme', { disponivel: true, itens: [{ id: 'MLB1', titulo: 'Grande', curva: 'A', status: 'active', r: 5000, r0: 5000 }, ...[0, 1].map(k => ({ id: `MLB4${k}`, titulo: `Pausado ${k}`, curva: 'B', status: 'paused', estoque: 0, r: 0, r0: 400 }))] })
  assert.match((await m.g.avaliar('Acme')).itens.find(i => i.tipo === 'anuncio_restrito' && i.estado !== 'resolvido').texto, /\nEstão sem estoque: repor faz eles voltarem para a busca\.$/)
  const ruim = JSON.parse(JSON.stringify(lerConfig())); ruim.gatilhos.envio_atrasado.template = '{n} {n|pedido|pedidos garantidos} com prazo vencido.'
  assert.throws(() => validarConfig(ruim), /auditor/, 'a forma do plural também passa pelo auditor')
})

await ok('✅ entregas reais (dadosPlanoSemana, banco em memória): «triplicou» só com os 28 dias seguintes inteiros; «não vendia» exige venda depois; «Criamos» só com tarefa de criação (cadastro/duplicação/kit)', async () => {
  const { dadosPlanoSemana } = await import('../src/lib/gatilhos-real.js')
  const { db } = await import('../src/lib/db.js')
  const C = 'Ômega', dias = (de, n) => Array.from({ length: n }, (_, k) => { const x = new Date(`${de}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10) })
  for (const d of dias('2026-05-01', 165)) db.prepare('INSERT INTO meli_coleta_dia (cliente, dia, pedidos, truncado, coletado_em) VALUES (?, ?, 1, 0, ?)').run(C, d, `${d}T08:00:00.000Z`)
  const anuncio = (id, criado) => db.prepare("INSERT INTO meli_item (cliente, item_id, titulo, criado_em) VALUES (?, ?, ?, ?)").run(C, id, `Produto ${id}`, criado)
  const venda = (id, dia, u, r) => db.prepare('INSERT INTO meli_serie_item (cliente, item_id, dia, unidades, receita) VALUES (?, ?, ?, ?, ?)').run(C, id, dia, u, r)
  anuncio('MLB71', '2025-01-01'); venda('MLB71', '2026-09-10', 1, 75); for (const d of dias('2026-09-23', 6)) venda('MLB71', d, 1, 75)        // entregue há 20 dias: 1 → 6 un (R$ 450)
  anuncio('MLB72', '2025-01-01'); for (const d of dias('2026-08-10', 10)) venda('MLB72', d, 4, 100)                                          // «lancamento» sem venda nos 28 dias seguintes
  anuncio('MLB73', '2026-06-02'); for (const d of dias('2026-06-05', 10)) venda('MLB73', d, 2, 50)                                           // nasceu junto de uma tarefa de OTIMIZAR
  anuncio('MLB74', '2026-06-02'); for (const d of dias('2026-06-05', 10)) venda('MLB74', d, 2, 50)                                           // nasceu junto de uma tarefa de CADASTRO
  const medidas = [{ estado: 'melhorou', data: '2026-09-22', itens: ['MLB71'], tipo: 'Otimizar anúncio', titulo: 'Otimizar A' }, { estado: 'lancamento', data: '2026-06-01', itens: ['MLB72'], tipo: 'Corrigir ficha técnica', titulo: 'Ficha B' },
    { estado: 'lancamento', data: '2026-06-01', itens: ['MLB73'], tipo: 'Otimizar anúncio', titulo: 'Otimizar C' }, { estado: 'lancamento', data: '2026-06-01', itens: ['MLB74'], tipo: 'Cadastro de produto', titulo: 'Cadastrar D' }]
  const d = dadosPlanoSemana(C, { diag: { disponivel: true, hoje: '2026-10-12', resumo: { gmv: 1, pedidos: 1 }, itens: [] }, medidas })
  const e = Object.fromEntries(d.entregas.map(x => [x.titulo.split(' ')[1], x]))
  assert.ok(!e.MLB71, 'entrega de 20 dias atrás: nunca «nos 28 dias seguintes» (a janela não existe ainda)'); assert.ok(!e.MLB72, 'sem venda depois da entrega: não entra em «está dando resultado» (achado da Bima)')
  assert.ok(!e.MLB73, 'tarefa de otimizar num anúncio que nasceu junto: nunca «Criamos» e nunca «ele não vinha vendendo» (não existia antes; 14/10) — fica fora'); assert.equal(e.MLB74?.criado, true, 'tarefa de cadastro: «Criamos»')
})

// ═════════ DECISÕES FINAIS do David (12/10/2026), com a configuração REAL: terça, só semanal, início 20/10, integração ML de fato, liberação em lote ═════════
const HOOK = 'https://discord.com/api/webhooks/1483835626619932803/' + 'a'.repeat(60), CONS_ID = '712345678901234567'
// time no Discord ligado sobre o MESMO banco/gatilhos do mundo: destino só para os clientes de `com`
const time = (m, com = ['Acme']) => {
  const env = []
  const cons = criarConsultorDiscord({ handle: m.h, gatilhos: m.g, agora: m.rl.agora, validarPor, fontes: { dados: () => ({ medidas: [] }), destinoInterno: async c => com.includes(c) ? { discord: HOOK, consultor: CONS_ID } : { discord: '', consultor: '' } },
    envio: { configurado: () => true, enviarInterno: async x => { env.push(x); return { estado: 'enviado', motivo: '' } } } })
  cons.chave({ ligado: true, por: POR })
  return { cons, env }
}
const configurarPadrao = (m, c) => m.g.configurar({ cliente: c, por: POR, notificacao: { canais: { whatsapp: { ligado: true, destino: '120363012345678901@g.us' } } } })   // sem ritmo: o PADRÃO

await ok('decisões finais (config real): terça — time 08:30 e cliente 09:00 até 20:00; urgente interno ao time desligado; inicio_envios 2026-10-20 validado; urgente ao cliente NASCE desligado (padrão + migração única do padrão antigo)', () => {
  const cfg = lerConfig()
  assert.deepEqual(cfg.semanal, { dia_semana: 2, hora: '09:00', ate: '20:00' })
  assert.deepEqual([cfg.consultor.dia_semana, cfg.consultor.hora, cfg.consultor.ate, cfg.consultor.urgente_ligado], [2, '08:30', '20:00', false])
  assert.equal(cfg.inicio_envios, '2026-10-20')
  for (const v of ['20/10/2026', '2026-13-45', 'amanhã', 20261020]) assert.throws(() => validarConfig({ ...JSON.parse(JSON.stringify(cfg)), inicio_envios: v }), /inicio_envios/, String(v))
  assert.doesNotThrow(() => validarConfig({ ...JSON.parse(JSON.stringify(cfg)), inicio_envios: '' }), 'vazio = sem trava')
  assert.equal(validarNotificacao({ canais: {} }, cfg).ritmo.critico_na_hora, false, 'padrão ao salvar')
  // migração: o critico_na_hora: true gravado pelo PADRÃO antigo (a tela vinha marcada) vira false UMA vez; quem marcar depois fica marcado
  const h = new Database(':memory:'); h.exec("CREATE TABLE clientes_central (cliente TEXT PRIMARY KEY, status_cs TEXT NOT NULL DEFAULT 'Ativo', notificacao_json TEXT NOT NULL DEFAULT '{}')")
  h.prepare('INSERT INTO clientes_central (cliente, notificacao_json) VALUES (?,?), (?,?), (?,?)').run('Rotec', JSON.stringify({ canais: { whatsapp: { ligado: false, destino: '120363012345678901@g.us' } }, ritmo: { critico_na_hora: true, resumo_hora: '08:00' } }), 'Pavio', '{}', 'Uniao', JSON.stringify({ ritmo: { critico_na_hora: false } }))
  const novo = () => criarGatilhos({ handle: h, fontes: {}, cfg, validarPor, elegiveis: () => ['Rotec', 'Pavio', 'Uniao'].map(c => ({ cliente: c, status: 'Ativo' })), clienteCanonico: c => c })
  let g = novo(); assert.deepEqual(['Rotec', 'Pavio', 'Uniao'].map(c => g.notificacao(c).ritmo.critico_na_hora), [false, false, false])
  assert.equal(JSON.parse(h.prepare("SELECT notificacao_json j FROM clientes_central WHERE cliente = 'Rotec'").get().j).ritmo.resumo_hora, '08:00', 'só o critico_na_hora muda')
  g.configurar({ cliente: 'Rotec', por: POR, notificacao: { canais: { whatsapp: { ligado: false, destino: '120363012345678901@g.us' } }, ritmo: { critico_na_hora: true } } })
  g = novo(); assert.equal(g.notificacao('Rotec').ritmo.critico_na_hora, true, 'migração roda uma vez só: a escolha explícita depois dela fica')
})

await ok('só semanal: com TUDO ligado (chave dos avisos, chave do time, cliente liberado, canal, integração ML) e urgentes de pé, num dia que não é terça NADA sai — nem ao cliente nem ao time; terça 08:30 sai o resumo do time e 09:00 o plano, levando os urgentes', async () => {
  const m = mundo({ cfg: lerConfig() }); m.tudo('Acme'); m.plano('Acme', { custosInformados: false })
  configurarPadrao(m, 'Acme'); m.liberar('Acme'); m.ligar()
  assert.equal(m.g.notificacao('Acme').ritmo.critico_na_hora, false, 'urgente na hora nasce desligado')
  const { cons, env } = time(m)
  for (const [d, hr] of [['2026-10-21', '08:40'], ['2026-10-21', '09:10'], ['2026-10-21', '15:00'], ['2026-10-22', '10:00'], ['2026-10-25', '09:00'], ['2026-10-26', '08:40'], ['2026-10-26', '09:10'], ['2026-10-26', '19:00']]) {
    m.rl.ir(d, hr); await cons.tick(); const t = await m.g.tick()
    assert.deepEqual([m.envios.length, env.length, t.imediatos, t.semanais], [0, 0, 0, 0], `${d} ${hr}: fora da terça nada sai`)
  }
  assert.ok(m.rows('Acme').some(r => r.tipo === 'envio_atrasado' && r.estado === 'pendente' && !r.lote_id), 'o urgente foi detectado e espera o plano de terça')
  assert.ok(m.rows('Acme').some(r => r.tipo === 'queda_forte_conta' && r.estado === 'interno'), 'o urgente interno do time existe e não saiu (urgente_ligado = false)')
  assert.equal(m.lotes('Acme').length, 0, 'nenhum lote montado fora da terça')
  m.rl.ir('2026-10-27', '08:30'); await cons.tick(); let t = await m.g.tick()
  assert.deepEqual([env.length, m.envios.length, t.semanais], [1, 0, 0], 'terça 08:30: só o resumo do time'); assert.equal(env[0].lote.tipo, 'interno_semanal')
  m.rl.ir('2026-10-27', '09:00'); await cons.tick(); t = await m.g.tick()
  assert.deepEqual([env.length, m.envios.length, t.imediatos, t.semanais], [1, 1, 0, 1], 'terça 09:00: o plano do cliente (uma mensagem)')
  const l = m.lotes('Acme')[0]; assert.equal(l.tipo, 'semanal'); assert.match(l.texto_final, /🚚/, 'o despacho vencido (urgente) entrou no plano de terça')
  assert.ok(!m.lotes('Acme').some(x => x.tipo === 'imediato'), 'nenhum lote imediato')
})

await ok('início: nenhum envio automático antes de 2026-10-20 — terça 13/10 08:40/09:10 nada (cliente e time, nem pelo cron de reserva), elegível diz antes_do_inicio e a prévia funciona sem gravar; terça 20/10 08:30 sai o resumo do time e 09:00 o plano', async () => {
  const m = mundo({ cfg: lerConfig(), urgenteNaHora: false }); m.pronto('Acme'); m.plano('Acme', { custosInformados: false })
  const { cons, env } = time(m)
  m.rl.ir('2026-10-13', '08:40'); await cons.tick(); m.rl.ir('2026-10-13', '09:10'); await m.g.tick()
  assert.deepEqual([env.length, m.envios.length, m.lotes('Acme').length, m.h.prepare('SELECT COUNT(*) n FROM consultor_aviso').get().n], [0, 0, 0, 0])
  assert.deepEqual(m.g.elegivel('Acme'), { ok: false, motivo: 'antes_do_inicio' }); assert.match(m.g.textoMotivo('antes_do_inicio'), /20\/10\/2026/)
  const pv = await m.g.enviar({ cliente: 'Acme' }); assert.equal(pv.previa, true); assert.match(pv.texto_final, /planilha de custos/, 'prévia do plano funciona'); assert.equal(m.lotes('Acme').length, 0, 'prévia não grava')
  const pc = await cons.listarCliente('Acme', { previa: true }); assert.match(pc.previa.partes[0], /^<@&\d{15,21}> <@&\d{15,21}> <@&\d{15,21}> <@712345678901234567>\n\*\*Resumo semanal/); assert.equal(m.h.prepare('SELECT COUNT(*) n FROM consultor_aviso').get().n, 0)
  // cron de reserva (n8n): os MESMOS ticks, com a mesma trava
  const SEG = 'segredo-de-teste-nunca-impresso-32c', app = express(); app.use(criarRotasGatilhosHmac({ gatilhos: m.g, consultor: cons, secret: () => SEG, agoraMs: () => m.rl.ms }))
  const srv = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)) })
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/webhook/gatilhos/lote-diario`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-place-key': SEG }, body: '{"origem":"n8n-cron"}' })
    assert.equal(r.status, 200); const j = await r.json(); assert.deepEqual([j.semanais, j.consultor.semanais, env.length, m.envios.length], [0, 0, 0, 0], 'cron de reserva em 13/10: nada')
  } finally { srv.close() }
  m.rl.ir('2026-10-20', '08:30'); await cons.tick(); await m.g.tick(); assert.deepEqual([env.length, m.envios.length], [1, 0], '20/10 08:30: o resumo do time')
  m.rl.ir('2026-10-20', '09:00'); await m.g.tick(); assert.deepEqual([env.length, m.envios.length], [1, 1], '20/10 09:00: o plano do cliente'); assert.equal(m.lotes('Acme')[0].dia, '2026-10-20')
})

await ok('integração ML de fato: função ÚNICA com 3 motivos fixos (sem_conexao_ml, coleta_atrasada, sem_vendas_28d; vendas na janela do diagnóstico hoje−28…hoje−1); sem ela o cliente não é elegível e nada sai; sem a fonte injetada, nada sai sozinho', async () => {
  const jan = []
  const L = (o = {}) => ({ conectado: () => true, ultimaColeta: () => '2026-10-11', vendas28d: (c, j) => { jan.push(j); return 5 }, hoje: () => '2026-10-14', ...o })
  assert.deepEqual(integracaoMlAtiva('A', L()), { ok: true, motivo: '' }); assert.deepEqual(jan[0], { de: '2026-09-16', ate: '2026-10-13' }, 'mesma janela do diagnóstico (carregarBase)')
  assert.deepEqual(integracaoMlAtiva('A', L({ conectado: () => false })), { ok: false, motivo: 'sem_conexao_ml' })
  assert.deepEqual(integracaoMlAtiva('A', L({ ultimaColeta: () => '2026-10-10' })), { ok: false, motivo: 'coleta_atrasada' }, '4 dias sem coleta')
  assert.deepEqual(integracaoMlAtiva('A', L({ ultimaColeta: () => '' })), { ok: false, motivo: 'coleta_atrasada' }, 'nunca coletado')
  assert.deepEqual(integracaoMlAtiva('A', L({ vendas28d: () => 0 })), { ok: false, motivo: 'sem_vendas_28d' })
  assert.deepEqual(Object.keys(MOTIVOS_INTEGRACAO), ['sem_conexao_ml', 'coleta_atrasada', 'sem_vendas_28d'])
  // nos gatilhos: elegível exige integração; o motivo vai à tela
  for (const motivo of Object.keys(MOTIVOS_INTEGRACAO)) {
    const m = mundo({ integracao: c => c === 'Acme' ? { ok: false, motivo } : INTEGRADO() }); m.tudo('Acme'); m.pronto('Acme')
    assert.deepEqual(m.g.elegivel('Acme'), { ok: false, motivo }); assert.equal(m.g.textoMotivo(motivo), MOTIVOS_INTEGRACAO[motivo])
    m.rl.ir('2026-10-19', '09:10'); await m.g.tick(); assert.equal(m.envios.length, 0, motivo + ': nada sai')
    assert.deepEqual(m.g.elegivel('Acme', { manual: true }), { ok: false, motivo }, 'o envio manual também exige a integração ML de fato (decisão 6: cliente e time)')
    const em = await m.g.enviar({ cliente: 'Acme', confirmar: true, por: POR }); assert.deepEqual([em.ok, em.motivo, m.envios.length], [false, motivo, 0], motivo + ': manual confirmado não sai')
  }
  const m = mundo({ integracao: () => { throw new Error('banco') } }); m.pronto('Acme'); assert.deepEqual(m.g.elegivel('Acme'), { ok: false, motivo: 'integracao_indisponivel' })
  const h = new Database(':memory:'); h.exec("CREATE TABLE clientes_central (cliente TEXT PRIMARY KEY, status_cs TEXT NOT NULL DEFAULT 'Ativo', notificacao_json TEXT NOT NULL DEFAULT '{}')"); h.prepare("INSERT INTO clientes_central (cliente, notificacao_json) VALUES ('Acme', ?)").run(JSON.stringify({ canais: { whatsapp: { ligado: true, destino: '120363012345678901@g.us' } }, liberado_por: POR }))
  const g = criarGatilhos({ handle: h, fontes: {}, cfg: cfgMecanica(), validarPor, elegiveis: () => [{ cliente: 'Acme', status: 'Ativo' }], clienteCanonico: c => c }); g.chave({ ligado: true, por: POR })
  assert.equal(g.elegivel('Acme').motivo, 'sem_conexao_ml', 'sem a fonte injetada não dá para confirmar a integração: nada sai sozinho')
})

await ok('liberação em lote (prepararLote / POST /api/gatilhos/preparar-lote): prévia não grava; confirmar preenche SÓ o grupo «Id whatsapp meli» vazio, liga o WhatsApp, mantém o urgente desligado e libera; listas sem o valor do destino; idempotente; 415/403 sem eco', async () => {
  const CL = ['Acme', 'Beta', 'Gama', 'Delta', 'Epsilon', 'Zeta']
  const m = mundo({ clientes: [...CL.map(c => [c, 'Ativo']), ['[Comercial] Loja X · 7', 'Ativo'], ['Congelado', 'Congelado']], integracao: c => c === 'Delta' ? { ok: false, motivo: 'sem_vendas_28d' } : INTEGRADO() })
  m.configurar('Epsilon', { whatsapp: { ligado: false, destino: '120363000000000005@g.us' } })          // grupo já gravado, canal desligado e urgente ligado (mundo de mecânica)
  const lidos = []
  const central = async c => { lidos.push(c); return ({
    Acme: { achado: true, destinos: { invalidos: [] }, sugestao: { whatsapp: { destino: '120363000000000001@g.us', origem: 'central:ml' }, email: { destino: 'dono@acme.com.br', origem: 'central' } } },
    Beta: { achado: true, destinos: { invalidos: [] }, sugestao: { whatsapp: { destino: '', origem: '' }, email: { destino: 'b@beta.com.br', origem: 'central' } } },
    Gama: { achado: true, destinos: { invalidos: ['whatsapp'] }, sugestao: { whatsapp: { destino: '', origem: '' } } },
    Zeta: { achado: false, motivo: 'notion_indisponivel' } })[c] || { achado: false, motivo: 'cliente_nao_esta_na_central' } }
  const foto = () => JSON.stringify(m.h.prepare('SELECT cliente, notificacao_json FROM clientes_central ORDER BY cliente').all())
  const LISTAS = { liberados: ['Acme', 'Epsilon'], sem_grupo_ml: ['Beta'], sem_integracao: [{ cliente: 'Delta', motivo: 'sem_vendas_28d' }], invalidos: ['Gama'], nao_lidos: [{ cliente: 'Zeta', motivo: 'notion_indisponivel' }] }
  const antes = foto(), p = await m.g.prepararLote({ por: POR, central })
  assert.deepEqual(p, { ok: true, previa: true, ...LISTAS }); assert.equal(foto(), antes, 'prévia não grava nada'); assert.ok(!lidos.includes('Epsilon') && !lidos.includes('Delta'), 'quem já tem grupo ou não tem integração não consulta a central')
  const r = await m.g.prepararLote({ por: POR, confirmar: true, central })
  assert.deepEqual(r, { ok: true, previa: false, ...LISTAS }); assert.doesNotMatch(JSON.stringify([p, r]), /@g\.us|acme\.com|beta\.com|1203630/, 'nunca o valor do destino')
  const a = m.g.notificacao('Acme'), e = m.g.notificacao('Epsilon')
  assert.deepEqual([a.canais.whatsapp, a.canais.email.destino, a.ritmo.critico_na_hora, a.liberado_por], [{ ligado: true, destino: '120363000000000001@g.us' }, '', false, POR], 'só o grupo do ML (o e-mail não é preenchido no lote)')
  assert.deepEqual([e.canais.whatsapp, e.ritmo.critico_na_hora, e.liberado_por], [{ ligado: true, destino: '120363000000000005@g.us' }, false, POR], 'grupo existente: canal ligado, urgente desligado, liberado')
  for (const c of ['Beta', 'Gama', 'Delta', 'Zeta']) assert.equal(m.g.notificacao(c).liberado_por, '', c + ' não liberado')
  const depois = foto(), r2 = await m.g.prepararLote({ por: 'Giovanna Torres', confirmar: true, central })
  assert.deepEqual(r2, r, 'idempotente: mesmas listas'); assert.equal(foto(), depois, 'idempotente: nada regravado (quem liberou e quando ficam)')
  await assert.rejects(m.g.prepararLote({ por: 'Fulano', confirmar: true, central }), x => x.status === 403 && !/Fulano/.test(x.message))
  assert.deepEqual(preencherVazios({ whatsapp: { ligado: false, destino: 'x@g.us' }, email: { ligado: false, destino: '' }, notion: { ligado: true } }, { whatsapp: { destino: 'y@g.us' }, email: { destino: 'e@e.com', origem: 'central' } }, ['whatsapp']),
    { canais: { whatsapp: { ligado: false, destino: 'x@g.us' }, email: { ligado: false, destino: '' }, notion: { ligado: true } }, preenchidos: [] }, 'nunca sobrescreve; só os canais pedidos')
  // HTTP
  const app = express(); app.use(express.json()); app.use(criarRotasGatilhos({ gatilhos: m.g, quem: () => QUEM, clienteCanonico: c => c, buscarDestinos: central }))
  const srv = await new Promise(rs => { const s = app.listen(0, '127.0.0.1', () => rs(s)) }), base = `http://127.0.0.1:${srv.address().port}`
  const post = async (corpo, tipo = 'application/json') => { const x = await fetch(base + '/api/gatilhos/preparar-lote', { method: 'POST', headers: { 'Content-Type': tipo }, body: JSON.stringify(corpo) }); const t = await x.text(); return { status: x.status, t, j: JSON.parse(t) } }
  try {
    assert.equal((await post({ por: POR }, 'text/plain')).status, 415)
    let x = await post({ por: 'Fulano' }); assert.equal(x.status, 403); assert.ok(!x.t.includes('Fulano'))
    x = await post({ por: POR, confirmar: 'true' }); assert.deepEqual([x.status, x.j.previa, x.j.liberados], [200, true, ['Acme', 'Epsilon']], 'confirmar só se for exatamente true'); assert.doesNotMatch(x.t, /@g\.us/)
  } finally { srv.close() }
})

// ── revisão das decisões finais (12/10/2026): achados corrigidos, um teste por correção ──────────────────────────────────────────────────────────────────────────
await ok('plano de terça não trava por envio manual de segunda que não saiu: o lote de segunda vence (lote_vencido) e a terça remonta com tentativa nova — n8n 500 ou sem credencial na segunda 26/10 → terça 27/10 o plano sai UMA vez', async () => {
  for (const resp of [{ estado: 'falhou', motivo: 'n8n_500', recibos: {} }, { estado: 'pendente', motivo: 'n8n_nao_configurado', recibos: {} }]) {
    const m = mundo({ cfg: lerConfig() }); m.tudo('Acme'); m.plano('Acme', { custosInformados: false }); configurarPadrao(m, 'Acme'); m.liberar('Acme'); m.ligar()
    m.rl.ir('2026-10-26', '15:00'); m.envio.resposta = resp
    const r1 = await m.g.enviar({ cliente: 'Acme', confirmar: true, por: POR, tipo: 'semanal' }); assert.equal(r1.estado, resp.estado, 'segunda: o manual não saiu')
    m.envio.resposta = null; const antes = m.envios.length
    let semanais = 0
    for (const hr of ['09:00', '09:10', '12:00', '19:50']) { m.rl.ir('2026-10-27', hr); semanais += (await m.g.tick()).semanais }
    assert.deepEqual([semanais, m.envios.length - antes], [1, 1], `${resp.motivo}: terça, o plano sai uma vez`)
    assert.deepEqual(m.lotes('Acme').filter(l => l.tipo === 'semanal').map(l => [l.dia, l.estado, l.motivo]), [['2026-10-26', 'falhou', 'lote_vencido'], ['2026-10-27', 'enviado', '']])
  }
})

await ok('só semanal com a caixa «urgente na hora» MARCADA no cliente: config urgente.na_hora_ligado = false → quarta 21/10 nada sai (nem lote imediato); só o config true devolve o imediato (a trava é o config)', async () => {
  const rodar = async cfg => {
    const m = mundo({ cfg }); m.tudo('Acme'); m.plano('Acme', { custosInformados: false })
    m.g.configurar({ cliente: 'Acme', por: POR, notificacao: { canais: { whatsapp: { ligado: true, destino: '120363012345678901@g.us' } }, ritmo: { critico_na_hora: true } } }); m.liberar('Acme'); m.ligar()
    assert.equal(m.g.notificacao('Acme').ritmo.critico_na_hora, true, 'caixa marcada (pela API)')
    let imediatos = 0
    for (const hr of ['10:00', '10:10', '15:00']) { m.rl.ir('2026-10-21', hr); const x = await m.g.tick(); imediatos += x.imediatos + x.retentados }
    return { m, imediatos }
  }
  // 14/10/2026: o David LIGOU o urgente de estoque e preço no config real; o contrato «config false = nada sai» é testado com uma cópia desligada
  assert.equal(lerConfig().urgente.na_hora_ligado, false, 'config real: urgente bloqueado pelo David em 23/10 (ligado de 14 a 23/10)')
  const off = JSON.parse(JSON.stringify(lerConfig())); off.urgente.na_hora_ligado = false
  const a = await rodar(validarConfig(off)); assert.deepEqual([a.m.envios.length, a.imediatos, a.m.lotes('Acme').length], [0, 0, 0], 'quarta, config desligado e caixa marcada: nada sai')
  const on = JSON.parse(JSON.stringify(lerConfig())); on.urgente.na_hora_ligado = true; on.urgente.impacto_min_reais = 0   // mecânica: fixture abaixo do piso real
  const b = await rodar(validarConfig(on)); assert.ok(b.imediatos >= 1 && b.m.lotes('Acme').some(l => l.tipo === 'imediato'), 'config ligado: o lote imediato volta')
  const ruim = JSON.parse(JSON.stringify(lerConfig())); ruim.urgente.na_hora_ligado = 'sim'; assert.throws(() => validarConfig(ruim), /na_hora_ligado/)
})

await ok('início vale também para o manual confirmado e o teste de canal: terça 13/10 (chave desligada, não liberado) → antes_do_inicio, nada ao n8n; a prévia funciona; 20/10 o manual sai', async () => {
  const m = mundo({ cfg: lerConfig() }); m.plano('Acme', { custosInformados: false }); configurarPadrao(m, 'Acme')
  let testes = 0; const t0 = m.envio.testar; m.envio.testar = async x => { testes++; return t0(x) }
  m.rl.ir('2026-10-13', '10:00')
  const r = await m.g.enviar({ cliente: 'Acme', confirmar: true, por: POR, tipo: 'semanal' }); assert.deepEqual([r.ok, r.motivo], [false, 'antes_do_inicio']); assert.match(r.mensagem, /20\/10\/2026/)
  const t = await m.g.testar({ cliente: 'Acme', canal: 'whatsapp', por: POR }); assert.deepEqual([t.ok, t.motivo], [false, 'antes_do_inicio'])
  assert.deepEqual([m.envios.length, testes, m.lotes('Acme').length], [0, 0, 0], 'nada chegou ao n8n e nada foi gravado')
  const pv = await m.g.enviar({ cliente: 'Acme' }); assert.equal(pv.previa, true); assert.deepEqual(pv.elegivel, { ok: false, motivo: 'antes_do_inicio' }); assert.match(pv.texto_final, /planilha de custos/)
  m.rl.ir('2026-10-20', '10:00')
  assert.deepEqual([(await m.g.enviar({ cliente: 'Acme', confirmar: true, por: POR })).ok, (await m.g.testar({ cliente: 'Acme', canal: 'whatsapp', por: POR })).ok, m.envios.length, testes], [true, true, 1, 1], '20/10: manual e teste saem')
})

await ok('preparar-lote: destino salvo fora do formato (número legado) cai em «invalidos» na prévia E no confirmar (a prévia não promete o que o confirmar não faz); grupo novo preenchido = liberação nova em nome de quem rodou; mesmo grupo mantém quem liberou', async () => {
  const m = mundo({ clientes: [['Acme', 'Ativo'], ['Beta', 'Ativo'], ['Gama', 'Ativo']] })
  const grava = (c, n) => m.h.prepare('UPDATE clientes_central SET notificacao_json = ? WHERE cliente = ?').run(JSON.stringify(n), c)
  grava('Acme', { canais: { whatsapp: { ligado: false, destino: '5511999998888' } } })                                                        // legado: número, não grupo
  grava('Beta', { canais: { email: { ligado: true, destino: 'dono@beta.com.br' } }, liberado_por: 'Giovanna Torres', liberado_em: '2026-10-01T12:00:00.000Z' })   // liberado só com e-mail
  grava('Gama', { canais: { whatsapp: { ligado: true, destino: '120363000000000007@g.us' } }, liberado_por: 'Giovanna Torres', liberado_em: '2026-10-01T12:00:00.000Z' })
  const central = async c => ({ achado: true, destinos: { invalidos: [] }, sugestao: { whatsapp: { destino: c === 'Beta' ? '120363000000000002@g.us' : '', origem: 'central:ml' } } })
  const p = await m.g.prepararLote({ por: POR, central }), r = await m.g.prepararLote({ por: POR, confirmar: true, central })
  for (const x of [p, r]) assert.deepEqual([x.liberados, x.invalidos, x.nao_lidos], [['Beta', 'Gama'], ['Acme'], []], x.previa ? 'prévia' : 'confirmar')
  assert.equal(m.g.notificacao('Acme').liberado_por, '', 'Acme não liberado')
  const b = m.g.notificacao('Beta'); assert.deepEqual([b.canais.whatsapp, b.liberado_por, b.liberado_em > '2026-10-02'], [{ ligado: true, destino: '120363000000000002@g.us' }, POR, true], 'grupo novo: liberado por quem rodou o lote, agora')
  const g = m.g.notificacao('Gama'); assert.deepEqual([g.liberado_por, g.liberado_em], ['Giovanna Torres', '2026-10-01T12:00:00.000Z'], 'mesmo grupo: mantém quem liberou')
})

await ok('universo REAL dos gatilhos e do time = todo cliente Ativo da central, SEM exigir tarefa sincronizada (Cronometal/Christian Ponce); prospect e Congelado fora; recebe() dá o motivo da integração, não «Só clientes Ativos»', async () => {
  const { db } = await import('../src/lib/db.js'), { criarGatilhosReal, clientesDaCentral } = await import('../src/lib/gatilhos-real.js')
  const ins = db.prepare("INSERT OR REPLACE INTO clientes_central (cliente, status_cs, atualizado_em) VALUES (?, ?, '2026-10-12')")
  for (const [c, st] of [['Cronometal - Lucas de Souza', 'Ativo'], ['[Comercial] Loja Y · 9', 'Ativo'], ['Velha Congelada', 'Congelado']]) ins.run(c, st)
  assert.equal(db.prepare("SELECT COUNT(*) n FROM tarefas WHERE cliente = 'Cronometal - Lucas de Souza'").get().n, 0, 'sem base de tarefas')
  assert.ok(clientesDaCentral().some(x => x.cliente === 'Cronometal - Lucas de Souza' && x.status === 'Ativo'))
  const g = criarGatilhosReal({ clienteCanonico: c => c }), ativos = g.clientesAtivos()
  assert.ok(ativos.includes('Cronometal - Lucas de Souza')); assert.ok(!ativos.some(c => /Comercial|Congelada/.test(c)))
  const cons = criarConsultorDiscord({ handle: db, gatilhos: g, agora: () => '2026-10-27T11:40:00.000Z', time: { cargos: ['1517119651522547774'], marcar_consultor: true } })
  const rc = (await cons.listarCliente('Cronometal - Lucas de Souza')).recebe; assert.notEqual(rc.motivo, 'cliente_inelegivel'); assert.equal(rc.motivo, g.integracao('Cronometal - Lucas de Souza').motivo, 'o motivo é o da integração ML')
})

console.log(`\n${n} verificações dos gatilhos ok.`)
