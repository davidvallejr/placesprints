// Autoteste do envio do relatório ao Notion (relatorio-envio.js): AGENDA pura (sexta→sexta, antecipar, mensal com âncora, 2028 bissexto, perdido = um envio, datas iguais
// em qualquer fuso), banco e índice único, prévia que não grava, confirmar estrito, idempotência, bloqueios (conteúdo, destino, categoria), timeout e trava por cliente,
// programação, liberação, diagnóstico, agendador (interruptor, janela, liberação, elegíveis, backoff, pausa, orçamento) e lote. Banco em memória + stub do Notion + relógio falso.
// Rodar: node scripts/teste-relatorio-envio.mjs   (e, por fora: TZ=Pacific/Auckland node scripts/teste-relatorio-envio.mjs)
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { SCHEMA_RELATORIO, somarDias, diasEntre, diaSemana, dataValida, janelaNominal, proximaSexta, proximaData, aposEnvio, datasPrevistas, dentroDaJanela, devido, backoffMin, validarConfig, lerConfig, FREQUENCIAS, semearProgramacao, paraCsv } from '../src/lib/relatorio-envio.js'
import { briefParaBlocos } from '../src/lib/relatorio-notion.js'
import { CATEGORIA } from '../src/lib/relatorio-seguro.js'
import * as LIB from '../src/lib/relatorio-envio.js'      // exports novos são usados por aqui (a suíte inteira carrega mesmo contra o módulo antigo: serve para provar que o teste FALHA antes da correção)
import { briefSintetico, montarEnvio, confirmar, linhasEnvio, esperar, SEGREDO, norm } from './fixtures/relatorio-mundo.mjs'
import { montarAlerta } from './fixtures/alerta-mundo.mjs'   // G2: o alerta ao cliente NÃO usa o plano B

// ── digest da agenda: o mesmo texto em qualquer TZ (o teste se reexecuta com TZ diferentes) ─────────────────────────────────
function digest() {
  const out = []
  for (let d = '2026-01-01', i = 0; i < 1100; i++, d = somarDias(d, 1)) out.push(`${d}|${diaSemana(d)}|${proximaSexta(d)}|${proximaData('semanal', d)}|${proximaData('mensal', d, { ancoraDia: 31 })}|${janelaNominal(d).de}`)
  const p = { frequencia: 'semanal', proximo_envio: '2026-10-16', ancora_dia: 0 }
  for (const h of ['2026-10-09', '2026-10-11', '2026-10-14', '2026-10-16', '2026-10-17', '2026-10-25', '2026-10-26']) out.push(aposEnvio(p, h), aposEnvio({ ...p, frequencia: 'mensal', proximo_envio: '2026-10-31' }, h), aposEnvio({ ...p, frequencia: 'quinzenal' }, h))
  out.push(datasPrevistas({ frequencia: 'mensal', proximo_envio: '2027-01-31', ancora_dia: 0 }, 5).join(','))
  return out.join('\n')
}
if (process.argv.includes('--digest')) { process.stdout.write(digest() + '\n', () => process.exit(0)); await new Promise(() => {}) }   // espera o pipe esvaziar (exit direto truncaria a saída)

