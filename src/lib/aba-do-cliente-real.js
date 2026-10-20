// Fiação REAL da aba «Do cliente» (src/lib/aba-do-cliente.js): banco local e os módulos que já existem — nenhum segundo motor, nenhuma chamada ao ML ou ao Notion.
import { db, agora, hojeLocal } from './db.js'
import { pendenciasReal } from './pendencias-cliente-real.js'
import { lerAcoes, idAcao, playbook } from './plano-cliente.js'
import { prioridadeAcao } from './motor-ppc.js'
import { diagnosticarConta, algoritmo } from './diagnostico-conta.js'
import { comprasDoCliente } from './gatilhos-real.js'
import { itensMicroCompras } from './plano-semana-texto.js'
import { auditarTexto } from './relatorio-seguro.js'
import { validarDossie } from './livro-registro-real.js'
import { criarAbaDoCliente } from './aba-do-cliente.js'

const tem = t => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(t)
export function criarAbaDoClienteReal({ rotulo } = {}) {
  return criarAbaDoCliente({
    handle: db, pendencias: pendenciasReal(), hoje: hojeLocal, agora, idAcao, prioridade: prioridadeAcao, validarPor: validarDossie, auditar: auditarTexto, rotulo,
    acoes: c => lerAcoes({ clientes: [c], status: ['proposta', 'aprovada', 'distribuida'] }),
    compras: c => { const diag = diagnosticarConta(c); return itensMicroCompras(diag, diag?.disponivel ? comprasDoCliente(c, { diag }) : null, { limiares: algoritmo.limiares, ciclo_dias: algoritmo.compras.ciclo_compra_dias }) },
    comunicacao: c => ({
      lotes: db.prepare('SELECT id, tipo, dia, estado, enviado_em, recibos_json FROM gatilho_lote WHERE cliente = ? ORDER BY criado_em DESC LIMIT 60').all(c),
      avisados: db.prepare('SELECT item_id, enviado_em, lote_id FROM gatilho_avisado WHERE cliente = ?').all(c),
      gatilhos: db.prepare("SELECT tipo, itens_json, lote_id, enviado_em FROM gatilho_cliente WHERE cliente = ? AND lote_id <> ''").all(c),
      respostas: tem('feedback_relatorio') ? db.prepare('SELECT recebido_em, texto, status, origem FROM feedback_relatorio WHERE cliente = ? ORDER BY recebido_em DESC LIMIT 50').all(c) : [],
    }),
    limiares: { atencao: playbook.limiares.dependencia_atencao_dias, revisar: playbook.limiares.dias_parada }, folga: algoritmo.limiares.estoque_seguranca_dias,
  })
}
