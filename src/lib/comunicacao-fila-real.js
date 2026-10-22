// Fiação da Comunicação em esteira (F1, docs/desenho-comunicacao-esteira.md): lê as tabelas que já existem (só SELECT, lista fechada de colunas) e o estado
// dos interruptores (o MESMO contexto da tela de Estruturas: sync_estado + configs carregados no início) e entrega a src/lib/comunicacao-fila.js (puro).
// Itens vivos sempre; terminais (entregue, enviado, resolvido, executada…) só dos últimos DIAS_HISTORICO dias. Tabela ausente = null (aparece em nao_lidos).
import { db, agora } from './db.js'
import { contextoReal } from './estrutura-estado-real.js'
import { montarFila, lerFontes } from './comunicacao-fila.js'

export function filaReal({ handle = db } = {}) {
  const { fontes, liberacao } = lerFontes(handle)
  let gate = null; try { const c = contextoReal(); gate = { estado: c.estado, configs: c.configs } } catch { gate = null }
  return montarFila({ fontes, liberacao, gate, agora: agora() })
}