let n = 0
// SO=F1.7 node scripts/teste-relatorio-envio.mjs  → roda só os blocos cujo nome contém o texto (prova de que um teste novo falha no módulo antigo)
const ok = async (nome, fn) => { if (process.env.SO && !nome.includes(process.env.SO)) return; try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const falha = async (fn, rx, status = 400) => { let e; try { await fn() } catch (x) { e = x } assert.ok(e, 'devia ter falhado'); assert.match(e.message, rx); assert.equal(e.status, status); return e }
const ISO = (h, hr = '17:00') => new Date(Date.parse(`${h}T${hr}:00-03:00`)).toISOString()
const diagPronto = (estado, cliente, o = {}, relogio) => estado.set(`rel_diag:${cliente}`, JSON.stringify({ cliente, em: relogio ? relogio.agora() : new Date().toISOString(), pagina: 'P', informacoes: 'https://www.notion.so/x', secao_tipo: 'select', categoria: 'ok', destino: 'ok', perfil: 'padrao', ml_conectado: true, pronto: true, proxima_acao: '', ...o }))
const semearProg = (h, cliente, o = {}) => h.prepare(`INSERT INTO relatorio_programacao (cliente, frequencia, proximo_envio, ancora_dia, ativado_por, ativado_em, tentar_apos, falhas_seguidas, pausado_motivo, atualizado_em)
  VALUES (@cliente, @frequencia, @proximo_envio, @ancora_dia, @ativado_por, @ativado_em, @tentar_apos, @falhas_seguidas, @pausado_motivo, @atualizado_em)
  ON CONFLICT(cliente) DO UPDATE SET frequencia=@frequencia, proximo_envio=@proximo_envio, ancora_dia=@ancora_dia, ativado_por=@ativado_por, ativado_em=@ativado_em, tentar_apos=@tentar_apos, falhas_seguidas=@falhas_seguidas, pausado_motivo=@pausado_motivo, atualizado_em=@atualizado_em`)
  .run({ cliente, frequencia: 'semanal', proximo_envio: '2026-10-16', ancora_dia: 0, ativado_por: 'Giovanna Torres', ativado_em: '2026-10-10T12:00:00.000Z', tentar_apos: '', falhas_seguidas: 0, pausado_motivo: '', atualizado_em: 'x', ...o })
const prog = (h, c) => h.prepare('SELECT * FROM relatorio_programacao WHERE cliente = ?').get(c)
const contar = (h, t) => h.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n
const muitos = k => Array.from({ length: k }, (_, i) => [`Cli ${String(i).padStart(2, '0')}`, {}])
const ligar = m => m.e.agendador({ ligado: true, por: 'Carla Souza' })
const MSG_INELEGIVEL = 'só clientes Ativos recebem relatório; mude o status na central'

// o agendador lê dia e hora no fuso da config (Intl), NUNCA no fuso do processo: o teste se reexecuta em outros TZ e o resultado tem de ser idêntico
const CASOS_FUSO = [['2026-10-16', '22:30'], ['2026-10-16', '16:59'], ['2026-10-16', '23:00'], ['2026-10-17', '18:00'], ['2026-10-18', '19:00'], ['2026-10-19', '17:00']]
const ESPERADO_FUSO = ['2026-10-16 22:30 enviou', '2026-10-16 16:59 fora_da_janela', '2026-10-16 23:00 fora_da_janela', '2026-10-17 18:00 fora_da_janela', '2026-10-18 19:00 fora_da_janela', '2026-10-19 17:00 enviou']
async function rodarFuso() {
  const out = []
  for (const [d, hr] of CASOS_FUSO) {
    const m = montarEnvio({ hoje: d, hora: hr, semRelogioInjetado: true })          // sem hoje()/hora() injetados: valem os padrões do módulo
    ligar(m); semearProg(m.h, 'Acme', { proximo_envio: '2026-10-09' })
    const r = await m.e.tick(); out.push(`${d} ${hr} ${r.pulou || (r.enviados ? 'enviou' : 'nada')}`)
  }
  return out
}
if (process.argv.includes('--fuso')) { process.stdout.write((await rodarFuso()).join('\n') + '\n', () => process.exit(0)); await new Promise(() => {}) }

// ═══ AGENDA (pura) ═══════════════════════════════════════════════════════════════════════════════════════════════════
await ok('datas em dias inteiros: somarDias/diasEntre/diaSemana/dataValida; janela dos 7 dias FECHADOS', () => {
  assert.equal(somarDias('2026-10-25', 1), '2026-10-26'); assert.equal(somarDias('2026-12-31', 1), '2027-01-01'); assert.equal(somarDias('2026-03-01', -1), '2026-02-28'); assert.equal(somarDias('2028-02-28', 1), '2028-02-29')
  assert.equal(diasEntre('2026-10-09', '2026-10-16'), 7); assert.equal(diasEntre('2026-10-16', '2026-10-09'), -7)
  assert.equal(diaSemana('2026-10-16'), 5, 'sexta'); assert.equal(diaSemana('2026-10-11'), 0, 'domingo'); assert.equal(diaSemana('2026-10-17'), 6)
  for (const bom of ['2026-10-16', '2028-02-29']) assert.ok(dataValida(bom))
  for (const ruim of ['2026-02-30', '2027-02-29', '2026-13-01', '2026-1-1', '20261016', '', null, undefined, 20261016, '2026-10-16T10:00', ' 2026-10-16']) assert.equal(dataValida(ruim), false, String(ruim))
  assert.deepEqual(janelaNominal('2026-10-16'), { de: '2026-10-09', ate: '2026-10-15' })
  assert.deepEqual(janelaNominal('2027-01-03'), { de: '2026-12-27', ate: '2027-01-02' })
})

await ok('proximaSexta: estritamente futura (quinta→sexta, sexta→sexta+7, sábado/domingo→próxima sexta)', () => {
  assert.deepEqual(['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-15'].map(d => proximaSexta(d)), ['2026-10-09', '2026-10-16', '2026-10-16', '2026-10-16', '2026-10-16', '2026-10-16'])
  assert.equal(proximaSexta('2026-10-08', 1), '2026-10-12', 'dia padrão configurável (segunda)')
})

await ok('proximaData: semanal +7, quinzenal +14, mensal com âncora e clamp (31/01→28/02→31/03; 2028 bissexto; virada de ano)', () => {
  assert.equal(proximaData('semanal', '2026-12-28'), '2027-01-04'); assert.equal(proximaData('quinzenal', '2026-10-16'), '2026-10-30')
  const seq = (ini, k, anc) => { const o = [ini]; for (let i = 0; i < k; i++) o.push(proximaData('mensal', o.at(-1), { ancoraDia: anc })); return o }
  assert.deepEqual(seq('2027-01-31', 4, 31), ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31'])
  assert.deepEqual(seq('2028-01-31', 2, 31), ['2028-01-31', '2028-02-29', '2028-03-31'], '2028 é bissexto')
  assert.deepEqual(seq('2026-12-15', 2, 15), ['2026-12-15', '2027-01-15', '2027-02-15'])
  assert.deepEqual(seq('2026-01-30', 2, 30), ['2026-01-30', '2026-02-28', '2026-03-30'], 'âncora 30 volta a 30 depois do clamp')
  assert.equal(proximaData('mensal', '2026-10-16'), '2026-11-16', 'sem âncora usa o dia da base')
  assert.throws(() => proximaData('desligado', '2026-10-16'))
})

await ok('aposEnvio: sexta→sexta; antecipar na quarta CONSOME a sexta; no domingo MANTÉM; perdido = UM envio; intervalos 4/9/18; desligado = ""', () => {
  const sem = d => ({ frequencia: 'semanal', proximo_envio: d, ancora_dia: 0 })
  assert.equal(aposEnvio(sem('2026-10-16'), '2026-10-16'), '2026-10-23', 'enviou na própria sexta')
  assert.equal(aposEnvio(sem('2026-10-16'), '2026-10-14'), '2026-10-23', 'quarta (2 dias antes < 4): a sexta é consumida')
  assert.equal(aposEnvio(sem('2026-10-16'), '2026-10-12'), '2026-10-16', 'segunda (4 dias antes): mantém')
  assert.equal(aposEnvio(sem('2026-10-16'), '2026-10-11'), '2026-10-16', 'domingo (5 dias antes): mantém')
  assert.equal(aposEnvio(sem('2026-10-16'), '2026-10-15'), '2026-10-23', 'quinta')
  assert.equal(aposEnvio(sem('2026-10-02'), '2026-10-14'), '2026-10-23', 'atrasada há 12 dias: um envio, e a próxima já é a sexta que não colide (sem fila de atraso)')
  assert.equal(aposEnvio(sem('2026-09-04'), '2026-10-16'), '2026-10-23', 'atraso de semanas: ainda UM envio')
  assert.equal(aposEnvio(sem('2026-10-16'), '2026-10-17'), '2026-10-23', 'sábado, depois da sexta')
  const q = d => ({ frequencia: 'quinzenal', proximo_envio: d, ancora_dia: 0 })
  assert.equal(aposEnvio(q('2026-10-30'), '2026-10-30'), '2026-11-13'); assert.equal(aposEnvio(q('2026-10-30'), '2026-10-22'), '2026-11-13', '8 dias antes < 9: consome')
  assert.equal(aposEnvio(q('2026-10-30'), '2026-10-21'), '2026-10-30', '9 dias antes: mantém')
  const m = (d, a = 0) => ({ frequencia: 'mensal', proximo_envio: d, ancora_dia: a })
  assert.equal(aposEnvio(m('2026-10-31', 31), '2026-10-31'), '2026-11-30'); assert.equal(aposEnvio(m('2026-10-31', 31), '2026-10-20'), '2026-11-30', '11 dias antes < 18: consome'); assert.equal(aposEnvio(m('2026-10-31', 31), '2026-10-13'), '2026-10-31', '18 dias antes: mantém')
  assert.equal(aposEnvio(m('2027-01-31', 31), '2027-01-31'), '2027-02-28'); assert.equal(aposEnvio(m('2027-02-28', 31), '2027-02-28'), '2027-03-31', 'sem deriva')
  assert.equal(aposEnvio({ frequencia: 'desligado', proximo_envio: '', ancora_dia: 0 }, '2026-10-16'), ''); assert.equal(aposEnvio(null, '2026-10-16'), ''); assert.equal(aposEnvio(sem('lixo'), '2026-10-16'), '')
  assert.deepEqual(datasPrevistas(sem('2026-10-16')), ['2026-10-16', '2026-10-23', '2026-10-30'])
  assert.deepEqual(datasPrevistas(m('2027-01-31', 31), 4), ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30'])
  assert.deepEqual(datasPrevistas(m('2027-01-31')), ['2027-01-31', '2027-02-28', '2027-03-31'], 'sem âncora gravada, o dia da data inicial é a âncora (sem deriva)')
  assert.deepEqual(datasPrevistas({ frequencia: 'desligado' }), [])
})

await ok('janela do agendador (17:00–23:00, seg–sex, da config) e devido(): liberada, sem pausa, vencida, fora do backoff', () => {
  const cfg = lerConfig(), j = (hoje, hora) => dentroDaJanela({ hoje, hora }, cfg)
  assert.deepEqual(['16:59', '17:00', '22:59', '23:00', '08:00'].map(h => j('2026-10-16', h)), [false, true, true, false, false])
  assert.deepEqual(['2026-10-12', '2026-10-13', '2026-10-16', '2026-10-17', '2026-10-18'].map(d => j(d, '18:00')), [true, true, true, false, false], 'sábado e domingo ficam de fora')
  assert.equal(dentroDaJanela({ hoje: '2026-10-17', hora: '18:00' }, { ...cfg, dias_uteis_apenas: false }), true)
  const base = { frequencia: 'semanal', proximo_envio: '2026-10-16', ativado_por: 'G', pausado_motivo: '', tentar_apos: '' }
  const ctx = { hoje: '2026-10-16', agora: ISO('2026-10-16'), hora: '17:00', cfg }
  assert.equal(devido(base, ctx), true)
  assert.equal(devido({ ...base, ativado_por: '' }, ctx), false, 'sem liberação não envia')
  assert.equal(devido({ ...base, pausado_motivo: 'sem_base' }, ctx), false); assert.equal(devido({ ...base, frequencia: 'desligado' }, ctx), false)
  assert.equal(devido({ ...base, proximo_envio: '2026-10-23' }, ctx), false, 'ainda não venceu'); assert.equal(devido({ ...base, proximo_envio: '2026-10-09' }, ctx), true, 'atrasada ainda é devida')
  assert.equal(devido({ ...base, tentar_apos: ISO('2026-10-16', '17:30') }, ctx), false, 'backoff'); assert.equal(devido({ ...base, tentar_apos: ISO('2026-10-16', '16:30') }, ctx), true)
  assert.equal(devido(base, { ...ctx, hora: '16:00' }), false); assert.equal(devido(base, { ...ctx, hora: '16:00', ignorarJanela: true }), true)
  assert.equal(devido(null, ctx), false); assert.equal(devido({ ...base, proximo_envio: '' }, ctx), false)
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(k => backoffMin(k, cfg)), [30, 60, 120, 240, 360, 360, 360], '30·2^n min, no máximo 6 h')
})

await ok('config: carga real validada (17:00–23:00, sexta, 4/9/18, 6 por tick, 3 tentativas, agendador DESLIGADO) e erros de digitação derrubam a carga', () => {
  const c = lerConfig()
  assert.deepEqual([c.hora_inicio, c.hora_fim, c.dia_semana_padrao, c.dias_uteis_apenas, c.agendador_ligado, c.lote_por_tick, c.orcamento_tick_min, c.lote_max_manual, c.tentativas_max, c.backoff_base_min, c.backoff_max_min, c.timeout_cliente_s, c.previa_ttl_min, c.categoria],
    ['17:00', '23:00', 5, true, false, 6, 6, 40, 3, 30, 360, 120, 15, CATEGORIA]); assert.deepEqual({ ...c.intervalo_minimo_dias }, { semanal: 4, quinzenal: 9, mensal: 18 }); assert.deepEqual([...c.status_elegiveis], ['Ativo'])
  for (const [campo, valor] of [['hora_inicio', '25:00'], ['hora_fim', '16:00'], ['dia_semana_padrao', 7], ['dias_uteis_apenas', 'sim'], ['lote_por_tick', 0], ['tentativas_max', 11], ['categoria', 'Outra'], ['status_elegiveis', []], ['intervalo_minimo_dias', { semanal: 0, quinzenal: 9, mensal: 18 }], ['timeout_cliente_s', -1], ['backoff_max_min', 5]])
    assert.throws(() => validarConfig({ ...c, [campo]: valor }), /config\/relatorio-envio\.json/, campo)
  assert.throws(() => validarConfig(null)); assert.ok(Object.isFrozen(c))
  assert.deepEqual(FREQUENCIAS.map(f => f.id), ['desligado', 'semanal', 'quinzenal', 'mensal'])
})

await ok('as datas são IDÊNTICAS em qualquer fuso da máquina (TZ=Pacific/Auckland, America/Sao_Paulo, UTC, Asia/Tokyo; virada de horário de verão incluída)', () => {
  const base = digest()
  assert.ok(base.length > 40_000)
  for (const tz of ['Pacific/Auckland', 'America/Sao_Paulo', 'UTC', 'Asia/Tokyo', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
    const o = execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--digest'], { env: { ...process.env, TZ: tz }, encoding: 'utf8' }).replace(/\n$/, '')
    assert.equal(o, base, `TZ=${tz}`)
  }
})

// ═══ BANCO ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
await ok('SCHEMA_RELATORIO: 2 tabelas + índice único parcial (uma página VIVA por cliente e período); arquivado + enviado convivem; idempotente', () => {
  const h = new Database(':memory:'); h.exec(SCHEMA_RELATORIO); h.exec(SCHEMA_RELATORIO)
  assert.deepEqual(h.prepare("SELECT name FROM sqlite_master WHERE (name LIKE '%relatorio%' OR name LIKE '%relenvio%') AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r => r.name), ['ix_relenvio_cli', 'relatorio_envio', 'relatorio_programacao', 'ux_relenvio_vivo'])
  const ins = (estado, de = '2026-10-09') => h.prepare("INSERT INTO relatorio_envio (cliente, de, ate, origem, estado, por, em) VALUES ('A', ?, '2026-10-15', 'manual', ?, 'x', 'y')").run(de, estado)
  ins('enviado'); assert.throws(() => ins('enviado'), /UNIQUE/); assert.throws(() => ins('adotado'), /UNIQUE/)
  ins('falhou'); ins('bloqueado'); ins('arquivado'); ins('arquivado'); ins('enviado', '2026-10-02')
  h.prepare("UPDATE relatorio_envio SET estado = 'arquivado' WHERE de = '2026-10-09' AND estado = 'enviado'").run(); ins('adotado')
  assert.deepEqual(Object.keys(h.prepare('SELECT * FROM relatorio_programacao').columns().reduce((o, c) => ({ ...o, [c.name]: 1 }), {})), ['cliente', 'frequencia', 'proximo_envio', 'ancora_dia', 'ativado_por', 'ativado_em', 'tentar_apos', 'falhas_seguidas', 'pausado_motivo', 'atualizado_em'])
})

// ═══ PRÉVIA E CONFIRMAÇÃO ════════════════════════════════════════════════════════════════════════════════════════════
await ok('prévia: SÓ leitura (nenhum POST/PATCH, nada no banco), shape do contrato, valida cliente (prospect e desconhecido = 404)', async () => {
  const { w, h, e, relogio } = montarEnvio()
  const p = await e.enviar('Acme', {})
  assert.deepEqual([p.ok, p.previa, typeof p.previa_id, p.titulo, p.de, p.ate, p.parcial_ate_hora, p.acao, p.ja_enviado, p.primeiro_envio, p.violacoes, p.avisos],
    [true, true, 'string', `${CATEGORIA} · 09/10 a 15/10/2026`, '2026-10-09', '2026-10-15', '17:00', 'criar', null, true, [], []])
  assert.deepEqual([p.destino.estado, p.destino.pagina_titulo, p.categoria.estado, p.categoria.tipo, p.bloqueio, p.modo], ['ok', 'Página de Acme', 'ok', 'select', null, 'completo'])
  assert.ok(p.destino.informacoes_url.startsWith('https://www.notion.so/'))
  assert.ok(p.linhas.includes('Resultados') && p.linhas.some(l => l.startsWith('Faturamento | R$ 14.920,00')) && Array.isArray(p.linhas))
  assert.equal(p.expira_em, new Date(relogio.ms + 15 * 60_000).toISOString())
  assert.equal(w.criadas(), 0); assert.equal(w.chamadasDe('PATCH').length, 0); assert.equal(contar(h, 'relatorio_envio'), 0); assert.equal(contar(h, 'relatorio_programacao'), 0)
  assert.deepEqual(w.chamadas.map(c => c.method + ' ' + (c.caminho.endsWith('/query') ? 'query' : c.caminho.replace(/[0-9a-f]{32}/g, 'ID'))), ['GET pages/ID', 'GET databases/ID', 'GET data_sources/ID', 'POST query'])
  await falha(() => e.enviar('[Comercial] Empresa · 12', {}), /cliente não encontrado na central/, 404)
  await falha(() => e.enviar('Fantasma', {}), /cliente não encontrado na central/, 404); await falha(() => e.enviar('', {}), /informe "cliente"/); await falha(() => e.enviar(undefined, {}), /informe "cliente"/)
  const eco = await falha(() => e.enviar('Fantasma Z9', {}), /cliente não encontrado/, 404); assert.ok(!eco.message.includes('Z9'), 'sem eco')
  assert.equal((await e.enviar('acme', {})).titulo, p.titulo, 'nome sem acento/caixa resolve para o canônico')
})

await ok('confirmar: estrito (=== true), exige por (líder/consultor) e previa_id; prévia expira em 15 min; é de UM cliente; o dia não pode ter mudado', async () => {
  const { w, e, relogio } = montarEnvio({ clientes: [['Acme', {}], ['Beta', {}]], cfg: { previa_ttl_min: 600 } })
  for (const nao of ['true', 1, 'sim', {}, [], null, undefined]) { const r = await e.enviar('Acme', { confirmar: nao, por: 'Giovanna Torres' }); assert.equal(r.previa, true, `confirmar=${JSON.stringify(nao)} é prévia`) }
  assert.equal(w.criadas(), 0)
  const p = await e.enviar('Acme', {})
  await falha(() => e.enviar('Acme', { confirmar: true, previa_id: p.previa_id }), /informe "por"/)
  await falha(() => e.enviar('Acme', { confirmar: true, por: 'Fulano', previa_id: p.previa_id }), /somente líder ou consultor/, 403)
  await falha(() => e.enviar('Acme', { confirmar: true, por: 'Dani Nunes', previa_id: p.previa_id }), /somente líder ou consultor/, 403)
  await falha(() => e.enviar('Acme', { confirmar: true, por: 'Giovanna Torres' }), /informe "previa_id"/)
  await falha(() => e.enviar('Acme', { confirmar: true, por: 'Giovanna Torres', previa_id: 'pv-inexistente' }), /prévia expirada — gere de novo/, 409)
  await falha(() => e.enviar('Beta', { confirmar: true, por: 'Giovanna Torres', previa_id: p.previa_id }), /prévia expirada/, 409)
  assert.equal(w.criadas(), 0, 'nenhuma dessas tentativas escreveu')
  // nova prévia substitui a anterior do mesmo cliente
  const p2 = await e.enviar('Acme', {}); await falha(() => e.enviar('Acme', { confirmar: true, por: 'Giovanna Torres', previa_id: p.previa_id }), /prévia expirada/, 409)
  // o dia mudou entre a prévia e o confirmar
  relogio.avancarMin(8 * 60); await falha(() => e.enviar('Acme', { confirmar: true, por: 'Giovanna Torres', previa_id: p2.previa_id }), /o dia mudou desde a prévia/, 409)
  assert.equal(w.criadas(), 0)
  // TTL de 15 min (config padrão)
  const m = montarEnvio(); const pq = await m.e.enviar('Acme', {}); m.relogio.avancarMin(14); const okp = await m.e.enviar('Acme', { confirmar: true, por: 'Giovanna Torres', previa_id: pq.previa_id }); assert.equal(okp.ok, true)
  const m2 = montarEnvio(); const pq2 = await m2.e.enviar('Acme', {}); m2.relogio.avancarMin(16); await falha(() => m2.e.enviar('Acme', { confirmar: true, por: 'Giovanna Torres', previa_id: pq2.previa_id }), /prévia expirada/, 409)
})

await ok('confirmar CRIA: UMA chamada, corpo exato (blocos do MESMO brief, categoria na chave "Secção ", Status Concluído), linha enviado completa; programação avança só se existir', async () => {
  const { w, h, e, relogio } = montarEnvio()
  const r = await confirmar(e, 'Acme')
  assert.deepEqual([r.ok, r.previa, r.estado, r.categoria, r.proximo_envio], [true, false, 'enviado', 'aplicada', '']); assert.match(r.url, /^https:\/\/www\.notion\.so\/[0-9a-f]{32}$/)
  assert.equal(w.criadas(), 1)
  const post = w.chamadasDe('POST', 'pages')[0]
  assert.deepEqual(post.body.children, briefParaBlocos(briefSintetico('Acme', { hoje: relogio.hoje(), hora: '17:00' })))
  assert.deepEqual(post.body.properties, { Name: { title: [{ type: 'text', text: { content: `${CATEGORIA} · 09/10 a 15/10/2026` } }] }, 'Secção ': { select: { name: CATEGORIA } }, Status: { select: { name: 'Concluído' } } })
  const [l] = linhasEnvio(h)
  assert.deepEqual([l.cliente, l.de, l.ate, l.origem, l.estado, l.motivo, l.page_url, l.categoria, l.por, l.incerto], ['Acme', '2026-10-09', '2026-10-15', 'manual', 'enviado', '', r.url, 'aplicada', 'Giovanna Torres', 0])
  assert.match(l.hash, /^[0-9a-f]{16}$/); assert.ok(l.ms >= 0 && l.page_id.length === 32 && l.em === relogio.agora())
  assert.equal(contar(h, 'relatorio_programacao'), 0, 'enviar sem programação NUNCA cria programação')
  // com programação: sexta → sexta; quarta consome a sexta; domingo mantém
  const caso = async (hoje, proximo) => { const m = montarEnvio({ hoje, hora: '12:00' }); semearProg(m.h, 'Acme', { proximo_envio: proximo }); const x = await confirmar(m.e, 'Acme'); assert.equal(x.estado, 'enviado'); return [x.proximo_envio, prog(m.h, 'Acme').proximo_envio] }
  assert.deepEqual(await caso('2026-10-16', '2026-10-16'), ['2026-10-23', '2026-10-23'], 'sexta → sexta')
  assert.deepEqual(await caso('2026-10-14', '2026-10-16'), ['2026-10-23', '2026-10-23'], 'quarta consome a sexta')
  assert.deepEqual(await caso('2026-10-11', '2026-10-16'), ['2026-10-16', '2026-10-16'], 'domingo mantém a sexta')
  assert.deepEqual(await caso('2026-10-19', '2026-10-09'), ['2026-10-23', '2026-10-23'], 'perdida (segunda, 10 dias depois) = um envio, sem fila de atraso')
  assert.deepEqual(await caso('2026-10-20', '2026-10-09'), ['2026-10-30', '2026-10-30'], 'terça: a sexta seguinte está a 3 dias (< 4) e é consumida')
})

await ok('idempotência: o mesmo período NÃO duplica (pular, nenhuma escrita), por local e pelo índice único; novo dia = novo período', async () => {
  const { w, h, e, relogio } = montarEnvio()
  const r1 = await confirmar(e, 'Acme'); w.limpar()
  const r2 = await confirmar(e, 'Acme'); assert.deepEqual([r2.ok, r2.estado, r2.url], [true, 'ja_enviado', r1.url]); assert.equal(w.criadas(), 0)
  const pv = await e.enviar('Acme', {}); assert.deepEqual([pv.acao, pv.ja_enviado?.url, pv.ja_enviado?.por], ['pular', r1.url, 'Giovanna Torres'])
  assert.equal(linhasEnvio(h).length, 1, 'pular não registra linha nova')
  assert.throws(() => h.prepare("INSERT INTO relatorio_envio (cliente, de, ate, origem, estado, por, em) VALUES ('Acme', '2026-10-09', '2026-10-15', 'lote', 'enviado', 'x', 'y')").run(), /UNIQUE/)
  relogio.avancarMin(24 * 60)                                              // sábado 17/10: janela 10/10–16/10
  const r3 = await confirmar(e, 'Acme'); assert.equal(r3.estado, 'enviado'); assert.notEqual(r3.url, r1.url); assert.equal(linhasEnvio(h).filter(x => x.estado === 'enviado').length, 2)
})

await ok('conteúdo barrado pelo auditor: prévia mostra código + trecho; confirmar = zero escrita, linha bloqueado "conteudo:<código>", resposta e log SEM o trecho', async () => {
  const { w, h, e, logs } = montarEnvio({ brief: { extra: { abertura: { tom: 'verde', cabecalho: 'Conta em crescimento', frase: 'Ajustes feitos por Giovanna Torres; garantido: undefined', nudge: '' } } } })
  const p = await e.enviar('Acme', {})
  assert.equal(p.acao, 'bloqueado'); assert.deepEqual(p.violacoes.map(v => [v.codigo, v.bloco]).sort(), [['analista', '0'], ['promessa', '0'], ['valor_invalido', '0']])
  assert.ok(p.violacoes.find(v => v.codigo === 'analista').trecho.includes('Giovanna Torres'), 'o trecho aparece na prévia interna')
  assert.deepEqual([p.bloqueio.estado], ['bloqueado'])
  w.limpar()
  const r = await e.enviar('Acme', { confirmar: true, por: 'Giovanna Torres', previa_id: p.previa_id })
  assert.deepEqual([r.ok, r.estado, r.motivo, r.retentavel], [false, 'bloqueado', 'conteudo', false]); assert.deepEqual(r.violacoes.map(v => v.codigo).sort(), ['analista', 'promessa', 'valor_invalido'])
  assert.ok(r.violacoes.every(v => !('trecho' in v)), 'a resposta de envio não leva o trecho')
  assert.equal(w.chamadas.length, 0, 'nenhuma chamada ao Notion'); const [l] = linhasEnvio(h)
  assert.deepEqual([l.estado, l.motivo], ['bloqueado', 'conteudo:analista,promessa,valor_invalido'])
  assert.ok(!/Ajustes feitos|garantido|undefined/.test(JSON.stringify([r, l, logs])), 'o trecho ofensivo não vai a resposta, log nem banco'); assert.ok(logs.some(x => /bloqueado conteudo:analista/.test(x)))
  // título fora do padrão (casaria com um plano) também é bloqueado
  const m = montarEnvio({ brief: { extra: { titulo: 'Setembro/26 - Amz' } } }); const pp = await m.e.enviar('Acme', {}); assert.ok(pp.violacoes.some(v => v.codigo === 'titulo')); assert.equal(pp.acao, 'bloqueado')
})

await ok('destino e categoria: sem_base, base_invalida e afins bloqueiam sem escrever; Secção status sem opção bloqueia (sem_categoria:true cria sem a coluna); select cria a opção; sem Secção só manual', async () => {
  const { w, h, e } = montarEnvio({ clientes: [['SemBase', { base: false }], ['StatusSem', { secao: 'status', opcaoCategoria: false }], ['SelectSem', { secao: 'select', opcaoCategoria: false }], ['SemSecao', { secao: null }], ['SemSecao2', { secao: null }], ['StatusOk', { secao: 'status', opcaoCategoria: true }]] })
  let p = await e.enviar('SemBase', {}); assert.deepEqual([p.acao, p.bloqueio.estado, p.destino.estado], ['bloqueado', 'sem_base', 'sem_base'])
  let r = await e.enviar('SemBase', { confirmar: true, por: 'Giovanna Torres', previa_id: p.previa_id }); assert.deepEqual([r.ok, r.estado, r.motivo, r.retentavel], [false, 'sem_base', 'sem_base', false]); assert.match(r.mensagem, /ainda não tem a base «Informações»/)
  assert.equal(w.criadas(), 0)
  p = await e.enviar('StatusSem', {}); assert.deepEqual([p.categoria.estado, p.categoria.tipo, p.acao, p.bloqueio.estado], ['opcao_ausente_status', 'status', 'bloqueado', 'opcao_ausente_status']); assert.match(p.categoria.aviso, /Informações › Secção/)
  r = await e.enviar('StatusSem', { confirmar: true, por: 'Giovanna Torres', previa_id: p.previa_id }); assert.deepEqual([r.ok, r.estado], [false, 'opcao_ausente_status']); assert.equal(w.criadas(), 0, 'nenhum POST')
  r = await e.enviar('StatusSem', { confirmar: true, por: 'Giovanna Torres', previa_id: p.previa_id, sem_categoria: true }); assert.deepEqual([r.ok, r.categoria], [true, 'padrao_da_base'])
  assert.deepEqual(Object.keys(w.chamadasDe('POST', 'pages')[0].body.properties).sort(), ['Name', 'Status'], 'sem a coluna Secção: o Notion usa a opção padrão da base')
  r = await confirmar(e, 'SelectSem'); assert.deepEqual([r.ok, r.categoria], [true, 'criada']); assert.deepEqual(w.chamadasDe('POST', 'pages').at(-1).body.properties['Secção '], { select: { name: CATEGORIA } })
  r = await confirmar(e, 'StatusOk'); assert.deepEqual([r.ok, r.categoria], [true, 'aplicada']); assert.deepEqual(w.chamadasDe('POST', 'pages').at(-1).body.properties['Secção '], { status: { name: CATEGORIA } })
  r = await confirmar(e, 'SemSecao'); assert.deepEqual([r.ok, r.categoria], [true, 'sem_propriedade'], 'manual pode enviar só com o título')
  // lote e agendado NÃO enviam sem a coluna Secção
  const r2 = await e.enviar('SemSecao2', { origem: 'agendado', confirmar: true, por: 'Giovanna Torres' }); assert.deepEqual([r2.ok, r2.estado], [false, 'sem_propriedade'])
  assert.deepEqual(linhasEnvio(h).map(x => [x.estado, x.motivo]), [['bloqueado', 'sem_base'], ['bloqueado', 'opcao_ausente_status'], ['enviado', ''], ['enviado', ''], ['enviado', ''], ['enviado', ''], ['bloqueado', 'sem_propriedade']])
})

await ok('destino compartilhado: bloqueia agendado/lote e o manual sem confirmar_destino; com confirmação o título leva o cliente ao final (não adota a página do outro)', async () => {
  const { w, h, e, estado } = montarEnvio({ clientes: [['Par A', {}], ['Par B', {}]] })
  const A = w.cfgCli.get('Par A'); estado.set('pagina_cliente:Par A', A.pagina_id); estado.set('pagina_cliente:Par B', A.pagina_id)
  const p = await e.enviar('Par A', {}); assert.deepEqual([p.destino.estado, p.acao, p.bloqueio.estado], ['destino_compartilhado', 'bloqueado', 'destino_compartilhado'])
  let r = await e.enviar('Par A', { confirmar: true, por: 'Giovanna Torres', previa_id: p.previa_id }); assert.deepEqual([r.ok, r.estado], [false, 'destino_compartilhado'])
  r = await e.enviar('Par A', { origem: 'agendado', confirmar: true, por: 'Giovanna Torres', confirmar_destino: true }); assert.deepEqual([r.ok, r.estado], [false, 'destino_compartilhado'], 'confirmar_destino só vale no manual')
  assert.equal(w.criadas(), 0)
  r = await e.enviar('Par A', { confirmar: true, por: 'Giovanna Torres', previa_id: p.previa_id, confirmar_destino: true }); assert.deepEqual([r.ok, r.estado], [true, 'enviado'])
  assert.equal(w.chamadasDe('POST', 'pages')[0].body.properties.Name.title[0].text.content, `${CATEGORIA} · 09/10 a 15/10/2026 (Par A)`)
  assert.equal(linhasEnvio(h).at(-1).estado, 'enviado')
})

await ok('modo vazio: não cria página (ok:false, estado vazio); Mercado Livre que não respondeu: manual avisa e deixa confirmar, lote/agendado tratam como falha retentável', async () => {
  const a = montarEnvio({ brief: { modo: 'vazio' } }); const p = await a.e.enviar('Acme', {}); assert.deepEqual([p.acao, p.bloqueio.estado], ['bloqueado', 'vazio'])
  const r = await a.e.enviar('Acme', { confirmar: true, por: 'Giovanna Torres', previa_id: p.previa_id }); assert.deepEqual([r.ok, r.estado, r.motivo], [false, 'vazio', 'vazio']); assert.match(r.mensagem, /não há o que mostrar/); assert.equal(a.w.criadas(), 0)
  assert.deepEqual(linhasEnvio(a.h).map(x => [x.estado, x.motivo]), [['bloqueado', 'vazio']])
  const b = montarEnvio({ brief: { qualidadeOk: false } }); const pb = await b.e.enviar('Acme', {}); assert.ok(pb.avisos.some(x => /Mercado Livre não respondeu/.test(x)))
  const ok1 = await b.e.enviar('Acme', { confirmar: true, por: 'Giovanna Torres', previa_id: pb.previa_id }); assert.equal(ok1.ok, true, 'manual confirma sabendo')
  const c = montarEnvio({ brief: { qualidadeOk: false } })
  for (const origem of ['agendado', 'lote']) { const x = await c.e.enviar('Acme', { origem, confirmar: true, por: 'Giovanna Torres' }); assert.deepEqual([x.ok, x.estado, x.motivo, x.retentavel], [false, 'falhou', 'qualidade', true], origem) }
  assert.equal(c.w.criadas(), 0)
})

await ok('falha do brief: prévia = 502 com mensagem fixa; BriefInseguro = 422 / bloqueio de conteúdo; confirmar de lote/agendado = falhou retentável (sem eco)', async () => {
  const a = montarEnvio(); a.bf.falhar = new Error('estourou "SEGREDO-XYZ" no cálculo')
  const e1 = await falha(() => a.e.enviar('Acme', {}), /não foi possível montar o relatório agora/, 502); assert.ok(!e1.message.includes('SEGREDO-XYZ'))
  const r = await a.e.enviar('Acme', { origem: 'agendado', confirmar: true, por: 'Giovanna Torres' }); assert.deepEqual([r.ok, r.estado, r.motivo, r.retentavel], [false, 'falhou', 'erro_brief', true])
  assert.ok(!JSON.stringify([r, a.logs, linhasEnvio(a.h)]).includes('SEGREDO-XYZ'), 'o texto do erro não vai a log nem a banco')
  const b = montarEnvio(); b.bf.falhar = Object.assign(new Error('O relatório contém texto interno e não foi gerado'), { name: 'BriefInseguro', status: 422, violacoes: [{ regra: 'jargao', caminho: 'a.b' }, { regra: 'nome_interno', caminho: 'c' }] })
  await falha(() => b.e.enviar('Acme', {}), /não passou na auditoria de conteúdo/, 422)
  const r2 = await b.e.enviar('Acme', { origem: 'lote', confirmar: true, por: 'Giovanna Torres' }); assert.deepEqual([r2.ok, r2.estado, r2.motivo, r2.retentavel], [false, 'bloqueado', 'conteudo', false])
  assert.ok(b.logs.some(x => /brief inseguro \(jargao,nome_interno\)/.test(x))); assert.equal(linhasEnvio(b.h).at(-1).motivo, 'conteudo:brief')
})

await ok('rede e tempo: erro de rede do Notion (sem status) = 502 "Notion indisponível" na prévia e falha retentável "notion_rede" no confirmar; prévia lenta estoura em 504', async () => {
  const a = montarEnvio(); const orig = a.w.notion.req
  a.w.notion.req = async (c, o) => { if (c.startsWith('pages/')) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }); return orig(c, o) }
  await falha(() => a.e.enviar('Acme', {}), /Notion indisponível agora — tente de novo/, 502)
  const r = await a.e.enviar('Acme', { origem: 'agendado', confirmar: true, por: 'Giovanna Torres' })
  assert.deepEqual([r.ok, r.estado, r.motivo, r.retentavel], [false, 'falhou', 'notion_rede', true]); assert.equal(r.mensagem, 'Notion indisponível agora — tente de novo'); assert.equal(a.w.criadas(), 0)
  const b = montarEnvio({ cfg: { timeout_cliente_s: 0.05 } }); b.bf.atraso = () => new Promise(r => setTimeout(r, 200))
  await falha(() => b.e.enviar('Acme', {}), /a prévia demorou mais que o limite/, 504)
  assert.equal(linhasEnvio(b.h).length, 0, 'prévia lenta não grava nada')
})

await ok('timeout por cliente (Promise.race): devolve falhou/timeout incerto; o cliente continua TRAVADO até o trabalho órfão terminar; depois a página criada é adotada, nunca duplicada', async () => {
  const { w, h, e, bf } = montarEnvio({ cfg: { timeout_cliente_s: 0.05 } })
  bf.atraso = () => new Promise(r => setTimeout(r, 250))                  // o Mercado Livre está lento: o brief do agendado demora mais que o limite
  const args = { origem: 'agendado', confirmar: true, por: 'Giovanna Torres' }, t0 = Date.now()
  const r = await e.enviar('Acme', args)
  assert.ok(Date.now() - t0 < 200, 'voltou no limite, sem esperar o brief'); assert.deepEqual([r.ok, r.estado, r.motivo, r.incerto, r.retentavel], [false, 'falhou', 'timeout', true, true])
  assert.equal(linhasEnvio(h)[0].motivo, 'timeout'); assert.equal(linhasEnvio(h)[0].incerto, 1)
  await falha(() => e.enviar('Acme', args), /já existe um envio deste cliente em andamento/, 409)
  await esperar(() => w.criadas() === 1)                                  // o órfão terminou e criou a página
  await esperar(() => linhasEnvio(h).some(x => x.estado === 'enviado'))
  bf.atraso = null; w.limpar()
  const r2 = await confirmar(e, 'Acme'); assert.deepEqual([r2.ok, r2.estado], [true, 'ja_enviado']); assert.equal(w.criadas(), 0, 'nada duplicado')
  assert.equal(w.paginasVivas(w.cfgCli.get('Acme').ds_id).length, 1)
})

await ok('trava por cliente: dois confirmar simultâneos → um passa, o outro 409; clientes diferentes não se bloqueiam', async () => {
  const { w, e, bf } = montarEnvio({ clientes: [['Acme', {}], ['Beta', {}]] })
  bf.atraso = () => new Promise(r => setTimeout(r, 40))
  const p = await e.enviar('Acme', {}), pb = await e.enviar('Beta', {})
  const args = { confirmar: true, por: 'Giovanna Torres', previa_id: p.previa_id }
  const [a, b, c] = await Promise.allSettled([e.enviar('Acme', args), e.enviar('Acme', args), e.enviar('Beta', { ...args, previa_id: pb.previa_id })])
  assert.equal([a, b].filter(x => x.status === 'fulfilled' && x.value.ok).length, 1); assert.equal([a, b].filter(x => x.status === 'rejected' && x.reason.status === 409).length, 1)
  assert.equal(c.status, 'fulfilled'); assert.equal(c.value.ok, true); assert.equal(w.criadas(), 2)
})

// ═══ PROGRAMAÇÃO, LIBERAÇÃO, LOTE DE FREQUÊNCIA ══════════════════════════════════════════════════════════════════════════
await ok('programar: a prévia mostra 3 datas + diag + frase e NÃO grava; confirmar grava (sem liberar); data só AAAA-MM-DD real entre hoje e hoje+60; mensal guarda a âncora; desligar encerra a liberação', async () => {
  const { h, e, estado, relogio } = montarEnvio()
  const p = e.programar({ cliente: 'Acme', frequencia: 'semanal' })
  assert.deepEqual([p.ok, p.previa, p.datas_previstas, p.diag], [true, true, ['2026-10-23', '2026-10-30', '2026-11-06'], null]); assert.match(p.confirmacao, /criam uma página visível ao cliente/)
  assert.ok(p.avisos.some(x => /ainda não foi verificada/.test(x)) && p.avisos.some(x => /liberado por um líder/.test(x)))
  assert.deepEqual(e.programar({ cliente: 'Acme', frequencia: 'semanal', proximo_envio: '2026-10-16' }).datas_previstas, ['2026-10-16', '2026-10-23', '2026-10-30'], 'hoje vale')
  assert.equal(contar(h, 'relatorio_programacao'), 0, 'prévia não grava')
  for (const ruim of ['2026-02-30', '2026-10-15', '2026-12-16', '16/10/2026', 'amanha', 20261016]) await falha(() => e.programar({ cliente: 'Acme', frequencia: 'semanal', proximo_envio: ruim }), /data inválida \(use AAAA-MM-DD, entre hoje e 60 dias\)/)
  assert.equal(e.programar({ cliente: 'Acme', frequencia: 'semanal', proximo_envio: '2026-12-15' }).ok, true, 'hoje+60 vale')
  await falha(() => e.programar({ cliente: 'Acme', frequencia: 'diaria' }), /frequência desconhecida — escolha desligado, semanal, quinzenal ou mensal/)
  await falha(() => e.programar({ cliente: 'Acme', frequencia: 'semanal', confirmar: true }), /informe "por"/)
  await falha(() => e.programar({ cliente: 'Acme', frequencia: 'semanal', confirmar: true, por: 'Fulano' }), /somente líder ou consultor/, 403)
  await falha(() => e.programar({ cliente: '[Comercial] X · 1', frequencia: 'semanal' }), /cliente não encontrado na central/, 404)
  assert.equal(contar(h, 'relatorio_programacao'), 0)
  const c = e.programar({ cliente: 'Acme', frequencia: 'semanal', confirmar: true, por: 'carla souza' })
  assert.deepEqual([c.ok, c.programacao.frequencia, c.programacao.proximo_envio, c.programacao.situacao, c.programacao.liberado, c.programacao.datas_previstas], [true, 'semanal', '2026-10-23', 'nao_liberado', false, ['2026-10-23', '2026-10-30', '2026-11-06']])
  assert.deepEqual([prog(h, 'Acme').ativado_por, prog(h, 'Acme').ancora_dia], ['', 0], 'programar NÃO libera')
  const m = e.programar({ cliente: 'Acme', frequencia: 'mensal', proximo_envio: '2026-10-31', confirmar: true, por: 'Carla Souza' })
  assert.deepEqual([prog(h, 'Acme').ancora_dia, m.programacao.datas_previstas], [31, ['2026-10-31', '2026-11-30', '2026-12-31']])
  // desligar zera data, liberação e pausa; religar pede liberar de novo; salvar NÃO reativa (só liberar reativa: a pausa, as falhas e o backoff ficam)
  semearProg(h, 'Acme', { frequencia: 'semanal', ativado_por: 'Carla Souza', pausado_motivo: 'sem_base', falhas_seguidas: 2, tentar_apos: ISO('2026-10-17') })
  assert.ok(e.programar({ cliente: 'Acme', frequencia: 'quinzenal' }).avisos.some(x => /Esta programação está pausada \(.*\); salvar não reativa — use Liberar\./.test(x)), 'a prévia avisa que salvar não reativa')
  e.programar({ cliente: 'Acme', frequencia: 'quinzenal', confirmar: true, por: 'Carla Souza' })
  assert.deepEqual([prog(h, 'Acme').frequencia, prog(h, 'Acme').ativado_por, prog(h, 'Acme').pausado_motivo, prog(h, 'Acme').falhas_seguidas, prog(h, 'Acme').tentar_apos], ['quinzenal', 'Carla Souza', 'sem_base', 2, ISO('2026-10-17')], 'mudar a frequência mantém a liberação E a pausa (só liberar reativa)')
  const d = e.programar({ cliente: 'Acme', frequencia: 'desligado', confirmar: true, por: 'Carla Souza' })
  assert.deepEqual([d.programacao.situacao, prog(h, 'Acme').proximo_envio, prog(h, 'Acme').ativado_por, d.programacao.datas_previstas], ['desligado', '', '', []])
  assert.deepEqual([prog(h, 'Acme').pausado_motivo, prog(h, 'Acme').falhas_seguidas, prog(h, 'Acme').tentar_apos], ['', 0, ''], 'desligar zera a pausa também')
  diagPronto(estado, 'Acme', {}, relogio); assert.equal(e.programar({ cliente: 'Acme', frequencia: 'semanal' }).diag.pronto, true, 'a prévia traz o diagnóstico em cache')
})

await ok('liberar: só quem tem diagnóstico PRONTO e frequência; prévia lista liberaria/ignorados com o motivo; confirmar grava ativado_por/ativado_em; cliente com id estranho ou prospect = ignorado sem eco', async () => {
  const { h, e, estado, relogio } = montarEnvio({ clientes: [['A', {}], ['B', {}], ['C', {}], ['D', {}], ['E', {}]] })
  for (const c of ['A', 'B', 'C', 'D']) semearProg(h, c, { ativado_por: '', ativado_em: '' })
  diagPronto(estado, 'A', {}, relogio); diagPronto(estado, 'B', { pronto: false, categoria: 'opcao_ausente_status', proxima_acao: 'Criar a opção «Relatório de Sprints Place2u» em Informações › Secção' }, relogio)
  diagPronto(estado, 'D', {}, relogio); semearProg(h, 'D', { ativado_por: 'Carla Souza' })   // D já liberado
  const p = e.liberar({})
  assert.deepEqual([p.ok, p.previa, p.liberaria], [true, true, ['A']])
  assert.deepEqual(p.ignorados.map(i => [i.cliente, i.motivo]), [['B', 'Criar a opção «Relatório de Sprints Place2u» em Informações › Secção'], ['C', 'base ainda não verificada'], ['D', 'já liberado']])
  assert.equal(p.sem_envio_anterior, 1); assert.equal(prog(h, 'A').ativado_por, '', 'prévia não grava')
  const pe = e.liberar({ clientes: ['E', '[Comercial] Z · 2', 'Zzz-Fantasma', 'E'] })
  assert.deepEqual(pe.liberaria, []); assert.deepEqual(pe.ignorados.map(i => [i.cliente, i.motivo]), [['', 'cliente não encontrado na central'], ['', 'cliente não encontrado na central'], ['E', 'sem frequência de envio programada']])
  assert.ok(!JSON.stringify(pe).includes('Zzz') && !JSON.stringify(pe).includes('Comercial'), 'sem eco')
  await falha(() => e.liberar({ confirmar: true }), /informe "por"/); await falha(() => e.liberar({ confirmar: true, por: 'Dani Nunes' }), /somente líder ou consultor/, 403)
  assert.equal(prog(h, 'A').ativado_por, '')
  const r = e.liberar({ confirmar: 'true', por: 'Giovanna Torres' }); assert.equal(r.previa, true, 'string "true" não libera')
  const l = e.liberar({ confirmar: true, por: 'giovanna torres' }); assert.deepEqual(l, { ok: true, liberados: 1 })
  assert.deepEqual([prog(h, 'A').ativado_por, prog(h, 'A').ativado_em], ['Giovanna Torres', relogio.agora()]); assert.equal(prog(h, 'B').ativado_por, ''); assert.equal(prog(h, 'D').ativado_por, 'Carla Souza')
  assert.equal(e.liberar({ clientes: ['A'] }).ignorados[0].motivo, 'já liberado')
  // pausado + diagnóstico pronto de novo → liberar retoma
  semearProg(h, 'A', { ativado_por: 'Giovanna Torres', pausado_motivo: 'sem_base', falhas_seguidas: 1 })
  assert.deepEqual(e.liberar({ clientes: ['A'] }).liberaria, ['A']); e.liberar({ clientes: ['A'], confirmar: true, por: 'Carla Souza' })
  assert.deepEqual([prog(h, 'A').pausado_motivo, prog(h, 'A').falhas_seguidas, prog(h, 'A').ativado_por], ['', 0, 'Carla Souza'])
})

await ok('frequenciaEmLote: prévia (mudam + itens), confirmar altera só quem muda, máx. 100, desligar encerra a liberação, estrito em confirmar', async () => {
  const { h, e } = montarEnvio({ clientes: muitos(3) })
  semearProg(h, 'Cli 01', { frequencia: 'quinzenal', proximo_envio: '2026-11-06', ativado_por: 'Carla Souza' })
  const p = e.frequenciaEmLote({ clientes: ['Cli 00', 'Cli 01', 'cli 02', 'Cli 02', '[Comercial] X'], frequencia: 'semanal' })
  assert.deepEqual([p.ok, p.previa, p.mudam], [true, true, 3]); assert.deepEqual(p.itens.map(i => [i.cliente, i.de, i.para, i.proximo_envio]), [['Cli 00', 'desligado', 'semanal', '2026-10-23'], ['Cli 01', 'quinzenal', 'semanal', '2026-11-06'], ['Cli 02', 'desligado', 'semanal', '2026-10-23']])
  assert.equal(p.ignorados.length, 1); assert.equal(contar(h, 'relatorio_programacao'), 1)
  await falha(() => e.frequenciaEmLote({ clientes: ['Cli 00'], frequencia: 'semanal', confirmar: true }), /informe "por"/)
  assert.deepEqual(e.frequenciaEmLote({ clientes: ['Cli 00', 'Cli 01'], frequencia: 'semanal', confirmar: 'true', por: 'Carla Souza' }).previa, true)
  assert.deepEqual(e.frequenciaEmLote({ clientes: ['Cli 00', 'Cli 01', 'Cli 02'], frequencia: 'semanal', confirmar: true, por: 'Carla Souza' }), { ok: true, alterados: 3 })
  assert.deepEqual([prog(h, 'Cli 01').frequencia, prog(h, 'Cli 01').proximo_envio, prog(h, 'Cli 01').ativado_por], ['semanal', '2026-11-06', 'Carla Souza'], 'a data e a liberação existentes são mantidas')
  assert.equal(e.frequenciaEmLote({ clientes: ['Cli 00', 'Cli 01', 'Cli 02'], frequencia: 'semanal', confirmar: true, por: 'Carla Souza' }).alterados, 0, 'idempotente')
  e.frequenciaEmLote({ clientes: ['Cli 01'], frequencia: 'desligado', confirmar: true, por: 'Carla Souza' }); assert.deepEqual([prog(h, 'Cli 01').frequencia, prog(h, 'Cli 01').proximo_envio, prog(h, 'Cli 01').ativado_por], ['desligado', '', ''])
  await falha(() => e.frequenciaEmLote({ clientes: Array.from({ length: 101 }, (_, i) => `c${i}`), frequencia: 'semanal' }), /máximo de 100 clientes por vez/)
  await falha(() => e.frequenciaEmLote({ clientes: [], frequencia: 'semanal' }), /informe "clientes" \(1 a 100\)/); await falha(() => e.frequenciaEmLote({ clientes: 'Cli 00', frequencia: 'semanal' }), /informe "clientes"/)
  await falha(() => e.frequenciaEmLote({ clientes: ['Cli 00'], frequencia: 'x' }), /frequência desconhecida/)
})

await ok('listar/clienteDe: situação (desligado, nao_liberado, agendado, atrasado, enviado, pausado, falhou), resumo, histórico ≤20 e datas previstas', async () => {
  const { h, e, estado, relogio } = montarEnvio({ clientes: [['A', {}], ['B', {}], ['C', {}], ['D', {}], ['E', {}], ['F', {}], ['G', {}]] })
  semearProg(h, 'B', { ativado_por: '' }); semearProg(h, 'C', { proximo_envio: '2026-10-23' }); semearProg(h, 'D', { proximo_envio: '2026-10-09' }); semearProg(h, 'F', { pausado_motivo: 'sem_base' }); semearProg(h, 'G', { falhas_seguidas: 1, proximo_envio: '2026-10-16' })
  semearProg(h, 'E', { proximo_envio: '2026-10-23' }); await confirmar(e, 'E')                      // E enviado hoje
  diagPronto(estado, 'C', {}, relogio); diagPronto(estado, 'F', { pronto: false, destino: 'sem_base', categoria: '' }, relogio)
  const l = e.listar(), s = Object.fromEntries(l.itens.map(i => [i.cliente, i.situacao]))
  assert.deepEqual(s, { A: 'desligado', B: 'nao_liberado', C: 'agendado', D: 'atrasado', E: 'enviado', F: 'pausado', G: 'falhou' })
  assert.deepEqual(l.agendador, { ligado: false }); assert.deepEqual(l.frequencias.map(f => f.id), ['desligado', 'semanal', 'quinzenal', 'mensal'])
  assert.deepEqual(l.resumo, { total: 7, prontos: 1, liberados: 5, pausados: 1, sem_categoria: 0, sem_base: 1, nao_verificados: 5 })
  const c = l.itens.find(i => i.cliente === 'C'); assert.deepEqual([c.frequencia, c.frequencia_rotulo, c.proximo_envio, c.liberado, c.pronto, c.situacao_rotulo], ['semanal', 'Semanal', '2026-10-23', true, true, 'Agendado'])
  const ee = l.itens.find(i => i.cliente === 'E'); assert.match(ee.ultimo_url, /notion\.so/); assert.equal(ee.ultimo_estado, 'enviado'); assert.ok(ee.ultimo_envio_em)
  assert.equal(l.itens.find(i => i.cliente === 'F').motivo.includes('Informações'), true)
  const cd = e.clienteDe('E'); assert.deepEqual(Object.keys(cd), ['programacao', 'historico', 'diag']); assert.deepEqual(cd.programacao.datas_previstas.length, 3)
  assert.deepEqual(Object.keys(cd.historico[0]), ['id', 'de', 'ate', 'origem', 'estado', 'motivo', 'categoria', 'por', 'em', 'anexo', 'url']); assert.ok(cd.historico.length <= 20)
  await falha(() => { e.clienteDe('[Comercial] X · 1') }, /cliente não encontrado na central/, 404)
  assert.equal(e.clienteDe('A').programacao.situacao, 'desligado')
})

// ═══ DIAGNÓSTICO ═════════════════════════════════════════════════════════════════════════════════════════════════════════
await ok('diagnóstico: job somente leitura grava rel_diag:{cliente}; prontos × opção ausente × sem base × sem página; resumo; CSV com BOM, ";" e prefixo "\'" contra fórmula', async () => {
  const { w, h, e, bf, estado } = montarEnvio({ clientes: [['Ok', {}], ['Select', { opcaoCategoria: false }], ['Status', { secao: 'status', opcaoCategoria: false }], ['SemBase', { base: false }], ['SemPag', { pagina: '404' }], ['=SOMA(1)', {}]] })
  const j = e.diagnosticar({}); assert.match(j.id, /^rj-/)
  await falha(() => e.diagnosticar({}), /já existe uma verificação de bases em andamento/, 409)
  await esperar(() => e.jobDe(j.id).estado !== 'rodando')
  const job = e.jobDe(j.id); assert.deepEqual([job.tipo, job.estado, job.total, job.feitos], ['diagnostico', 'concluido', 6, 6]); assert.match(job.resumo, /^3 prontos de 6$/)
  assert.deepEqual(Object.fromEntries(job.itens.map(i => [i.cliente, i.estado])), { Ok: 'pronto', Select: 'pronto', Status: 'opcao_ausente_status', SemBase: 'sem_base', SemPag: 'pagina_invalida', '=SOMA(1)': 'pronto' })
  assert.equal(w.criadas(), 0); assert.equal(w.chamadasDe('PATCH').length, 0); assert.equal(bf.chamadas, 0, 'diagnóstico não monta brief nem toca o Mercado Livre')
  const d = JSON.parse(estado.get('rel_diag:Status')); assert.deepEqual([d.cliente, d.secao_tipo, d.categoria, d.destino, d.pronto, d.perfil, d.ml_conectado], ['Status', 'status', 'opcao_ausente_status', 'ok', false, 'padrao', null]); assert.match(d.proxima_acao, /Criar a opção «Relatório de Sprints Place2u» em Informações › Secção/)
  assert.equal(JSON.parse(estado.get('rel_diag:SemBase')).proxima_acao, 'Criar a base Informações na página do cliente')
  assert.equal(JSON.parse(estado.get('rel_diag:SemPag')).proxima_acao, 'Conferir o id da página do cliente na central'); assert.ok(JSON.parse(estado.get('rel_diag:Ok')).informacoes.startsWith('https://www.notion.so/'))
  const dg = e.diagnostico(); assert.deepEqual(dg.resumo, { prontos: 3, opcao_ausente: 1, sem_base: 1, sem_pagina: 1, nao_verificados: 0 }); assert.equal(dg.itens.length, 6)
  assert.deepEqual(Object.keys(dg.itens[0]), ['cliente', 'em', 'pagina', 'informacoes', 'secao_tipo', 'categoria', 'destino', 'perfil', 'ml_conectado', 'pronto', 'proxima_acao'])
  const csv = e.diagnosticoCsv(); assert.ok(csv.startsWith('﻿"cliente";"pagina";"informacoes";"secao_tipo";"categoria";"perfil";"ml_conectado";"frequencia";"proximo_envio";"ultimo_envio";"pronto";"proxima_acao"'))
  assert.ok(csv.includes('"\'=SOMA(1)"'), 'fórmula neutralizada'); assert.equal(csv.split('\r\n').length, 7)
  assert.equal(paraCsv([{ a: '-1' }, { a: '@x' }, { a: 'a"b' }, { a: 3.5 }], ['a']), '﻿"a"\r\n"\'-1"\r\n"\'@x"\r\n"a""b"\r\n3,5')
  semearProg(h, 'Ok'); assert.equal(e.diagnosticoCsv().includes('Semanal'), true, 'o CSV traz frequência e data da programação')
  // com a base nova do cliente, o diagnóstico seguinte enxerga
  const w2 = montarEnvio({ clientes: [['X', {}]] }); assert.equal(e.diagnostico().itens.length, 6); assert.equal(w2.e.diagnostico().resumo.nao_verificados, 1)
  const j2 = e.diagnosticar({ clientes: ['ok', 'Fantasma'] }); await esperar(() => e.jobDe(j2.id).estado !== 'rodando'); assert.equal(e.jobDe(j2.id).total, 1)
})

// ═══ AGENDADOR ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
await ok('interruptor geral: nasce DESLIGADO; o valor da config só vale enquanto a chave nunca foi gravada; ligar/desligar exige líder/consultor; tick desligado nem monta brief', async () => {
  const { h, e, bf, logs } = montarEnvio(); semearProg(h, 'Acme')
  assert.deepEqual(e.agendadorEstado(), { ligado: false }); assert.deepEqual(await e.tick(), { pulou: 'desligado' }); assert.equal(bf.chamadas, 0)
  await falha(() => e.agendador({ ligado: true }), /informe "por"/); await falha(() => e.agendador({ ligado: true, por: 'Fulano' }), /somente líder ou consultor/, 403)
  for (const ruim of ['true', 1, null, undefined]) await falha(() => e.agendador({ ligado: ruim, por: 'Carla Souza' }), /informe "ligado"/)
  assert.deepEqual(e.agendadorEstado(), { ligado: false })
  assert.deepEqual(e.agendador({ ligado: true, por: 'carla souza' }), { ok: true, ligado: true }); assert.deepEqual(e.agendadorEstado(), { ligado: true }); assert.ok(logs.some(x => /agendador de relatórios LIGADO por Carla Souza/.test(x)))
  assert.deepEqual(e.agendador({ ligado: false, por: 'Carla Souza' }), { ok: true, ligado: false }); assert.deepEqual(e.agendadorEstado(), { ligado: false })
  const c = montarEnvio({ cfg: { agendador_ligado: true } }); assert.deepEqual(c.e.agendadorEstado(), { ligado: true }, 'config só como valor inicial')
  c.e.agendador({ ligado: false, por: 'Carla Souza' }); assert.deepEqual(c.e.agendadorEstado(), { ligado: false }, 'depois de gravada, a chave manda')
})

await ok('tick: fora da janela não faz nada (16:59, 23:00, sábado, domingo); dentro, só quem está liberado, sem pausa, vencido, elegível e fora do backoff — mais antigo primeiro', async () => {
  const { w, h, e, bf, relogio, notifs } = montarEnvio({ clientes: [['P1', {}], ['P2', {}], ['P3', {}], ['P4', {}], ['P5', {}], ['P7', {}], ['P8', {}]], elegiveis: () => ['P1', 'P2', 'P3', 'P4', 'P5', 'P7', 'P8'].map(c => ({ cliente: c, status: c === 'P7' ? 'Congelado' : 'Ativo' })) })
  e.agendador({ ligado: true, por: 'Carla Souza' })
  semearProg(h, 'P1'); semearProg(h, 'P5', { proximo_envio: '2026-10-09' })                         // devidos (P5 mais antigo)
  semearProg(h, 'P2', { ativado_por: '' }); semearProg(h, 'P3', { pausado_motivo: 'sem_base' }); semearProg(h, 'P4', { proximo_envio: '2026-10-23' })
  semearProg(h, 'P7'); semearProg(h, 'P8', { tentar_apos: ISO('2026-10-16', '18:00') }); semearProg(h, 'P9', { frequencia: 'desligado', proximo_envio: '' })
  for (const [d, hr] of [['2026-10-16', '16:59'], ['2026-10-16', '23:00'], ['2026-10-17', '18:00'], ['2026-10-18', '18:00']]) { relogio.ir(d, hr); assert.deepEqual(await e.tick(), { pulou: 'fora_da_janela' }, `${d} ${hr}`) }
  assert.equal(bf.chamadas, 0); relogio.ir('2026-10-16', '17:00')
  const r = await e.tick()
  assert.deepEqual([r.processados, r.enviados, r.pausados, r.retentar], [2, 2, 0, 0])
  assert.deepEqual(linhasEnvio(h).map(x => [x.cliente, x.origem, x.estado, x.por]), [['P5', 'agendado', 'enviado', 'Giovanna Torres'], ['P1', 'agendado', 'enviado', 'Giovanna Torres']], 'ordem: proximo_envio mais antigo primeiro; por = quem liberou')
  assert.deepEqual([prog(h, 'P5').proximo_envio, prog(h, 'P1').proximo_envio], ['2026-10-23', '2026-10-23'], 'a programação avança sem fila de atraso')
  assert.equal(notifs.length, 0, 'sucesso do agendado NÃO notifica por cliente'); assert.equal(w.criadas(), 2)
  for (const c of ['P2', 'P3', 'P4', 'P7', 'P8', 'P9']) assert.equal(linhasEnvio(h).some(x => x.cliente === c), false, c)
  assert.deepEqual(await e.tick(), { pulou: '', processados: 0, enviados: 0, pausados: 0, retentar: 0, vazios: 0 }, 'nada mais devido')
  relogio.ir('2026-10-16', '18:01'); const r2 = await e.tick(); assert.equal(r2.processados, 1, 'P8 voltou depois do backoff'); assert.equal(linhasEnvio(h).at(-1).cliente, 'P8')
  relogio.ir('2026-10-19', '17:00'); semearProg(h, 'P4', { proximo_envio: '2026-10-17' }); assert.equal((await e.tick()).processados, 1, 'o que sobrou do fim de semana sai na segunda')
  assert.equal(e.listar().itens.find(i => i.cliente === 'P1').situacao, 'agendado')
})

await ok('tick: 6 por tick (lote_por_tick) e orçamento de tempo; clientes processados um por vez', async () => {
  const a = montarEnvio({ clientes: muitos(8) }); a.e.agendador({ ligado: true, por: 'Carla Souza' })
  let paralelo = 0, pico = 0; a.bf.atraso = async () => { paralelo++; pico = Math.max(pico, paralelo); await new Promise(r => setTimeout(r, 3)); paralelo-- }
  muitos(8).forEach(([c], i) => semearProg(a.h, c, { proximo_envio: `2026-10-${String(1 + i).padStart(2, '0')}` }))
  const r1 = await a.e.tick(); assert.equal(r1.processados, 6); assert.equal(pico, 1, 'sequencial')
  assert.deepEqual(linhasEnvio(a.h).map(x => x.cliente), muitos(6).map(([c]) => c), 'os 6 mais antigos')
  const r2 = await a.e.tick(); assert.deepEqual([r2.processados, linhasEnvio(a.h).length], [2, 8])
  // orçamento: cada brief "gasta" 40 s do relógio; com 1 min de orçamento processa 2 e para
  const b = montarEnvio({ clientes: muitos(5), cfg: { orcamento_tick_min: 1 } }); b.e.agendador({ ligado: true, por: 'Carla Souza' })
  b.bf.atraso = async () => { b.relogio.ms += 40_000 }; muitos(5).forEach(([c]) => semearProg(b.h, c))
  const rb = await b.e.tick(); assert.equal(rb.processados, 2, 'orçamento de tempo esgotado'); assert.equal((await b.e.tick()).processados, 2)
})

await ok('tick: falha retentável → backoff 30/60 min e, na 3ª, PAUSA com motivo + notificação com dedupe; pausa persiste; religar = salvar a programação ou liberar de novo', async () => {
  const { h, e, bf, relogio, notifs, logs, estado } = montarEnvio(); e.agendador({ ligado: true, por: 'Carla Souza' }); semearProg(h, 'Acme')
  bf.falhar = new Error('estourou "SEGREDO"')
  let r = await e.tick(); assert.deepEqual([r.processados, r.retentar, r.pausados], [1, 1, 0])
  assert.deepEqual([prog(h, 'Acme').falhas_seguidas, prog(h, 'Acme').tentar_apos, prog(h, 'Acme').pausado_motivo], [1, ISO('2026-10-16', '17:30'), ''])
  relogio.avancarMin(10); r = await e.tick(); assert.equal(r.processados, 0, 'dentro do backoff não tenta')
  relogio.avancarMin(21); r = await e.tick(); assert.deepEqual([r.processados, r.retentar], [1, 1])                    // 17:31
  assert.deepEqual([prog(h, 'Acme').falhas_seguidas, prog(h, 'Acme').tentar_apos], [2, new Date(relogio.ms + 60 * 60_000).toISOString()], '2ª falha: +60 min')
  assert.equal(notifs.length, 0, 'antes da 3ª não notifica')
  relogio.avancarMin(61); r = await e.tick(); assert.deepEqual([r.processados, r.pausados], [1, 1])                       // 18:32
  assert.deepEqual([prog(h, 'Acme').pausado_motivo, prog(h, 'Acme').falhas_seguidas], ['falhas', 3])
  assert.equal(notifs.length, 1); assert.deepEqual([notifs[0].tipo, notifs[0].nivel, notifs[0].cliente, notifs[0].dedupeMin, notifs[0].link], ['relatorio_falhou:falhas', 'erro', 'Acme', 1440, '/cliente?cliente=Acme&aba=configurar'])
  assert.ok(!JSON.stringify([notifs, logs, linhasEnvio(h)]).includes('SEGREDO'), 'sem eco do erro')
  assert.equal(linhasEnvio(h).filter(x => x.estado === 'falhou').length, 3)
  relogio.ir('2026-10-19', '18:00'); assert.equal((await e.tick()).processados, 0, 'pausado não volta sozinho (nem na segunda seguinte)')
  assert.equal(e.listar().itens[0].situacao, 'pausado'); assert.match(e.listar().itens[0].motivo, /três tentativas seguidas falharam/)
  bf.falhar = null; relogio.ir('2026-10-19', '17:00'); e.programar({ cliente: 'Acme', frequencia: 'semanal', proximo_envio: '2026-10-19', confirmar: true, por: 'Carla Souza' })
  assert.deepEqual([prog(h, 'Acme').pausado_motivo, prog(h, 'Acme').ativado_por], ['falhas', 'Giovanna Torres'], 'salvar NÃO reativa: a pausa fica'); assert.equal((await e.tick()).processados, 0, 'continua pausado')
  diagPronto(estado, 'Acme', {}, relogio); assert.deepEqual(e.liberar({ clientes: ['Acme'], confirmar: true, por: 'Carla Souza' }), { ok: true, liberados: 1 })
  assert.deepEqual([prog(h, 'Acme').pausado_motivo, prog(h, 'Acme').ativado_por], ['', 'Carla Souza'], 'liberar reativa'); assert.equal((await e.tick()).enviados, 1)
})

await ok('tick: erro NÃO retentável (403, sem_base, categoria ausente, conteúdo) pausa NA HORA com o motivo e avisa uma vez; "vazio" avança a programação sem pausar nem notificar', async () => {
  const { w, h, e, bf, notifs } = montarEnvio({ clientes: [['K403', {}], ['KBase', { base: false }], ['KStatus', { secao: 'status', opcaoCategoria: false }], ['KVazio', {}], ['KOk', {}]] })
  e.agendador({ ligado: true, por: 'Carla Souza' }); for (const c of ['K403', 'KBase', 'KStatus', 'KVazio', 'KOk']) semearProg(h, c)
  bf.porCliente = { KVazio: { modo: 'vazio', resultados: { disponivel: false, motivo: 'x', linhas: [], hoje: null, nao_coletado: [], outros: [] } } }
  bf.modo = 'completo'; w.falhas.criar.push({ status: 403 })
  const r = await e.tick()
  assert.equal(r.processados, 5)
  const p = c => [prog(h, c).pausado_motivo, prog(h, c).falhas_seguidas, prog(h, c).tentar_apos]
  assert.deepEqual(p('K403'), ['notion_403', 0, '']); assert.deepEqual(p('KBase'), ['sem_base', 0, '']); assert.deepEqual(p('KStatus'), ['opcao_ausente_status', 0, '']); assert.deepEqual(p('KOk'), ['', 0, ''])
  assert.deepEqual(notifs.map(n => [n.tipo, n.nivel, n.cliente, n.dedupeMin]).sort(), [['relatorio_falhou:notion_403', 'alerta', 'K403', 1440], ['relatorio_falhou:opcao_ausente_status', 'alerta', 'KStatus', 1440], ['relatorio_falhou:sem_base', 'alerta', 'KBase', 1440]])
  assert.match(notifs.find(n => n.cliente === 'KStatus').corpo, /crie a opção no Notion/)
  assert.equal(w.criadas(), 2, 'K403 tentou 1 vez (403 não é repetido) + KOk; sem_base, categoria e vazio não chegam a escrever'); assert.equal(w.paginasVivas(w.cfgCli.get('KOk').ds_id).length, 1)
  assert.deepEqual(Object.fromEntries(['K403', 'KBase', 'KStatus'].map(c => [c, e.listar().itens.find(i => i.cliente === c).situacao])), { K403: 'pausado', KBase: 'pausado', KStatus: 'pausado' })
  // conteúdo barrado: pausa 'conteudo'
  const c = montarEnvio({ brief: { extra: { abertura: { tom: 'verde', cabecalho: 'x', frase: 'resultado garantido', nudge: '' } } } }); c.e.agendador({ ligado: true, por: 'Carla Souza' }); semearProg(c.h, 'Acme')
  await c.e.tick(); assert.equal(prog(c.h, 'Acme').pausado_motivo, 'conteudo'); assert.equal(c.w.chamadas.length, 0)
  // vazio: avança a programação (só um "nada a dizer"), sem pausa nem aviso
  const v = montarEnvio({ brief: { modo: 'vazio' } }); v.e.agendador({ ligado: true, por: 'Carla Souza' }); semearProg(v.h, 'Acme')
  const rv = await v.e.tick(); assert.deepEqual([rv.vazios, rv.pausados], [1, 0]); assert.deepEqual([prog(v.h, 'Acme').proximo_envio, prog(v.h, 'Acme').pausado_motivo], ['2026-10-23', '']); assert.equal(v.notifs.length, 0); assert.equal(v.w.criadas(), 0)
})

await ok('tick: mesmo período já enviado à mão = "ja_enviado" e a programação avança; primeiro envio do agendado passa pela liberação do líder (lote, não)', async () => {
  const { w, h, e } = montarEnvio(); e.agendador({ ligado: true, por: 'Carla Souza' }); semearProg(h, 'Acme')
  await confirmar(e, 'Acme'); assert.equal(prog(h, 'Acme').proximo_envio, '2026-10-23'); w.limpar()
  semearProg(h, 'Acme', { proximo_envio: '2026-10-16' })                                        // alguém voltou a data para hoje
  const r = await e.tick(); assert.deepEqual([r.processados, r.enviados], [1, 1]); assert.equal(w.criadas(), 0, 'não duplica'); assert.equal(prog(h, 'Acme').proximo_envio, '2026-10-23')
  const n = montarEnvio(); const lote = await n.e.enviar('Acme', { origem: 'lote', confirmar: true, por: 'Giovanna Torres' })
  assert.deepEqual([lote.ok, lote.estado], [false, 'precisa_previa']); assert.match(lote.mensagem, /primeiro relatório deste cliente precisa ser enviado pela ficha do cliente/)
  const ag = await n.e.enviar('Acme', { origem: 'agendado', confirmar: true, por: 'Giovanna Torres' }); assert.equal(ag.ok, true, 'liberar é a confirmação do líder para o primeiro envio automático')
})

await ok('tick e lote compartilham o mutex: nunca rodam juntos; tick só uma vez por vez', async () => {
  const { h, e, bf } = montarEnvio({ clientes: muitos(2) }); e.agendador({ ligado: true, por: 'Carla Souza' })
  for (const [c] of muitos(2)) h.prepare("INSERT INTO relatorio_envio (cliente, de, ate, origem, estado, por, em) VALUES (?, '2026-10-02', '2026-10-08', 'manual', 'enviado', 'x', 'y')").run(c)
  let solta; bf.atraso = () => new Promise(r => { solta = r })
  const l = await e.lote({ clientes: ['Cli 00'], por: 'Giovanna Torres', confirmar: true }); assert.ok(l.job.id)
  await esperar(() => !!solta)
  semearProg(h, 'Cli 01'); assert.deepEqual(await e.tick(), { pulou: 'em_andamento' })
  await falha(() => e.lote({ clientes: ['Cli 01'], por: 'Giovanna Torres', confirmar: true }), /já existe um lote ou envio automático em andamento/, 409)
  solta(); await esperar(() => e.jobDe(l.job.id).estado !== 'rodando'); bf.atraso = null
  assert.equal((await e.tick()).processados, 1, 'livre de novo')
  // tick em andamento bloqueia lote
  const m = montarEnvio({ clientes: muitos(2) }); m.e.agendador({ ligado: true, por: 'Carla Souza' }); semearProg(m.h, 'Cli 00'); let solta2; m.bf.atraso = () => new Promise(r => { solta2 = r })
  const t = m.e.tick(); await esperar(() => !!solta2)
  await falha(() => m.e.lote({ clientes: ['Cli 01'], por: 'Giovanna Torres', confirmar: true }), /já existe um lote ou envio automático em andamento/, 409); assert.deepEqual(await m.e.tick(), { pulou: 'em_andamento' })
  solta2(); await t
})

// ═══ LOTE ("Enviar relatório antecipadamente") ════════════════════════════════════════════════════════════════════════
await ok('lote: prévia SEM brief e SEM Notion (só diagnóstico em cache + banco); ação por cliente; prospect/desconhecido ignorados sem eco; máx. 40; estrito em confirmar', async () => {
  const { w, h, e, bf, estado, relogio } = montarEnvio({ clientes: [['Ja', {}], ['Nunca', {}], ['Velho', {}], ['Bloq', {}], ['Livre', {}]] })
  const viva = (c, de, ate) => h.prepare("INSERT INTO relatorio_envio (cliente, de, ate, origem, estado, page_url, por, em) VALUES (?, ?, ?, 'manual', 'enviado', 'https://www.notion.so/x', 'x', 'y')").run(c, de, ate)
  viva('Ja', '2026-10-09', '2026-10-15'); viva('Velho', '2026-10-02', '2026-10-08'); viva('Bloq', '2026-10-02', '2026-10-08'); viva('Livre', '2026-10-02', '2026-10-08')
  diagPronto(estado, 'Bloq', { pronto: false, categoria: 'opcao_ausente_status', proxima_acao: 'Criar a opção «Relatório de Sprints Place2u» em Informações › Secção' }, relogio); diagPronto(estado, 'Livre', {}, relogio)
  const p = await e.lote({ clientes: ['Ja', 'Nunca', 'Velho', 'Bloq', 'Livre', 'livre', '[Comercial] Z · 1', 'Zzz-Fantasma', 42, null] })
  assert.deepEqual([p.ok, p.previa], [true, true])
  assert.deepEqual(p.itens.map(i => [i.cliente, i.acao]), [['', 'ignorado'], ['', 'ignorado'], ['', 'ignorado'], ['', 'ignorado'], ['Ja', 'ja_enviado_hoje'], ['Nunca', 'precisa_previa'], ['Velho', 'enviar'], ['Bloq', 'bloqueado'], ['Livre', 'enviar']])
  assert.equal(p.itens.find(i => i.cliente === 'Bloq').motivo, 'Criar a opção «Relatório de Sprints Place2u» em Informações › Secção'); assert.match(p.itens.find(i => i.cliente === 'Velho').motivo, /será conferido no envio/)
  assert.ok(!JSON.stringify(p).includes('Zzz') && !JSON.stringify(p).includes('Comercial'), 'sem eco'); assert.equal(bf.chamadas, 0); assert.equal(w.chamadas.length, 0)
  await falha(() => e.lote({ clientes: [] }), /informe "clientes" \(1 a 40\)/); await falha(() => e.lote({ clientes: 'Ja' }), /informe "clientes"/)
  await falha(() => e.lote({ clientes: Array.from({ length: 41 }, (_, i) => `c${i}`) }), /máximo de 40 clientes por vez/); assert.equal((await e.lote({ clientes: Array.from({ length: 40 }, (_, i) => `c${i}`) })).itens.length, 40)
  await falha(() => e.lote({ clientes: ['Livre'], confirmar: true }), /informe "por"/); await falha(() => e.lote({ clientes: ['Livre'], confirmar: true, por: 'Fulano' }), /somente líder ou consultor/, 403)
  assert.equal((await e.lote({ clientes: ['Livre'], confirmar: 'true', por: 'Giovanna Torres' })).previa, true)
  assert.deepEqual(await e.lote({ clientes: ['Ja', 'Nunca', 'Bloq'], confirmar: true, por: 'Giovanna Torres' }), { ok: false, estado: 'nada_a_enviar', mensagem: 'nenhum cliente pode receber o envio agora' })
  assert.equal(w.criadas(), 0)
})

await ok('lote: confirmar cria job sequencial (runner próprio); só quem é "enviar" escreve; itens, resumo e UM aviso do lote; falha por cliente avisa com dedupe e não derruba os outros', async () => {
  const { w, h, e, bf, notifs, logs } = montarEnvio({ clientes: [['Ja', {}], ['Nunca', {}], ['L1', {}], ['L2', {}], ['L3', {}]] })
  for (const c of ['Ja', 'Nunca', 'L1', 'L2', 'L3']) h.prepare("INSERT INTO relatorio_envio (cliente, de, ate, origem, estado, page_url, por, em) VALUES (?, ?, ?, 'manual', 'enviado', 'https://www.notion.so/x', 'x', 'y')").run(c, c === 'Ja' ? '2026-10-09' : '2026-10-02', c === 'Ja' ? '2026-10-15' : '2026-10-08')
  h.prepare("DELETE FROM relatorio_envio WHERE cliente = 'Nunca'").run()
  let paralelo = 0, pico = 0; bf.atraso = async () => { paralelo++; pico = Math.max(pico, paralelo); await new Promise(r => setTimeout(r, 5)); paralelo-- }
  w.falhas.criar.push({ status: 403 })                                           // o 1º criar (L1) falha com 403
  const r = await e.lote({ clientes: ['Ja', 'Nunca', 'L1', 'L2', 'L3'], confirmar: true, por: 'giovanna torres' }); assert.deepEqual(Object.keys(r), ['ok', 'job']); assert.match(r.job.id, /^rj-/)
  await esperar(() => e.jobDe(r.job.id).estado !== 'rodando')
  const j = e.jobDe(r.job.id); assert.deepEqual([j.tipo, j.estado, j.total, j.feitos], ['lote', 'concluido', 5, 5]); assert.equal(pico, 1, 'sequencial')
  assert.deepEqual(j.itens.map(i => [i.cliente, i.estado]), [['Ja', 'ja_enviado_hoje'], ['Nunca', 'precisa_previa'], ['L1', 'falhou'], ['L2', 'enviado'], ['L3', 'enviado']])
  assert.match(j.itens[2].mensagem, /permissão para criar páginas/); assert.match(j.itens[3].url, /notion\.so/); assert.equal(j.resumo, '2 enviados · 1 já enviados · 2 com problema')
  assert.equal(w.criadas(), 3); assert.equal(linhasEnvio(h).filter(x => x.origem === 'lote').length, 3, 'origem lote')
  assert.deepEqual(notifs.map(n => [n.tipo, n.nivel, n.cliente || '']).sort(), [['relatorio_falhou:notion_403', 'erro', 'L1'], ['relatorio_lote', 'alerta', '']]); assert.equal(notifs.find(n => n.tipo === 'relatorio_falhou:notion_403').dedupeMin, 1440)
  assert.equal(notifs.filter(n => n.tipo === 'relatorio_lote').length, 1, 'um resumo só'); assert.ok(logs.some(x => /lote de relatórios: 2 enviados/.test(x)))
  assert.equal(e.jobDe('rj-nao-existe'), null); assert.equal(e.jobDe(undefined), null)
  // o lote (manual) não pausa programação: só o agendador pausa
  assert.equal(contar(h, 'relatorio_programacao'), 0)
})

await ok('semearProgramacao: semanal na data dada, ativado_por vazio (NÃO liberado), idempotente, nunca sobrescreve, ignora prospect; dry-run não grava', () => {
  const h = new Database(':memory:'); h.exec(SCHEMA_RELATORIO)
  semearProg(h, 'Antigo', { frequencia: 'mensal', proximo_envio: '2026-11-30', ativado_por: 'Carla Souza' })
  const HOJE = () => '2026-10-08', dry = semearProgramacao(h, ['A', 'B', 'Antigo', 'A', '[Comercial] X · 1', ''], { data: '2026-10-16', hoje: HOJE }); assert.deepEqual([dry.aplicado, dry.total, dry.novos, dry.existentes], [false, 3, ['A', 'B'], ['Antigo']]); assert.equal(contar(h, 'relatorio_programacao'), 1)
  const ap = semearProgramacao(h, ['A', 'B', 'Antigo'], { data: '2026-10-16', aplicar: true, hoje: HOJE }); assert.equal(ap.novos.length, 2)
  assert.deepEqual([prog(h, 'A').frequencia, prog(h, 'A').proximo_envio, prog(h, 'A').ativado_por, prog(h, 'A').ancora_dia, prog(h, 'A').pausado_motivo], ['semanal', '2026-10-16', '', 0, ''])
  assert.deepEqual([prog(h, 'Antigo').frequencia, prog(h, 'Antigo').proximo_envio, prog(h, 'Antigo').ativado_por], ['mensal', '2026-11-30', 'Carla Souza'], 'não sobrescreve')
  const de = semearProgramacao(h, ['A', 'B', 'Antigo', 'C'], { data: '2026-10-23', aplicar: true, hoje: HOJE }); assert.deepEqual([de.novos, prog(h, 'A').proximo_envio, prog(h, 'C').proximo_envio], [['C'], '2026-10-16', '2026-10-23'])
  assert.throws(() => semearProgramacao(h, ['A'], { data: '2026-02-30', hoje: HOJE }), /data inválida/)
})

// ═══ REVISÃO ADVERSARIAL Nº 1 (F1): cada achado tem um teste que FALHAVA no módulo antigo (SO=F1.n roda um só) ════════════════════════════════
await ok('F1.1 ALTO — a central renomeou o cliente («Acme» → «ACME»): o tick PAUSA com cliente_renomeado (sem enviar, com um aviso) e o avanço da agenda usa a CHAVE da programação', async () => {
  const m = montarEnvio({ clientes: [['ACME', {}]], hoje: '2026-10-16', hora: '17:00' })
  ligar(m); semearProg(m.h, 'Acme')                                   // a programação ficou com a chave antiga
  let dia = '2026-10-16'
  for (let i = 0; i < 14; i++, dia = somarDias(dia, 1)) for (const hr of ['17:00', '17:10', '17:20']) { m.relogio.ir(dia, hr); await m.e.tick() }
  assert.equal(m.w.criadas(), 0, 'nenhuma página nova em 14 dias (antes: uma por dia útil)'); assert.equal(linhasEnvio(m.h).length, 0)
  assert.deepEqual([prog(m.h, 'Acme').pausado_motivo, prog(m.h, 'Acme').falhas_seguidas, prog(m.h, 'ACME')], ['cliente_renomeado', 0, undefined], 'pausa sem criar linha nova')
  assert.deepEqual(m.notifs.map(x => [x.tipo, x.nivel, x.cliente]), [['relatorio_falhou:cliente_renomeado', 'alerta', 'Acme']], 'UM aviso (o pausado não volta a ser devido)')
  assert.match(m.e.listar().itens.find(i => i.cliente === 'Acme').motivo, /nome deste cliente mudou na central/)
  // o envio manual de «ACME» avança a linha «Acme» (a chave da programação), sem criar uma programação nova
  const k = montarEnvio({ clientes: [['ACME', {}]], hoje: '2026-10-16', hora: '12:00' }); semearProg(k.h, 'Acme', { proximo_envio: '2026-10-16' })
  const r = await confirmar(k.e, 'ACME'); assert.deepEqual([r.ok, r.estado, r.proximo_envio], [true, 'enviado', '2026-10-23'])
  assert.deepEqual([prog(k.h, 'Acme').proximo_envio, prog(k.h, 'ACME')], ['2026-10-23', undefined])
})

await ok('F1.2 ALTO — o freio de emergência PARA o tick em andamento: o interruptor é relido a cada cliente e antes de escrever', async () => {
  const nomes = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'], m = montarEnvio({ clientes: nomes.map(c => [c, {}]), hoje: '2026-10-16', hora: '17:30' })
  ligar(m); nomes.forEach(c => semearProg(m.h, c))
  let briefs = 0; m.bf.atraso = async () => { if (++briefs === 2) m.e.agendador({ ligado: false, por: 'Giovanna Torres' }); await new Promise(r => setTimeout(r, 5)) }   // o líder desliga enquanto o 2º cliente é montado
  const r = await m.e.tick()
  assert.equal(r.interrompido, 'freio'); assert.equal(m.w.criadas(), 1, 'só o 1º saiu: o 2º, com o brief pronto, não escreveu (antes: as 6 páginas saíam)'); assert.equal(linhasEnvio(m.h).length, 1)
  assert.deepEqual([prog(m.h, 'A2').falhas_seguidas, prog(m.h, 'A2').pausado_motivo, prog(m.h, 'A2').proximo_envio], [0, '', '2026-10-16'], 'quem o freio cortou não vira falha')
  assert.equal(m.notifs.length, 0); assert.deepEqual(m.e.agendadorEstado(), { ligado: false }); assert.deepEqual(await m.e.tick(), { pulou: 'desligado' })
})

await ok('F1.3 MÉDIO — status vazio/ausente/null (e nome sem status) NÃO é elegível: falha fechada; só «Ativo» explícito envia (caixa e espaços tolerados)', async () => {
  const status = { Verde: 'Ativo', Caixa: ' ATIVO ', Vazio: '', Ausente: undefined, Nulo: null, Frio: 'Congelado', Saindo: 'Processo de Desligamento', Numero: 7 }
  const m = montarEnvio({ clientes: Object.keys(status).map(c => [c, {}]), hoje: '2026-10-16', hora: '17:30', cfg: { lote_por_tick: 10 },
    elegiveis: () => [...Object.entries(status).map(([cliente, st]) => ({ cliente, ...(st === undefined ? {} : { status: st }) })), 'Texto puro', null, 5] })
  ligar(m); Object.keys(status).forEach(c => semearProg(m.h, c))
  const r = await m.e.tick(); assert.equal(r.enviados, 2)
  assert.deepEqual(linhasEnvio(m.h).map(x => x.cliente).sort(), ['Caixa', 'Verde'])
  assert.deepEqual(m.e.diagnostico().itens.map(i => i.cliente), ['Caixa', 'Verde'], 'a lista de bases também só enxerga os Ativos')
  assert.equal(m.e.canonico('Texto puro'), '', 'nome sem status nem programação = desconhecido')
})

await ok('F1.4 MÉDIO — Congelado / em desligamento / sem status: envio manual (prévia e confirmar), lote, programação, liberação e frequência em lote são barrados com cliente_inelegivel; desligar continua valendo', async () => {
  const nomes = ['Ativo1', 'Frio', 'Saindo', 'Sem'], st = { Ativo1: 'Ativo', Frio: 'Congelado', Saindo: 'Processo de Desligamento', Sem: '' }
  const m = montarEnvio({ clientes: nomes.map(c => [c, {}]), elegiveis: () => nomes.map(cliente => ({ cliente, status: st[cliente] })), clienteCanonico: nome => nomes.find(c => norm(c) === norm(nome)) || '' })
  const barrado = { ok: false, estado: 'cliente_inelegivel', motivo: 'cliente_inelegivel', mensagem: MSG_INELEGIVEL, retentavel: false }
  for (const c of ['Frio', 'Saindo', 'Sem']) {
    assert.deepEqual(await m.e.enviar(c, {}), barrado, `${c}: prévia`)
    assert.deepEqual(await m.e.enviar(c, { confirmar: true, por: 'Giovanna Torres', previa_id: 'pv-x' }), barrado, `${c}: confirmar`)
    assert.deepEqual(await m.e.enviar(c, { origem: 'lote', confirmar: true, por: 'Giovanna Torres' }), barrado, `${c}: origem lote`)
    assert.deepEqual(m.e.programar({ cliente: c, frequencia: 'semanal' }), barrado, `${c}: programar (prévia)`)
    assert.deepEqual(m.e.programar({ cliente: c, frequencia: 'semanal', confirmar: true, por: 'Giovanna Torres' }), barrado, `${c}: programar (confirmar)`)
  }
  assert.equal(m.w.chamadas.length, 0, 'nenhuma chamada ao Notion'); assert.equal(contar(m.h, 'relatorio_programacao'), 0); assert.equal(contar(m.h, 'relatorio_envio'), 0)
  assert.equal(m.e.programar({ cliente: 'Frio', frequencia: 'desligado', confirmar: true, por: 'Giovanna Torres' }).ok, true, 'desligar vale para qualquer cliente')
  const lt = await m.e.lote({ clientes: ['Frio', 'Saindo', 'Sem'] }); assert.deepEqual(lt.itens.map(i => [i.acao, i.motivo]), [['bloqueado', MSG_INELEGIVEL], ['bloqueado', MSG_INELEGIVEL], ['bloqueado', MSG_INELEGIVEL]])
  assert.equal((await m.e.lote({ clientes: ['Frio'], confirmar: true, por: 'Giovanna Torres' })).estado, 'nada_a_enviar')
  semearProg(m.h, 'Frio', { ativado_por: '' }); diagPronto(m.estado, 'Frio', {}, m.relogio)
  const lb = m.e.liberar({ clientes: ['Frio'] }); assert.deepEqual([lb.liberaria, lb.ignorados], [[], [{ cliente: 'Frio', motivo: MSG_INELEGIVEL }]])
  const fq = m.e.frequenciaEmLote({ clientes: ['Ativo1', 'Frio'], frequencia: 'semanal' })
  assert.deepEqual([fq.mudam, fq.itens.map(i => i.cliente), fq.ignorados], [1, ['Ativo1'], [{ cliente: 'Frio', motivo: MSG_INELEGIVEL }]])
  m.e.frequenciaEmLote({ clientes: ['Ativo1', 'Frio'], frequencia: 'semanal', confirmar: true, por: 'Giovanna Torres' }); assert.equal(prog(m.h, 'Frio').frequencia, 'semanal', 'a linha de Frio não foi tocada (continua a semeada)')
  assert.equal(fq.ignorados.length, 1); const dl = m.e.frequenciaEmLote({ clientes: ['Frio'], frequencia: 'desligado' }); assert.deepEqual([dl.mudam, dl.ignorados], [1, []], 'desligar em lote vale para qualquer cliente')
})

await ok('F1.5 MÉDIO — cache de página vazio de QUALQUER cliente = destino compartilhado DESCONHECIDO: o automático fica retido (com um aviso) até a verificação das bases preencher; liberar também espera', async () => {
  const PAG = 'f'.repeat(32), mk = () => montarEnvio({ clientes: [['AlfaLtda', { paginaId: PAG }], ['BetaLtda', { paginaId: PAG }]], hoje: '2026-10-16', hora: '17:30' })
  const m = mk(); ligar(m); semearProg(m.h, 'AlfaLtda'); diagPronto(m.estado, 'AlfaLtda', {}, m.relogio)
  m.estado.set('pagina_cliente:BetaLtda', '')                         // o irmão foi invalidado/nunca resolvido: o relatório não enxerga que ele divide a página com a Alfa
  let r = await m.e.tick()
  assert.deepEqual([r.processados, r.retidos, m.w.criadas(), prog(m.h, 'AlfaLtda').pausado_motivo], [0, 1, 0, ''], 'nada saiu e nada foi pausado')
  assert.deepEqual(m.notifs.map(x => [x.tipo, x.nivel, x.dedupeMin]), [['relatorio_falhou:verificacao', 'alerta', 1440]]); assert.match(m.notifs[0].corpo, /Verificar bases/)
  semearProg(m.h, 'AlfaLtda', { ativado_por: '' })
  const lb = m.e.liberar({ clientes: ['AlfaLtda'] }); assert.deepEqual(lb.liberaria, []); assert.match(lb.ignorados[0].motivo, /verifique as bases de todos os clientes antes/)
  // a verificação preenche o cache: o compartilhamento aparece no diagnóstico dos DOIS e o automático nunca escreve na página dividida
  const j = m.e.diagnosticar({}); await esperar(() => m.e.jobDe(j.id).estado !== 'rodando')
  assert.deepEqual(['AlfaLtda', 'BetaLtda'].map(c => { const d = JSON.parse(m.estado.get(`rel_diag:${c}`)); return [d.destino, d.pronto] }), [['destino_compartilhado', false], ['destino_compartilhado', false]])
  assert.deepEqual(m.e.jobDe(j.id).itens.map(i => i.estado), ['destino_compartilhado', 'destino_compartilhado'])
  semearProg(m.h, 'AlfaLtda'); m.relogio.ir('2026-10-16', '17:50'); r = await m.e.tick()
  assert.deepEqual([r.retidos, r.pausados, m.w.criadas(), prog(m.h, 'AlfaLtda').pausado_motivo], [undefined, 1, 0, 'destino_compartilhado'])
  // «sem página» CONFIRMADO pela verificação conta como conhecido (não trava a carteira por causa de quem nem tem página)
  const k = montarEnvio({ clientes: [['X', {}], ['Y', {}]], hoje: '2026-10-16', hora: '17:30' }); ligar(k); semearProg(k.h, 'X')
  k.estado.set('pagina_cliente:Y', ''); assert.equal((await k.e.tick()).retidos, 1)
  diagPronto(k.estado, 'Y', { pronto: false, destino: 'sem_pagina' }, k.relogio); const ok2 = await k.e.tick(); assert.deepEqual([ok2.retidos, ok2.enviados], [undefined, 1])
})

await ok('F1.6 MÉDIO — programar e frequenciaEmLote NÃO reativam: a pausa, as falhas e a liberação ficam como estão; a prévia avisa «salvar não reativa — use Liberar»; só liberar reativa', async () => {
  const { h, e, estado, relogio } = montarEnvio({ clientes: [['Acme', {}], ['Beta', {}]], hoje: '2026-10-14', hora: '12:00' })
  semearProg(h, 'Acme', { pausado_motivo: 'conteudo' }); semearProg(h, 'Beta', { pausado_motivo: 'falhas', falhas_seguidas: 3, proximo_envio: '2026-10-23' })
  const pv = e.programar({ cliente: 'Acme', frequencia: 'semanal', proximo_envio: '2026-10-16' }); assert.ok(pv.avisos.some(x => /salvar não reativa — use Liberar/.test(x)))
  e.programar({ cliente: 'Acme', frequencia: 'semanal', proximo_envio: '2026-10-16', por: 'Giovanna Torres', confirmar: true })
  assert.deepEqual([prog(h, 'Acme').pausado_motivo, prog(h, 'Acme').ativado_por], ['conteudo', 'Giovanna Torres'])
  const fl = e.frequenciaEmLote({ clientes: ['Beta'], frequencia: 'quinzenal' })
  assert.match(fl.itens[0].aviso, /salvar não reativa — use Liberar/); assert.equal(fl.avisos.length, 1); assert.ok(fl.avisos[0].startsWith('Beta: '))
  e.frequenciaEmLote({ clientes: ['Beta'], frequencia: 'quinzenal', por: 'Giovanna Torres', confirmar: true })
  assert.deepEqual([prog(h, 'Beta').frequencia, prog(h, 'Beta').pausado_motivo, prog(h, 'Beta').falhas_seguidas, prog(h, 'Beta').ativado_por], ['quinzenal', 'falhas', 3, 'Giovanna Torres'])
  assert.equal(e.listar().itens.find(i => i.cliente === 'Beta').situacao, 'pausado')
  diagPronto(estado, 'Acme', {}, relogio); diagPronto(estado, 'Beta', {}, relogio)
  assert.deepEqual(e.liberar({ confirmar: true, por: 'Carla Souza' }), { ok: true, liberados: 2 }); assert.deepEqual([prog(h, 'Acme').pausado_motivo, prog(h, 'Beta').pausado_motivo, prog(h, 'Beta').falhas_seguidas], ['', '', 0])
  // desligar em lote zera tudo (religar exige liberar de novo)
  semearProg(h, 'Beta', { pausado_motivo: 'falhas', falhas_seguidas: 3, tentar_apos: ISO('2026-10-17') }); e.frequenciaEmLote({ clientes: ['Beta'], frequencia: 'desligado', por: 'Carla Souza', confirmar: true })
  assert.deepEqual([prog(h, 'Beta').ativado_por, prog(h, 'Beta').pausado_motivo, prog(h, 'Beta').falhas_seguidas, prog(h, 'Beta').tentar_apos], ['', '', 0, ''])
})

await ok('F1.7 MÉDIO — queda do Notion NÃO pausa a carteira: 5xx/rede/timeout não contam para a pausa por cliente; 3 falhas retentáveis seguidas interrompem o tick com UM aviso agregado; o lote manual idem; 403 continua pausando o cliente', async () => {
  const nomes = Array.from({ length: 15 }, (_, i) => 'Cli' + String(i).padStart(2, '0'))
  const m = montarEnvio({ clientes: nomes.map(c => [c, {}]), hoje: '2026-10-16', hora: '17:00' }); ligar(m); nomes.forEach(c => semearProg(m.h, c))
  const orig = m.w.notion.req; let posts = 0
  m.w.notion.req = async (c, o = {}) => { if (o.method === 'POST' && c === 'pages') { posts++; throw Object.assign(new Error('Notion 503'), { status: 503 }) } return orig(c, o) }
  const r = await m.e.tick()
  assert.deepEqual([r.interrompido, r.retentar, posts], ['disjuntor', 3, 3], 'para depois de 3 (antes: 6 por tick)')
  assert.deepEqual(m.notifs.map(x => [x.tipo, x.nivel, x.titulo, x.cliente || '']), [['relatorio_falhou:disjuntor', 'alerta', 'Notion indisponível: envios retomam no próximo ciclo', '']], 'UM aviso, nenhum por cliente')
  assert.ok(nomes.every(c => prog(m.h, c).pausado_motivo === '' && prog(m.h, c).falhas_seguidas === 0))
  assert.ok(nomes.slice(0, 3).every(c => Date.parse(prog(m.h, c).tentar_apos) > m.relogio.ms), 'quem falhou espera (backoff) sem somar falhas')
  let maximo = 0
  for (let i = 0; i < 36; i++) { m.relogio.avancarMin(10); const antes = m.notifs.length; await m.e.tick(); maximo = Math.max(maximo, m.notifs.length - antes) }
  assert.equal(maximo <= 1, true, 'no máximo um aviso por tick'); assert.ok(nomes.every(c => prog(m.h, c).pausado_motivo === '' && prog(m.h, c).falhas_seguidas === 0), 'seis horas de queda: ninguém pausado')
  assert.ok(m.notifs.every(x => x.tipo === 'relatorio_falhou:disjuntor' && !x.cliente))
  m.w.notion.req = orig; m.relogio.ir('2026-10-19', '17:00'); for (let i = 0; i < 3; i++) { await m.e.tick(); m.relogio.avancarMin(10) }
  assert.equal(m.w.criadas(), 15, 'o Notion voltou: toda a carteira sai, sem nenhuma intervenção')
  // falhas retentáveis que NÃO são do Notion (aqui: o brief) ainda contam por cliente, e o disjuntor também as corta
  const g = montarEnvio({ clientes: muitos(5), hoje: '2026-10-16', hora: '17:00' }); ligar(g); muitos(5).forEach(([c]) => semearProg(g.h, c)); g.bf.falhar = new Error('brief fora')
  const rg = await g.e.tick(); assert.deepEqual([rg.interrompido, rg.retentar, prog(g.h, 'Cli 00').falhas_seguidas, prog(g.h, 'Cli 03').falhas_seguidas], ['disjuntor', 3, 1, 0])
  assert.equal(g.notifs.length, 1); assert.equal(g.notifs[0].titulo, 'Envio automático de relatórios interrompido por falhas seguidas')
  // lote manual: para depois de 3 e dá UM resumo (sem aviso por cliente)
  const l = montarEnvio({ clientes: muitos(10) }); for (const [c] of muitos(10)) l.h.prepare("INSERT INTO relatorio_envio (cliente, de, ate, origem, estado, page_url, por, em) VALUES (?, '2026-10-02', '2026-10-08', 'manual', 'enviado', 'https://www.notion.so/x', 'x', 'y')").run(c)
  const lo = l.w.notion.req; let lp = 0; l.w.notion.req = async (c, o = {}) => { if (o.method === 'POST' && c === 'pages') { lp++; throw Object.assign(new Error('Notion 502'), { status: 502 }) } return lo(c, o) }
  const lr = await l.e.lote({ clientes: muitos(10).map(([c]) => c), confirmar: true, por: 'Giovanna Torres' }); await esperar(() => l.e.jobDe(lr.job.id).estado !== 'rodando')
  const jb = l.e.jobDe(lr.job.id); assert.equal(lp, 3); assert.deepEqual(jb.itens.map(i => i.estado), ['falhou', 'falhou', 'falhou', ...Array(7).fill('interrompido')]); assert.equal(jb.itens[9].mensagem, 'Notion indisponível: envios retomam no próximo ciclo')
  assert.deepEqual(l.notifs.map(x => x.tipo), ['relatorio_lote']); assert.match(l.notifs[0].corpo, /Interrompido: Notion indisponível/); assert.match(jb.resumo, /10 com problema/)
  // um cliente que falha SOZINHO por infraestrutura (os outros saem) não fica invisível: avisa uma vez no 6º erro seguido, sem pausar nem somar falhas
  const s1 = montarEnvio({ clientes: [['Sozinho', {}], ['Outro', {}]], hoje: '2026-10-16', hora: '17:00' }); ligar(s1); semearProg(s1.h, 'Sozinho'); const so = s1.w.notion.req
  s1.w.notion.req = async (c, o = {}) => { if (o.method === 'POST' && c === 'pages' && o.body?.parent?.data_source_id === s1.w.cfgCli.get('Sozinho').ds_id) throw Object.assign(new Error('Notion 502'), { status: 502 }); return so(c, o) }
  for (let k = 1; k <= 7; k++) { semearProg(s1.h, 'Sozinho', { proximo_envio: '2026-10-16', tentar_apos: '' }); await s1.e.tick(); if (k < 6) assert.equal(s1.notifs.length, 0, `antes do 6º erro (${k}) não avisa`) }
  assert.deepEqual(s1.notifs.map(x => [x.tipo, x.cliente]), [['relatorio_falhou:indisponivel', 'Sozinho']], 'um aviso, no 6º'); assert.deepEqual([prog(s1.h, 'Sozinho').pausado_motivo, prog(s1.h, 'Sozinho').falhas_seguidas], ['', 0])
  assert.ok(Date.parse(prog(s1.h, 'Sozinho').tentar_apos) - s1.relogio.ms >= 240 * 60_000, 'a espera escalona (30·2ⁿ min, máx. 6 h) com o número de erros seguidos')
  // não retentável (403) segue pausando o cliente na hora, com o motivo
  const f = montarEnvio({ clientes: muitos(3), hoje: '2026-10-16', hora: '17:00' }); ligar(f); muitos(3).forEach(([c]) => semearProg(f.h, c)); f.w.falhas.criar.push({ status: 403 })
  const rf = await f.e.tick(); assert.deepEqual([rf.pausados, rf.enviados, prog(f.h, 'Cli 00').pausado_motivo, rf.interrompido], [1, 2, 'notion_403', undefined])
})

await ok('F1.8a BAIXO — `qualidade` é checada antes de `vazio`: ML mudo + brief vazio no agendado é falha retentável (a semana não se perde em silêncio)', async () => {
  const m = montarEnvio({ hoje: '2026-10-16', hora: '17:30', brief: { modo: 'vazio', qualidadeOk: false } }); ligar(m); semearProg(m.h, 'Acme')
  const r = await m.e.tick(); assert.deepEqual([r.retentar, r.vazios], [1, 0])
  assert.deepEqual([prog(m.h, 'Acme').proximo_envio, prog(m.h, 'Acme').falhas_seguidas], ['2026-10-16', 1], 'a agenda NÃO avançou'); assert.deepEqual(linhasEnvio(m.h).map(x => [x.estado, x.motivo]), [['falhou', 'qualidade']])
  const p = await m.e.enviar('Acme', {}); assert.equal(p.bloqueio.estado, 'vazio'); assert.ok(p.avisos.some(x => /Mercado Livre não respondeu/.test(x)), 'no manual: vazio bloqueia e o aviso de qualidade aparece')
})

await ok('F1.8b BAIXO — 409 `em_voo` no tick: o cliente é pulado neste tick (nem falha, nem aviso, nem contagem)', async () => {
  const m = montarEnvio({ hoje: '2026-10-16', hora: '17:30' }); ligar(m); semearProg(m.h, 'Acme')
  let solta; m.bf.atraso = () => new Promise(r => { solta = r })
  const andamento = m.e.enviar('Acme', { origem: 'agendado', confirmar: true, por: 'Giovanna Torres' }); await esperar(() => !!solta)
  const r = await m.e.tick(); assert.deepEqual([r.processados, r.retentar, r.pausados, r.pulados], [0, 0, 0, 1])
  assert.deepEqual([prog(m.h, 'Acme').falhas_seguidas, prog(m.h, 'Acme').tentar_apos, m.notifs.length, linhasEnvio(m.h).length], [0, '', 0, 0]); solta(); await andamento
})

await ok('F1.8c BAIXO — o motivo faz parte do tipo do aviso (≤ 40 caracteres): um problema NOVO não é engolido pelo dedupe de 24 h do problema antigo', async () => {
  const m = montarEnvio({ hoje: '2026-10-16', hora: '17:30' }); ligar(m); semearProg(m.h, 'Acme')
  const pag = m.w.cfgCli.get('Acme').pagina_id, info = m.w.infoDePagina.get(pag); m.w.infoDePagina.delete(pag)         // 1º problema: sem a base Informações
  await m.e.tick(); assert.equal(prog(m.h, 'Acme').pausado_motivo, 'sem_base')
  m.w.infoDePagina.set(pag, info); m.e.invalidarCaches(); diagPronto(m.estado, 'Acme', {}, m.relogio); m.e.liberar({ clientes: ['Acme'], confirmar: true, por: 'Carla Souza' })
  m.w.falhas.criar.push({ status: 403 }); m.relogio.avancarMin(10); await m.e.tick()                                    // 2º problema, outra causa, o mesmo cliente
  assert.deepEqual(m.notifs.map(x => x.tipo), ['relatorio_falhou:sem_base', 'relatorio_falhou:notion_403'])
  assert.equal(new Set(m.notifs.map(x => `${x.tipo}|${x.cliente}`)).size, 2, 'o dedupe (tipo + cliente) trata os dois como avisos diferentes'); assert.ok(m.notifs.every(x => x.tipo.length <= 40))
})

await ok('F1.8d BAIXO — `notificar` que lança não derruba o tick e o erro vai ao log com o CÓDIGO (sem eco do texto)', async () => {
  const m = montarEnvio({ hoje: '2026-10-16', hora: '17:30', clientes: [['KBase', { base: false }]], notificar: () => { throw Object.assign(new Error('banco travou "SEGREDO-XYZ"'), { name: 'SqliteError' }) } })
  ligar(m); semearProg(m.h, 'KBase'); const r = await m.e.tick(); assert.equal(r.pausados, 1)
  const l = m.logs.filter(x => /não foi gravado/.test(x)); assert.equal(l.length, 1); assert.match(l[0], /relatorio_falhou:sem_base.*SqliteError/); assert.ok(!m.logs.join('\n').includes('SEGREDO-XYZ'))
})

await ok('F1.8e BAIXO — adotar: duplicatas MAIS ANTIGAS são arquivadas; se o arquivamento falhar o resultado traz `aviso` (antes, em silêncio)', async () => {
  const duas = async falhaArquivar => {
    const m = montarEnvio(), ds = m.w.cfgCli.get('Acme').ds_id, titulo = `${CATEGORIA} · 09/10 a 15/10/2026`
    m.w.paginasDs.get(ds).push({ id: '1'.repeat(32), url: 'https://www.notion.so/' + '1'.repeat(32), titulo, created_time: '2026-10-16T10:00:00.000Z', archived: false },
      { id: '2'.repeat(32), url: 'https://www.notion.so/' + '2'.repeat(32), titulo, created_time: '2026-10-16T11:00:00.000Z', archived: false })
    if (falhaArquivar) m.w.falhas.arquivar.push({ status: 500 })
    return { m, ds, r: await confirmar(m.e, 'Acme') }
  }
  let { m, ds, r } = await duas(false); assert.deepEqual([r.ok, r.estado, r.url, 'aviso' in r], [true, 'adotado', 'https://www.notion.so/' + '2'.repeat(32), false]); assert.deepEqual(m.w.paginasVivas(ds).map(p => p.id), ['2'.repeat(32)], 'a mais nova fica')
  ;({ m, ds, r } = await duas(true)); assert.deepEqual([r.ok, r.estado], [true, 'adotado']); assert.match(r.aviso, /não pôde ser arquivada: arquive-a no Notion/); assert.equal(m.w.paginasVivas(ds).length, 2); assert.equal(m.w.criadas(), 0)
})

await ok('F1.8f BAIXO — corrida (UNIQUE): a página recém-criada vira duplicata e é ARQUIVADA; a resposta devolve a URL do registro vivo', async () => {
  const m = montarEnvio(), orig = m.w.notion.req, ds = m.w.cfgCli.get('Acme').ds_id
  m.w.notion.req = async (c, o = {}) => { const x = await orig(c, o); if (o.method === 'POST' && c === 'pages') m.h.prepare("INSERT INTO relatorio_envio (cliente, de, ate, origem, estado, page_id, page_url, por, em) VALUES ('Acme', '2026-10-09', '2026-10-15', 'agendado', 'enviado', ?, 'https://www.notion.so/vivo', 'sistema', 'y')").run('9'.repeat(32)); return x }
  const r = await confirmar(m.e, 'Acme'); assert.deepEqual([r.ok, r.estado, r.url, 'aviso' in r], [true, 'ja_enviado', 'https://www.notion.so/vivo', false])
  assert.equal(m.w.chamadasDe('PATCH').length, 1); assert.equal(m.w.paginasVivas(ds).length, 0, 'nenhuma página nova sobrou')
})

await ok('F1.8g BAIXO — só `clientes` AUSENTE vale "todos": null, [] e não-lista são 400 em liberar e diagnosticar; proximo_envio null também é inválido', async () => {
  const { e } = montarEnvio({ clientes: muitos(2) })
  for (const ruim of [null, [], 'Cli 00', 5, {}]) { await falha(() => e.liberar({ clientes: ruim }), /informe "clientes" \(1 a 500\)/); await falha(() => e.diagnosticar({ clientes: ruim }), /informe "clientes" \(1 a 500\)/) }
  assert.equal(e.liberar({}).ok, true); const j = e.diagnosticar({}); assert.match(j.id, /^rj-/)
  await esperar(() => e.jobDe(j.id).estado !== 'rodando')
  await falha(() => e.programar({ cliente: 'Cli 00', frequencia: 'semanal', proximo_envio: null }), /data inválida/)
})

await ok('F1.8i BAIXO — hora e dia da janela 17h–23h são lidos em America/Sao_Paulo (Intl), nunca no fuso do processo: idêntico em TZ=UTC, America/Sao_Paulo e Pacific/Auckland; fuso inválido derruba a carga', async () => {
  assert.deepEqual(await rodarFuso(), ESPERADO_FUSO, 'no TZ deste processo')
  for (const tz of ['UTC', 'America/Sao_Paulo', 'Pacific/Auckland', 'Asia/Tokyo', 'America/Los_Angeles']) {
    const o = execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--fuso'], { env: { ...process.env, TZ: tz }, encoding: 'utf8' }).trim().split('\n')
    assert.deepEqual(o, ESPERADO_FUSO, `TZ=${tz}`)
  }
  const t = Date.parse('2026-10-17T01:30:00Z')
  assert.deepEqual([LIB.dataNoFuso(t, 'America/Sao_Paulo'), LIB.horaNoFuso(t, 'America/Sao_Paulo'), LIB.dataNoFuso(t, 'Pacific/Auckland'), LIB.horaNoFuso(t, 'Pacific/Auckland'), LIB.dataNoFuso(t, 'UTC'), LIB.horaNoFuso(t, 'UTC')], ['2026-10-16', '22:30', '2026-10-17', '14:30', '2026-10-17', '01:30'])
  assert.equal(LIB.horaNoFuso(Date.parse('2026-10-16T03:00:00Z'), 'America/Sao_Paulo'), '00:00', 'meia-noite é 00:00, nunca 24:00')
  assert.equal(lerConfig().fuso, 'America/Sao_Paulo')
  for (const ruim of ['Marte/Olimpo', '', 5, undefined, null]) assert.throws(() => validarConfig({ ...lerConfig(), fuso: ruim }), /config\/relatorio-envio\.json: "fuso"/, String(ruim))
})

await ok('F1.8j BAIXO — 401 do Notion: mensagem fixa «token», NÃO retentável e, por ser da carteira inteira, interrompe o tick/lote com UM aviso sem pausar nenhum cliente', async () => {
  const m = montarEnvio({ clientes: muitos(4), hoje: '2026-10-16', hora: '17:00' }); ligar(m); muitos(4).forEach(([c]) => semearProg(m.h, c)); m.w.falhas.criar.push({ status: 401 })
  const r = await m.e.tick(); assert.deepEqual([r.interrompido, r.processados, r.pausados, r.enviados], ['credencial', 1, 0, 0])
  assert.ok(muitos(4).every(([c]) => prog(m.h, c).pausado_motivo === '' && prog(m.h, c).falhas_seguidas === 0))
  assert.deepEqual(m.notifs.map(x => [x.tipo, x.nivel, x.cliente || '']), [['relatorio_falhou:notion_401', 'erro', '']]); assert.match(m.notifs[0].corpo, /token do Notion/)
  const a = montarEnvio(); a.w.falhas.criar.push({ status: 401 }); const x = await a.e.enviar('Acme', { origem: 'agendado', confirmar: true, por: 'Giovanna Torres' })
  assert.deepEqual([x.ok, x.motivo, x.retentavel], [false, 'notion_401', false]); assert.match(x.mensagem, /token do Notion/); assert.ok(!JSON.stringify([x, a.logs]).includes('CORPO-SECRETO'))
  const b = montarEnvio(), orig = b.w.notion.req; b.w.notion.req = async (c, o) => { if (c.startsWith('pages/')) throw Object.assign(new Error('Notion 401 {"x":"CORPO-SECRETO"}'), { status: 401 }); return orig(c, o) }
  const e401 = await falha(() => b.e.enviar('Acme', {}), /token do Notion/, 502); assert.ok(!e401.message.includes('CORPO-SECRETO'))
  const l = montarEnvio({ clientes: muitos(4) }); for (const [c] of muitos(4)) l.h.prepare("INSERT INTO relatorio_envio (cliente, de, ate, origem, estado, page_url, por, em) VALUES (?, '2026-10-02', '2026-10-08', 'manual', 'enviado', 'https://www.notion.so/x', 'x', 'y')").run(c)
  l.w.falhas.criar.push({ status: 401 }); const lr = await l.e.lote({ clientes: muitos(4).map(([c]) => c), confirmar: true, por: 'Giovanna Torres' }); await esperar(() => l.e.jobDe(lr.job.id).estado !== 'rodando')
  assert.deepEqual(l.e.jobDe(lr.job.id).itens.map(i => i.estado), ['falhou', 'interrompido', 'interrompido', 'interrompido']); assert.deepEqual(l.notifs.map(i => i.tipo), ['relatorio_lote'])
})

await ok('F1.8k BAIXO — a fixture gera ids únicos para 40 clientes (antes «d1» e «d10» colidiam a partir do 16º) e cada cliente escreve na PRÓPRIA base', async () => {
  const nomes = Array.from({ length: 40 }, (_, i) => `Cli ${String(i).padStart(2, '0')}`), m = montarEnvio({ clientes: nomes.map(c => [c, {}]) })
  for (const k of ['pagina_id', 'info_id', 'ds_id']) assert.equal(new Set([...m.w.cfgCli.values()].map(c => c[k])).size, 40, k)
  assert.equal(new Set(m.w.fontes.map(f => f.dbId)).size, 40, 'dbId'); assert.ok([...m.w.cfgCli.values()].every(c => /^[0-9a-f]{32}$/.test(c.pagina_id + '') && /^[0-9a-f]{32}$/.test(c.ds_id)))
  const alvo = ['Cli 00', 'Cli 01', 'Cli 15', 'Cli 16', 'Cli 31', 'Cli 39']
  for (const c of alvo) { const r = await confirmar(m.e, c); assert.deepEqual([c, r.ok, r.estado], [c, true, 'enviado']) }
  assert.equal(m.w.criadas(), alvo.length); for (const c of alvo) assert.equal(m.w.paginasVivas(m.w.cfgCli.get(c).ds_id).length, 1, c)
})

await ok('F1.8l BAIXO — semearProgramacao rejeita data no passado (hoje vale); o padrão de «hoje» vem do fuso, não do processo', () => {
  const h = new Database(':memory:'), HOJE = () => '2026-10-08'
  assert.throws(() => semearProgramacao(h, ['A'], { data: '2026-10-07', hoje: HOJE }), /data no passado/)
  assert.equal(semearProgramacao(h, ['A'], { data: '2026-10-08', hoje: HOJE }).data, '2026-10-08'); assert.equal(semearProgramacao(h, ['A'], { data: '2026-10-09', hoje: HOJE }).total, 1)
  assert.throws(() => semearProgramacao(h, ['A'], { data: '2000-01-01' }), /data no passado/, 'sem hoje injetado: o relógio real, no fuso da operação')
})

await ok('F1.9 prévia do envio ANTECIPADO: proximo_envio_depois, dias_sem_cobertura e aviso_cobertura (aditivos; o consumo da agenda não muda)', async () => {
  const prev = async (hoje, prog_, extra = {}) => { const m = montarEnvio({ hoje, hora: '12:00', ...extra }); if (prog_) semearProg(m.h, 'Acme', prog_); return { m, p: await m.e.enviar('Acme', {}) } }
  const campos = p => [p.proximo_envio_depois, p.dias_sem_cobertura]
  let { m, p } = await prev('2026-10-13', {})                                              // terça, sexta programada 16/10
  assert.deepEqual(campos(p), ['2026-10-23', ['2026-10-13', '2026-10-14', '2026-10-15']]); assert.match(p.aviso_cobertura, /antecipa o próximo envio automático.*não aparecerão em nenhum relatório/)
  const r = await m.e.enviar('Acme', { confirmar: true, por: 'Giovanna Torres', previa_id: p.previa_id }); assert.equal(r.proximo_envio, p.proximo_envio_depois, 'a prévia diz exatamente o que o envio vai gravar'); assert.equal(prog(m.h, 'Acme').proximo_envio, '2026-10-23')
  assert.deepEqual(campos((await prev('2026-10-14', {})).p), ['2026-10-23', ['2026-10-14', '2026-10-15']], 'quarta')
  assert.deepEqual(campos((await prev('2026-10-12', {})).p), ['2026-10-16', []], 'segunda (4 dias antes): mantém a sexta — nada se perde')
  assert.deepEqual(campos((await prev('2026-10-11', {})).p), ['2026-10-16', []], 'domingo')
  assert.deepEqual(campos((await prev('2026-10-16', {})).p), ['2026-10-23', []], 'na própria sexta')
  assert.deepEqual(campos((await prev('2026-10-23', { proximo_envio: '2026-10-16' })).p), ['2026-10-30', []], 'atrasado: um envio, sem fila e sem buraco')
  const q = await prev('2026-10-27', { frequencia: 'quinzenal', proximo_envio: '2026-10-30' }); assert.deepEqual(campos(q.p), ['2026-11-13', ['2026-10-27', '2026-10-28', '2026-10-29']], 'quinzenal antecipado: só os dias que o ANTECIPAR tira (a lacuna do desenho quinzenal não conta)')
  assert.deepEqual(campos((await prev('2026-10-30', { frequencia: 'quinzenal', proximo_envio: '2026-10-30' })).p), ['2026-11-13', []], 'quinzenal na data')
  assert.deepEqual(campos((await prev('2026-10-27', { frequencia: 'mensal', proximo_envio: '2026-10-31', ancora_dia: 31 })).p), ['2026-11-30', ['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']], 'mensal antecipado')
  const sem = (await prev('2026-10-13', null)).p; assert.deepEqual([...campos(sem), sem.aviso_cobertura], ['', [], ''], 'sem programação: nada a dizer')
  assert.deepEqual(campos((await prev('2026-10-13', { frequencia: 'desligado', proximo_envio: '', ativado_por: '' })).p), ['', []])
  const bl = (await prev('2026-10-13', {}, { brief: { modo: 'vazio' } })).p; assert.deepEqual([bl.acao, ...campos(bl)], ['bloqueado', '', []], 'bloqueado: nada será enviado')
})

// ═══ PLANO B (09/10/2026): Informações não aceita → tarefa no quadro «Tarefas - {Cliente}» ══════════════════════════════════════════
await ok('G1 plano B — Secção status SEM opção + quadro Tarefas no stub: prévia vira criar_tarefa (destino_tipo tarefa, aviso claro); confirmar cria 1 página no QUADRO com título/Canal/Demanda/people/descrição/data e os MESMOS blocos; relatorio_envio categoria tarefa', async () => {
  const m = montarEnvio({ clientes: [['Acme', { secao: 'status', opcaoCategoria: false, quadro: true }]] }), { w, h, e } = m
  const p = await e.enviar('Acme', {})
  assert.deepEqual([p.ok, p.previa, p.acao, p.bloqueio, p.destino_tipo, p.categoria.estado], [true, true, 'criar_tarefa', null, 'tarefa', 'nao_resolvida'])
  assert.equal(p.titulo, `Relatório · ${CATEGORIA} · 09/10 a 15/10/2026`)
  assert.deepEqual([p.tarefa.canal, p.tarefa.demanda, p.tarefa.responsavel, p.tarefa.motivo], ['Geral', 'Relatório', 'Pamela Vitoria Barros', 'opcao_ausente_status']); assert.match(p.tarefa.quadro_url, /^https:\/\/www\.notion\.so\//)
  assert.match(p.avisos[0], /não tem a aba .*: o relatório vai como tarefa no quadro Tarefas, Canal Geral, responsável Pamela/); assert.equal(p.avisos.length, 1, 'quadro completo: nenhum outro aviso')
  assert.ok(p.tarefa.descricao.length <= 1900 && /^Conta em crescimento\. Faturamento/.test(p.tarefa.descricao) && /\nResultados: Faturamento R\$ 14\.920,00 \(▲ 11,3%\)/.test(p.tarefa.descricao) && /\nConcluído: Novas fotos/.test(p.tarefa.descricao) && /\nPróximos passos: 21\/10 Novas fotos/.test(p.tarefa.descricao), p.tarefa.descricao)
  assert.ok(p.linhas.length > 10, 'o texto que o cliente lê é o mesmo relatório')
  assert.equal(w.criadas(), 0, 'prévia não escreve')
  const r = await e.enviar('Acme', { confirmar: true, por: 'Giovanna Torres', previa_id: p.previa_id })
  assert.deepEqual([r.ok, r.estado, r.categoria, r.destino_tipo], [true, 'enviado', 'tarefa', 'tarefa'])
  const c = w.cfgCli.get('Acme'), post = w.chamadasDe('POST', 'pages')
  assert.equal(post.length, 1); assert.equal(post[0].retry5xx, false)
  const b = post[0].body
  assert.deepEqual(b.parent, { data_source_id: c.quadro_id }, 'no QUADRO, não na Informações'); assert.equal(w.paginasVivas(c.ds_id).length, 0); assert.equal(w.paginasVivas(c.quadro_id).length, 1)
  assert.equal(b.properties.Tarefas.title[0].text.content, p.titulo)
  assert.deepEqual(b.properties.Canal, { select: { name: 'Geral' } }); assert.deepEqual(b.properties.Demandas, { select: { name: 'Relatório' } }, 'select: o Notion cria a opção')
  assert.deepEqual(b.properties['Responsável'], { people: [{ id: '0a1b2c3d-0000-4000-8000-00000000c0de' }] }); assert.deepEqual(b.properties.Data, { date: { start: '2026-10-16' } })
  assert.equal(b.properties['Descrição'].rich_text.map(t => t.text.content).join(''), p.tarefa.descricao)
  assert.ok(!('Secção ' in b.properties) && !('Status' in b.properties), 'nada de Secção/Status do relatório na tarefa')
  assert.ok(b.children.length > 10 && b.children[0].type === 'callout' && b.children.some(x => x.type === 'heading_2' && x.heading_2.rich_text[0].text.content === 'Resultados'), 'children = os blocos do relatório')
  assert.equal(JSON.stringify(b).includes('_interno'), false)
  const L = linhasEnvio(h); assert.deepEqual(L.map(x => [x.estado, x.categoria, x.motivo]), [['enviado', 'tarefa', '']]); assert.equal(L[0].page_url, r.url); assert.match(L[0].page_url, /^https:\/\/www\.notion\.so\//)
  // reenvio do mesmo período = pular (nada escrito); substituir não vale para tarefa
  const p2 = await e.enviar('Acme', {}); assert.deepEqual([p2.acao, p2.destino_tipo, p2.ja_enviado?.url], ['pular', 'tarefa', r.url])
  const r2 = await e.enviar('Acme', { confirmar: true, por: 'Giovanna Torres', previa_id: p2.previa_id, substituir: true }); assert.deepEqual([r2.ok, r2.estado, r2.categoria], [true, 'ja_enviado', 'tarefa']); assert.equal(w.criadas(), 1)
  const cd = e.clienteDe('Acme'); assert.deepEqual(cd.historico.map(x => [x.estado, x.categoria]), [['enviado', 'tarefa']])
})

await ok('G2 plano B — sem_base e sem_pagina com quadro → tarefa; título já no quadro (banco perdido) → adotar sem escrever e sem arquivar; sem quadro → bloqueio antigo; fallback desligado → bloqueio antigo; Informações pronta nunca usa o plano B', async () => {
  const m = montarEnvio({ clientes: [['SemBase', { base: false, quadro: true }], ['SemPag', { pagina_id_resolvido: '', quadro: true }], ['StatusSem', { secao: 'status', opcaoCategoria: false }], ['Ok', { quadro: true }], ['Alt', { secao: 'status', opcaoCategoria: false, quadro: true }]] }), { w, e } = m
  const pb = await e.enviar('SemBase', {}); assert.deepEqual([pb.acao, pb.destino_tipo, pb.tarefa.motivo, pb.destino.estado], ['criar_tarefa', 'tarefa', 'sem_base', 'sem_base']); assert.match(pb.avisos[0], /não tem a base Informações: o relatório vai como tarefa/)
  const pp = await e.enviar('SemPag', {}); assert.deepEqual([pp.acao, pp.tarefa.motivo], ['criar_tarefa', 'sem_pagina']); assert.match(pp.avisos[0], /página do cliente não foi localizada: o relatório vai como tarefa/)
  const ps = await e.enviar('StatusSem', {}); assert.deepEqual([ps.acao, ps.destino_tipo, ps.bloqueio.estado], ['bloqueado', 'informacoes', 'opcao_ausente_status'], 'sem quadro: bloqueio antigo')
  const po = await e.enviar('Ok', {}); assert.deepEqual([po.acao, po.destino_tipo, po.categoria.estado], ['criar', 'informacoes', 'ok'], 'Informações pronta: nada muda')
  const rb = await confirmar(e, 'SemBase'); assert.deepEqual([rb.ok, rb.estado, rb.categoria], [true, 'enviado', 'tarefa'])
  // título já no quadro (ex.: banco local perdido): adota, não escreve, não arquiva
  const q = w.cfgCli.get('Alt').quadro_id; w.paginasDs.get(q).push({ id: 'e'.repeat(32), url: 'https://www.notion.so/' + 'e'.repeat(32), titulo: `Relatório · ${CATEGORIA} · 09/10 a 15/10/2026`, created_time: '2026-10-16T19:00:00.000Z', archived: false, body: {} })
  w.paginasDs.get(q).push({ id: 'f'.repeat(32), url: 'https://www.notion.so/' + 'f'.repeat(32), titulo: `Relatório · ${CATEGORIA} · 09/10 a 15/10/2026`, created_time: '2026-10-16T18:00:00.000Z', archived: false, body: {} })
  const pa = await e.enviar('Alt', {}); assert.deepEqual([pa.acao, pa.destino_tipo], ['adotar', 'tarefa'])
  w.limpar(); const ra = await e.enviar('Alt', { confirmar: true, por: 'Giovanna Torres', previa_id: pa.previa_id })
  assert.deepEqual([ra.ok, ra.estado, ra.categoria, ra.url], [true, 'adotado', 'tarefa', 'https://www.notion.so/' + 'e'.repeat(32)]); assert.equal(w.chamadasDe('POST', 'pages').length, 0); assert.equal(w.chamadasDe('PATCH', 'pages').length, 0, 'nunca arquiva card do quadro')
  // fallback desligado: bloqueio antigo mesmo com quadro
  const d = montarEnvio({ clientes: [['Acme', { secao: 'status', opcaoCategoria: false, quadro: true }]], cfg: { fallback_tarefa: { ...lerConfig().fallback_tarefa, ligado: false } } })
  const pd = await d.e.enviar('Acme', {}); assert.deepEqual([pd.acao, pd.destino_tipo, pd.bloqueio.estado], ['bloqueado', 'informacoes', 'opcao_ausente_status'])
  assert.equal(lerConfig().fallback_tarefa.ligado, true, 'config real: plano B ligado'); assert.throws(() => validarConfig({ ...lerConfig(), fallback_tarefa: { ligado: 'sim' } }), /fallback_tarefa\.ligado/)
  // o alerta ao cliente continua pendente com categoria_ausente mesmo com o quadro disponível (nunca vira tarefa)
  const al = montarAlerta({ clientes: [['StatusSem', { secao: 'status', opcaoCategoria: false, quadro: true }]] }); al.estoque('StatusSem'); al.pronto('StatusSem'); al.ligar(); await al.e.varrer()
  assert.deepEqual(al.linhas().map(l => [l.cliente, l.estado, l.motivo]), [['StatusSem', 'pendente', 'categoria_ausente']]); assert.equal(al.w.chamadas.some(c => c.method === 'POST' && c.caminho === 'pages'), false)
})

await ok('G3 plano B — quadro sem Canal «Geral» (status), sem Responsável, Pamela ausente/duplicada: avisa e a tarefa nasce sem o campo (nunca cria opção de status); 5xx no POST = incerto, consulta por título no QUADRO; erro do Notion nunca ecoa', async () => {
  const m = montarEnvio({ clientes: [['A', { secao: 'status', opcaoCategoria: false, quadro: { canal: 'status', semResp: true } }]], usuarios: [] }), { w, e } = m
  const p = await e.enviar('A', {}); assert.equal(p.acao, 'criar_tarefa')
  assert.deepEqual(p.avisos.slice(1), ['A coluna «Canal» é do tipo Status e não tem a opção «Geral»: a tarefa nasce sem ela.', 'Responsável «Pamela» sem usuário do Notion identificado: a tarefa nasce sem responsável.', 'O quadro não tem a coluna Responsável (pessoas): a tarefa nasce sem responsável.'])
  assert.deepEqual([p.tarefa.canal, p.tarefa.responsavel], ['', ''])
  w.falhas.criar.push({ status: 502, cria: true })
  const r = await e.enviar('A', { confirmar: true, por: 'Giovanna Torres', previa_id: p.previa_id })
  assert.deepEqual([r.ok, r.estado, r.categoria], [true, 'adotado', 'tarefa'], '5xx com página criada: adota pela consulta por título no quadro'); assert.ok(!JSON.stringify([r, m.logs]).includes(SEGREDO))
  const b = w.chamadasDe('POST', 'pages')[0].body; assert.ok(!('Canal' in b.properties) && !('Responsável' in b.properties)); assert.deepEqual(b.properties.Demandas, { select: { name: 'Relatório' } })
  const dup = montarEnvio({ clientes: [['A', { secao: 'status', opcaoCategoria: false, quadro: true }]], usuarios: [{ id: '0a1b2c3d-0000-4000-8000-00000000c0de', nome: 'Pamela Rocha' }, { id: '0a1b2c3d-0000-4000-8000-00000000c0d1', nome: 'Pâmela Lima' }] })
  const pd = await dup.e.enviar('A', {}); assert.match(pd.avisos[1], /Há 2 usuários do Notion chamados «Pamela»/); assert.equal(pd.tarefa.responsavel, '')
})

await ok('G4 plano B — diagnosticar: cliente com Informações sem a opção mas com quadro vira pronto (categoria tarefa, proxima_acao vazia); liberar e o agendador seguem o mesmo caminho; situação e CSV mostram «tarefa (Pamela)»', async () => {
  const m = montarEnvio({ clientes: [['Tar', { secao: 'status', opcaoCategoria: false, quadro: true }], ['Bloq', { secao: 'status', opcaoCategoria: false }], ['Ok', {}]], hoje: '2026-10-16', hora: '17:30' }), { w, h, e, estado, relogio } = m
  const job = e.diagnosticar({}); await esperar(() => e.jobDe(job.id).estado !== 'rodando')
  assert.deepEqual(Object.fromEntries(e.jobDe(job.id).itens.map(i => [i.cliente, i.estado])), { Tar: 'pronto', Bloq: 'opcao_ausente_status', Ok: 'pronto' })
  const d = JSON.parse(estado.get('rel_diag:Tar')); assert.deepEqual([d.pronto, d.categoria, d.proxima_acao, d.destino, d.secao_tipo], [true, 'tarefa', '', 'ok', 'status'])
  assert.deepEqual(e.diagnostico().resumo, { prontos: 2, opcao_ausente: 1, sem_base: 0, sem_pagina: 0, nao_verificados: 0 })
  assert.match(e.diagnosticoCsv(), /"Tar";[^\r\n]*"tarefa \(Pamela\)"/); assert.ok(!/"Tar";[^\r\n]*"opcao_ausente_status"/.test(e.diagnosticoCsv()))
  for (const c of ['Tar', 'Bloq', 'Ok']) { semearProg(h, c, { ativado_por: '', ativado_em: '', proximo_envio: '2026-10-16' }); h.prepare("INSERT INTO relatorio_envio (cliente, de, ate, origem, estado, por, em) VALUES (?, '2026-10-02', '2026-10-08', 'manual', 'arquivado', 'x', 'x')").run(c) }
  const lib = e.liberar({ confirmar: true, por: 'Carla Souza' }); assert.equal(lib.liberados, 2, 'Tar e Ok liberados; Bloq fica de fora')
  assert.equal(e.listar().itens.find(i => i.cliente === 'Tar').motivo, 'Destino: tarefa (Pamela) no quadro Tarefas'); assert.equal(e.listar().itens.find(i => i.cliente === 'Ok').motivo, '')
  ligar(m); const t = await e.tick(); assert.deepEqual([t.enviados, t.pausados], [2, 0])
  assert.deepEqual(linhasEnvio(h).filter(x => x.estado === 'enviado').map(x => [x.cliente, x.categoria, x.origem]).sort(), [['Ok', 'aplicada', 'agendado'], ['Tar', 'tarefa', 'agendado']])
  assert.equal(w.paginasVivas(w.cfgCli.get('Tar').quadro_id).length, 1); assert.equal(w.paginasVivas(w.cfgCli.get('Tar').ds_id).length, 0)
  assert.equal(prog(h, 'Tar').proximo_envio, '2026-10-23'); void relogio
})

// ═══ H. documento (PDF) anexado à página depois do envio (09/10/2026) — detalhes em teste-relatorio-pdf.mjs ═══════════════════════════════════════
await ok('H1: envio com anexo ok — PDF do MESMO brief, bloco file no topo da página, anexo:"ok" no retorno e em relatorio_envio.anexo; o plano B (tarefa) também recebe o documento', async () => {
  const m = montarEnvio({ clientes: [['Acme', {}], ['Tar', { secao: 'status', opcaoCategoria: false, quadro: true }]] })
  const r = await confirmar(m.e, 'Acme')
  assert.deepEqual([r.ok, r.estado, r.anexo], [true, 'enviado', 'ok']); assert.equal(m.w.pdfs.length, 1); assert.equal(m.w.uploads.length, 1)
  const pg = m.w.paginasDs.get(m.w.cfgCli.get('Acme').ds_id)[0]
  assert.deepEqual([pg.body.children[0].type, pg.body.children[1].type, pg.body.children[1].file.name], ['callout', 'file', 'acme-2026-10-09-2026-10-15.pdf'])
  assert.deepEqual(briefParaBlocos(briefSintetico('Acme', { hoje: m.relogio.hoje(), hora: '17:00' })), pg.body.children.filter(b => b.type !== 'file'), 'o corpo enviado não muda')
  assert.equal(linhasEnvio(m.h)[0].anexo, 'ok')
  const t = await confirmar(m.e, 'Tar'); assert.deepEqual([t.ok, t.destino_tipo, t.anexo], [true, 'tarefa', 'ok'])
  assert.equal(m.w.paginasVivas(m.w.cfgCli.get('Tar').quadro_id)[0].body.children.filter(b => b.type === 'file').length, 1)
})
await ok('H2: anexo falhou (Chrome ausente / upload recusado) = aviso anexo:"falhou:<codigo>", o envio fica registrado como enviado e nunca é desfeito; reenvio do período = ja_enviado sem novo PDF', async () => {
  const m = montarEnvio({ clientes: [['Acme', {}], ['Beta', {}]] })
  m.w.falhas.pdf.push('pdf_indisponivel')
  const r = await confirmar(m.e, 'Acme')
  assert.deepEqual([r.ok, r.estado, r.anexo], [true, 'enviado', 'falhou:pdf_indisponivel']); assert.match(r.url, /^https:/)
  assert.deepEqual([linhasEnvio(m.h)[0].estado, linhasEnvio(m.h)[0].anexo], ['enviado', 'falhou:pdf_indisponivel']); assert.equal(m.w.criadas(), 1); assert.equal(m.w.uploads.length, 0)
  m.w.falhas.upload.push(502)
  const b = await confirmar(m.e, 'Beta'); assert.deepEqual([b.ok, b.estado, b.anexo], [true, 'enviado', 'falhou:notion_502']); assert.ok(!JSON.stringify(b).includes(SEGREDO))
  const de = await confirmar(m.e, 'Acme'); assert.equal(de.estado, 'ja_enviado'); assert.equal('anexo' in de, false); assert.equal(m.w.pdfs.length, 1)
  assert.equal(m.e.clienteDe('Acme').historico[0].anexo, 'falhou:pdf_indisponivel')
})

console.log(`\n${n} verificações do envio ok.`)
