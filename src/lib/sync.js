// Sincronização incremental Notion → SQLite.
// Só rebusca páginas com last_edited_time posterior ao último sync de cada fonte;
// só relê blocos/evidências quando a página realmente mudou.
import { mkdirSync, writeFileSync, statfsSync } from 'node:fs'
import { join, extname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { db, agora, hojeLocal, log, getEstado, setEstado } from './db.js'
import { ROOT } from './env.js'
import { resolverFontes, consultarPaginas, lerBlocos, baixarArquivo } from './notion.js'
import { extrairTarefa, processarBlocos, hashConteudo, mapeamento } from './extrair.js'
import { descobrirFontes, fontesCfg } from './descobrir.js'
import { sincronizarPlanos } from './plano-informacoes.js'
import { PLANEJADA_SQL } from './status-tarefa.js'
import { SQL_REABERTURA } from './dependencia-cliente.js'
import { notionCliente } from './notion-cliente-real.js'
export { descobrirFontes }

let marcarReaberta   // preparado na 1ª vez (a tabela nasce em db.js, SCHEMA_DEPENDENCIA)

const upsertTarefa = db.prepare(`
  INSERT INTO tarefas (id, fonte, cliente, projeto, sprint, titulo, processo, responsavel,
    status_raw, status, prioridade, data_inicio, prazo, data_conclusao, esforco,
    resultado_esperado, resultado_alcancado, impacto, bloqueio, proximo_passo,
    visivel_cliente, descricao, tipo_demanda, etiquetas, conteudo, url, last_edited, hash, sync_em, arquivada)
  VALUES (@id, @fonte, @cliente, @projeto, @sprint, @titulo, @processo, @responsavel,
    @status_raw, @status, @prioridade, @data_inicio, @prazo, @data_conclusao, @esforco,
    @resultado_esperado, @resultado_alcancado, @impacto, @bloqueio, @proximo_passo,
    @visivel_cliente, @descricao, @tipo_demanda, @etiquetas, @conteudo, @url, @last_edited, @hash, @sync_em, @arquivada)
  ON CONFLICT(id) DO UPDATE SET
    fonte=excluded.fonte, cliente=excluded.cliente, projeto=excluded.projeto, sprint=excluded.sprint,
    titulo=excluded.titulo, processo=excluded.processo, responsavel=excluded.responsavel,
    status_raw=excluded.status_raw, status=excluded.status, prioridade=excluded.prioridade,
    data_inicio=excluded.data_inicio, prazo=excluded.prazo, data_conclusao=excluded.data_conclusao,
    esforco=excluded.esforco, resultado_esperado=excluded.resultado_esperado,
    resultado_alcancado=excluded.resultado_alcancado, impacto=excluded.impacto,
    bloqueio=excluded.bloqueio, proximo_passo=excluded.proximo_passo,
    visivel_cliente=excluded.visivel_cliente, descricao=excluded.descricao, tipo_demanda=excluded.tipo_demanda, etiquetas=excluded.etiquetas,
    conteudo=excluded.conteudo, url=excluded.url, last_edited=excluded.last_edited,
    hash=excluded.hash, sync_em=excluded.sync_em, arquivada=excluded.arquivada
`)

const EVIDENCIA_DISCO_MIN_GB = 15
export const discoLivreGb = () => { try { const f = statfsSync(join(ROOT, 'data')); return (f.bavail * f.bsize) / 1e9 } catch { return Infinity } }
let avisoDisco = 0
const avisarDiscoCheio = () => { if (Date.now() - avisoDisco > 3600e3) { avisoDisco = Date.now(); log('aviso', `Trinity: disco com menos de ${EVIDENCIA_DISCO_MIN_GB} GB livres — anexos do Notion NÃO baixados (só a URL de origem) até liberar espaço`) } }

async function persistirEvidencia(tarefaId, ev) {
  const existente = db.prepare('SELECT arquivo_local FROM evidencias WHERE id = ?').get(ev.id)
  let arquivoLocal = existente?.arquivo_local || ''

  // Baixa para armazenamento persistente ANTES da URL assinada do Notion expirar.
  const baixavel = ['image', 'file', 'pdf', 'video'].includes(ev.tipo)
  // ponytail (15/10/2026): o disco encheu (28 GB de anexos, 99% usado) e o banco parou de abrir. Com menos de EVIDENCIA_DISCO_MIN_GB livres, não baixa:
  // guarda só a URL de origem e tenta de novo no próximo sync, quando houver espaço. Teto fixo; se precisar, vira config.
  if (baixavel && !arquivoLocal && discoLivreGb() < EVIDENCIA_DISCO_MIN_GB) { avisarDiscoCheio() } else
  if (baixavel && !arquivoLocal) {
    try {
      const buf = await baixarArquivo(ev.url_origem)
      const limpa = ev.url_origem.split('?')[0]
      const ext = extname(limpa).slice(0, 8) || (ev.tipo === 'image' ? '.png' : '.bin')
      const dir = join(ROOT, 'data', 'evidencias', tarefaId.replace(/-/g, ''))
      mkdirSync(dir, { recursive: true })
      const nome = `${ev.id.replace(/-/g, '')}${ext}`
      writeFileSync(join(dir, nome), buf)
      arquivoLocal = `evidencias/${tarefaId.replace(/-/g, '')}/${nome}`
      // evidência em PDF ganha miniatura da 1ª página (sips, nativo do macOS)
      if (ext.toLowerCase() === '.pdf') {
        try { execFileSync('sips', ['-s', 'format', 'png', join(dir, nome), '--out', join(dir, nome + '.png')], { stdio: 'ignore', timeout: 20000 }) } catch {}
      }
    } catch (e) {
      log('aviso', `evidência ${ev.id} não baixada (${e.message}) — mantendo URL de origem`)
    }
  }
  db.prepare(`INSERT INTO evidencias (id, tarefa_id, tipo, url_origem, arquivo_local, legenda, criada_em)
    VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET tipo=excluded.tipo, url_origem=excluded.url_origem,   -- 'frio:' (arquivado por scripts/arquivar-evidencias.mjs) nunca volta ao caminho local que já não existe
      arquivo_local=CASE WHEN evidencias.arquivo_local LIKE 'frio:%' THEN evidencias.arquivo_local WHEN excluded.arquivo_local != '' THEN excluded.arquivo_local ELSE evidencias.arquivo_local END,
      legenda=excluded.legenda`)
    .run(ev.id, tarefaId, ev.tipo, ev.url_origem, arquivoLocal, ev.legenda, ev.criada_em)
}

function registrarMudancas(anterior, nova) {
  if (!anterior) return
  for (const campo of ['sprint', 'status', 'responsavel', 'prazo']) {
    if (anterior[campo] !== nova[campo]) {
      db.prepare('INSERT INTO historico (tarefa_id, campo, de, para, em) VALUES (?,?,?,?,?)')
        .run(nova.id, campo, String(anterior[campo] ?? ''), String(nova[campo] ?? ''), agora())
    }
  }
}

export function gravarSnapshots() {
  const dia = hojeLocal()
  const grupos = db.prepare(`
    SELECT cliente, projeto, sprint,
      COUNT(*) AS planejadas,
      SUM(CASE WHEN status = 'concluida' THEN 1 ELSE 0 END) AS concluidas,
      SUM(COALESCE(esforco, 1)) AS esforco_planejado,
      SUM(CASE WHEN status = 'concluida' THEN COALESCE(esforco, 1) ELSE 0 END) AS esforco_concluido
    FROM tarefas WHERE arquivada = 0 AND ${PLANEJADA_SQL}
    GROUP BY cliente, projeto, sprint`).all()
  const ins = db.prepare(`INSERT INTO snapshots (dia, cliente, projeto, sprint, planejadas, concluidas, esforco_planejado, esforco_concluido)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(dia, cliente, projeto, sprint) DO UPDATE SET planejadas=excluded.planejadas,
      concluidas=excluded.concluidas, esforco_planejado=excluded.esforco_planejado, esforco_concluido=excluded.esforco_concluido`)
  for (const g of grupos) ins.run(dia, g.cliente, g.projeto, g.sprint, g.planejadas, g.concluidas, g.esforco_planejado, g.esforco_concluido)
  return grupos.length
}

// autogestão A3 (15/10/2026): timeout/rede do Notion (o 14/10 abortou o sync inteiro por UM request lento) ganha nova tentativa com backoff AQUI, sem mexer em
// notion.js (que só retenta 429/5xx). Só leituras passam por aqui; HTTP com status (4xx/5xx) e «NOTION_TOKEN ausente» não são rede e sobem na hora.
export const ehErroRede = e => !e?.status && (['TimeoutError', 'AbortError'].includes(e?.name) || /fetch failed|aborted due to timeout|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|socket hang up|network/i.test(`${e?.message} ${e?.cause?.code ?? ''}`))
export async function comRetentativaRede(fn, { tentativas = 4, baseMs = 2000, dormir = ms => new Promise(r => setTimeout(r, ms)), aoRetentar = () => {} } = {}) {
  for (let i = 0; ; i++) {
    try { return await fn() } catch (e) {
      if (!ehErroRede(e) || i >= tentativas - 1) throw e
      aoRetentar(e, i + 1)
      await dormir(baseMs * 2 ** i + Math.floor(Math.random() * 500))   // 2-4-8 s com jitter
    }
  }
}
const retentarNotion = (fn, rotulo) => comRetentativaRede(fn, { aoRetentar: (e, n) => log('aviso', `Trinity · Notion ${rotulo}: ${String(e?.name || 'erro de rede')} — nova tentativa ${n}`) })

// completo=true ignora o marcador incremental (rotina agendada de segurança).
// cliente="X" limita a descoberta (testes/execuções pontuais).
// tetoMs (tick de 2 h): passou do teto, as fontes restantes ficam para o próximo sync (o marcador «desde» é por fonte, então nada se perde) e as mais
// atrasadas vão primeiro na vez seguinte; com fonte pulada o «ultimo_sync» NÃO avança (vai para ultimo_sync_parcial) — a saúde não mostra «em dia» sem estar.
export async function sincronizar({ completo = false, cliente, tetoMs = 0 } = {}) {
  const inicio = Date.now()
  const resumo = { fontes: 0, paginas: 0, alteradas: 0, evidencias: 0, erros: [], camposAusentes: new Set(), pulados: 0 }

  const fontes = await retentarNotion(() => descobrirFontes({ filtroCliente: cliente }), 'descoberta')
  if (tetoMs > 0) fontes.sort((a, b) => String(getEstado(`desde:${a.dbId}`) || '').localeCompare(String(getEstado(`desde:${b.dbId}`) || '')))
  resumo.fontes = fontes.length
  log('info', `sync ${completo ? 'COMPLETO' : 'incremental'}${cliente ? ` (filtro: ${cliente})` : ''} — ${fontes.length} fonte(s)`)

  for (const f of fontes) {
    if (tetoMs > 0 && Date.now() - inicio > tetoMs) { resumo.pulados++; continue }
    const chave = `desde:${f.dbId}`
    // piso do primeiro sync (e do --completo): evita varrer anos de histórico
    const piso = fontesCfg.sync_inicial_desde ? fontesCfg.sync_inicial_desde + 'T00:00:00Z' : undefined
    const desde = completo ? piso : (getEstado(chave) || piso)
    const marca = new Date().toISOString()
    try { await retentarNotion(async () => {   // a fonte inteira é refeita no erro de rede: idempotente (upsert + last_edited; o marcador só grava no fim)
      const resolvidas = f.modo === 'data_source' ? [{ id: f.dbId, modo: 'data_source' }] : await resolverFontes(f.dbId)
      for (const fonte of resolvidas) {
        for await (const pg of consultarPaginas(fonte, { desde })) {
          resumo.paginas++
          const { tarefa, ausentes } = extrairTarefa(pg, { cliente: f.cliente, projeto: f.projeto })
          // linhas de relatório publicadas por este sistema (Canal = "Relatório")
          // não são tarefas de trabalho — não entram no cálculo de indicadores
          const canalRelatorio = mapeamento.linha_relatorio_semanal?.canal?.valor
          if (canalRelatorio && tarefa.processo === canalRelatorio && /^relat[oó]rio semanal/i.test(tarefa.titulo)) continue
          ausentes.forEach(c => resumo.camposAusentes.add(c))

          const anterior = db.prepare('SELECT * FROM tarefas WHERE id = ?').get(tarefa.id)
          if (anterior && anterior.last_edited === tarefa.last_edited && !completo) continue
          if (anterior && anterior.last_edited > tarefa.last_edited) continue   // leitura mais velha que o local (nosso PATCH de dependência entre a consulta e o upsert) nunca rebaixa a tarefa
          resumo.alteradas++

          // Blocos internos + evidências (somente para páginas alteradas)
          let conteudo = '', evidencias = []
          try {
            const blocos = await retentarNotion(() => lerBlocos(pg.id), 'blocos')
            const r = processarBlocos(blocos)
            conteudo = r.texto.join('\n')
            evidencias = r.evidencias
          } catch (e) {
            log('aviso', `blocos de "${tarefa.titulo}" falharam: ${e.message}`)
          }

          tarefa.fonte = f.dbId
          tarefa.conteudo = conteudo
          tarefa.hash = hashConteudo(tarefa, conteudo, evidencias)
          tarefa.sync_em = agora()
          registrarMudancas(anterior, tarefa)
          upsertTarefa.run(tarefa)
          // saiu de "Aguardando Devolutiva" no Notion DEPOIS do nosso PATCH: o registro fica, marcado como reaberto ("se passou, passou")
          if (tarefa.status !== 'dependencia_cliente') (marcarReaberta ??= db.prepare(SQL_REABERTURA)).run(agora(), tarefa.status_raw, tarefa.id, tarefa.last_edited)

          for (const ev of evidencias) {
            await persistirEvidencia(tarefa.id, ev)
            resumo.evidencias++
          }
        }
      }
      setEstado(chave, marca)

      // planos de ação 5W2H do mês corrente (base "Informações" do cliente):
      // no sync completo ou filtrado — no incremental de rotina fica a cargo do publicar
      if (f.cliente && (completo || cliente)) {
        const r = await sincronizarPlanos({ cliente: f.cliente, paginaClienteId: f.paginaClienteId, tarefasDbId: f.dbId, tarefasModo: f.modo, meses: [hojeLocal().slice(0, 7)] })
        if (r.encontrados) log('info', `  planos de ação (${f.cliente}): ${r.encontrados} canal(is)`)
        else if (r.motivo) log('aviso', `  planos de ação (${f.cliente}): ${r.motivo}`)
      }
    }, `fonte ${f.cliente || f.dbId}`) } catch (e) {
      // uma fonte com falha não derruba o relatório inteiro
      resumo.erros.push(`${f.cliente || f.dbId}: ${e.message}`)
      log('erro', `fonte ${f.cliente || f.dbId}: ${e.message}`)
    }
  }

  // Notion do cliente (página, filhos e base Informações) — etapa com teto de tempo e try/catch por cliente: nunca derruba o sync
  try {
    const nc = await notionCliente.etapaSync({ limiteMs: completo ? 15 * 60_000 : 4 * 60_000, filtro: cliente })
    log('info', `  Notion dos clientes: ${nc.lidos} lido(s), ${nc.erros} com erro${nc.pulados ? `, ${nc.pulados} ficam para o próximo sync (teto de tempo)` : ''}`)
  } catch (e) { log('aviso', `  Notion dos clientes: ${String(e?.message ?? e).slice(0, 80)}`) }

  const nSnap = gravarSnapshots()
  // livro de registro: fatos novos (tarefas, status, anexos…) entram já com a data da fonte; nunca derruba o sync
  try { await (await import('./livro-registro-real.js')).ingerirLivro({ origem: 'sync' }) } catch { /* o livro nunca derruba o sync */ }
  setEstado(resumo.pulados ? 'ultimo_sync_parcial' : 'ultimo_sync', agora())
  const seg = ((Date.now() - inicio) / 1000).toFixed(1)
  log('info', `sync ok em ${seg}s — ${resumo.paginas} página(s) vistas, ${resumo.alteradas} alterada(s), ${resumo.evidencias} evidência(s), ${nSnap} snapshot(s)${resumo.pulados ? ` — ${resumo.pulados} fonte(s) para o próximo sync (teto de tempo)` : ''}`)
  if (resumo.camposAusentes.size)
    log('aviso', `campos sem propriedade correspondente nas bases: ${[...resumo.camposAusentes].join(', ')} — veja config/mapeamento.json e o README (seção "Campos recomendados")`)
  return { ...resumo, camposAusentes: [...resumo.camposAusentes], segundos: Number(seg) }
}
