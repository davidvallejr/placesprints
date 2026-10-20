// Mundo sintético dos autotestes do alerta de pendência crítica ao cliente (src/lib/alerta-cliente.js): reaproveita o stub do Notion e o relógio falso do relatório
// (relatorio-mundo.mjs, sem editá-lo), o NÚCLEO REAL do avaliador de pendências (pendencias-cliente.js) sobre dependências stub e a reconferência ao vivo controlável.
// Nenhuma rede, nenhum banco real. Usado por teste-alerta-cliente.mjs e teste-alerta-rotas.mjs.
import Database from 'better-sqlite3'
import { criarMundo, criarRelogio, validarPor, QUEM, norm, SEGREDO } from './relatorio-mundo.mjs'
import { criarPendencias, SCHEMA_PENDENCIAS } from '../../src/lib/pendencias-cliente.js'
import { catalogoReal, itemMl, baseMl, tarefa } from './pendencias-mundo.mjs'
import { auditarTexto } from '../../src/lib/relatorio-seguro.js'
import { SCHEMA_RELATORIO, estadoDeHandle } from '../../src/lib/relatorio-envio.js'
import { criarAlertaCliente, lerConfig } from '../../src/lib/alerta-cliente.js'

export { QUEM, norm, SEGREDO, validarPor, criarRelogio }

// relógio padrão: quarta-feira 14/10/2026 às 10:00 (São Paulo) — dentro da janela de 08:00 às 20:00
// alinhado/idAcao (opcionais): predicado REAL do núcleo dos alinhamentos composto com o avaliador (o teste passa o de criarAlinhamentos sobre m.h)
export function montarAlerta({ clientes = [['Acme', {}]], cfg = {}, hoje = '2026-10-14', hora = '10:00', elegiveis, semRelogioInjetado = false, notificar, nomes = ['Giovanna Torres', 'Carla Souza'], explicar, avaliar, alinhado = null, idAcao = null } = {}) {
  const w = criarMundo(), relogio = criarRelogio(hoje, hora)
  for (const [nome, o] of clientes) w.adicionar(nome, { secao: 'select', opcaoCategoria: true, ...o })
  // o stub do relatório só conhece as páginas dos clientes: o atualizarStatus lê a página já CRIADA (parent.data_source_id), então ela entra aqui
  const baseReq = w.notion.req
  w.notion.req = async (caminho, o = {}) => {
    const m = !o.method || o.method === 'GET' ? caminho.match(/^pages\/([0-9a-f]{32})$/) : null
    if (m) for (const [ds, lista] of w.paginasDs) {
      const p = lista.find(x => x.id === m[1])
      if (p) { w.chamadas.push({ caminho, method: 'GET', body: undefined }); return { object: 'page', id: p.id, parent: { data_source_id: ds }, archived: p.archived, in_trash: false } }
    }
    return baseReq(caminho, o)
  }
  const h = new Database(':memory:'); h.exec(SCHEMA_RELATORIO); h.exec(SCHEMA_PENDENCIAS)
  w.estado = estadoDeHandle(h)
  for (const [nome] of clientes) w.estado.set(`pagina_cliente:${nome}`, w.cfgCli.get(nome).pagina_id)
  const mundo = { bases: new Map(), contas: new Map(), tarefas: [] }
  const pend = criarPendencias({
    handle: h, catalogo: catalogoReal(), auditar: auditarTexto, hoje: relogio.hoje, agora: relogio.agora, validarPor,
    dependencias: { listar: ({ cliente }) => mundo.tarefas.filter(t => t.cliente === cliente) },
    riscoEstoque: c => mundo.bases.get(c) ?? null, contasMl: c => mundo.contas.get(c) ?? null, acoesPlano: () => new Map(),
    ...(alinhado ? { alinhado, idAcao } : {}),
  })
  const reconf = { estado: 'confirmado', lancar: null, chamadas: [] }
  const reconferir = async (cliente, p, o) => { reconf.chamadas.push({ cliente, item: p.item, ids: o.ids }); if (reconf.lancar) throw reconf.lancar; return { estado: reconf.estado } }
  const notifs = [], logs = []
  const pendencias = explicar || avaliar ? { avaliar: c => avaliar ? avaliar(c, x => pend.avaliar(x)) : pend.avaliar(c), explicar: explicar || (p => pend.explicar(p)), cat: pend.cat } : pend   // `explicar`/`avaliar` injetáveis: texto ruim para o auditor, avaliação que quebra
  const e = criarAlertaCliente({
    handle: h, notion: w.notion, pendencias, destinos: w.destinos, nomesInternos: () => nomes, reconferir, agora: relogio.agora, ...(semRelogioInjetado ? {} : { hoje: relogio.hoje, hora: relogio.hora }),
    validarPor, notificar: notificar || (o => notifs.push(o)), log: (nv, m) => logs.push(`${nv}: ${m}`),
    elegiveis: elegiveis || (() => clientes.map(([n]) => ({ cliente: n, status: 'Ativo' }))),
    clienteCanonico: nome => clientes.map(([n]) => n).find(n => norm(n) === norm(nome)) || '', cfg: { ...lerConfig(), ...cfg }, ceder: async () => {},
  })
  const m = { w, h, relogio, e, pend, mundo, reconf, notifs, logs, estado: w.estado }
  m.iso = (min = -60) => new Date(relogio.ms + min * 60_000).toISOString()                  // leitura de estoque fresca (1 h atrás) por padrão
  // estoque crítico no ML: curva A com 3 dias de cobertura (leitura fresca); `itens` sobrescreve campos de cada anúncio
  m.estoque = (cliente, itens = [{}], base = {}) => mundo.bases.set(cliente, baseMl(itens.map((i, k) => itemMl({ id: `MLB90${k}`, cobertura: 3, estoque: 3, atualizado_em: m.iso(), ...i })), { atualizado_em: m.iso(), ...base }))   // ids estáveis: repetir a chamada não muda a assinatura
  m.tarefa = (o = {}) => { const t = tarefa({ cliente: 'Acme', processo: 'Amazon', tipo: 'documentos', dias: 35, desde: '2026-09-09', faixa: 'revisar', ...o }); mundo.tarefas.push(t); return t }
  m.liberar = (cliente, o = {}) => h.prepare(`INSERT INTO relatorio_programacao (cliente, frequencia, proximo_envio, ancora_dia, ativado_por, ativado_em, pausado_motivo, atualizado_em)
    VALUES (?, 'semanal', '2026-10-16', 0, ?, '2026-10-10T12:00:00.000Z', ?, 'x') ON CONFLICT(cliente) DO UPDATE SET ativado_por = excluded.ativado_por, pausado_motivo = excluded.pausado_motivo`).run(cliente, o.ativado_por ?? 'Giovanna Torres', o.pausado_motivo ?? '')
  m.relatorioEnviado = cliente => h.prepare("INSERT INTO relatorio_envio (cliente, de, ate, origem, estado, page_url, por, em) VALUES (?, '2026-10-02', '2026-10-08', 'manual', 'enviado', 'https://www.notion.so/x', 'x', 'y')").run(cliente)
  m.ligar = () => e.agendador({ ligado: true, por: 'Carla Souza' })
  m.pronto = cliente => { m.liberar(cliente); m.relatorioEnviado(cliente) }          // tudo que o envio automático exige do cliente
  m.linhas = () => h.prepare('SELECT * FROM alerta_cliente ORDER BY id').all()
  m.snapshotRelatorio = () => JSON.stringify([h.prepare('SELECT * FROM relatorio_programacao ORDER BY cliente').all(), h.prepare('SELECT * FROM relatorio_envio ORDER BY id').all()])
  return m
}
