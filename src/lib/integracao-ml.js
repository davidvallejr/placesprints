// Integração Mercado Livre DE FATO (decisão do David, 12/10/2026): só recebe aviso automático (cliente no WhatsApp e time no Discord) o cliente com
//  (1) conexão ML ativa — a mesma lista da coleta diária (meli-contas.listarConexoesColeta: sem erro/revogada, sem prospect, sem S90 fora de serviço);
//  (2) coleta ML nos últimos 3 dias — último dia de pedidos coletado (meli_coleta_dia.dia) ≥ hoje − 3;
//  (3) vendas > 0 nos últimos 28 dias — a MESMA janela do diagnóstico (diagnostico-conta.carregarBase: hoje−28 … hoje−1 em meli_serie_item).
// Função ÚNICA reaproveitada por gatilhos.js (elegível ao envio automático e liberação em lote) e consultor-discord.js (destinatários do resumo do time).
// Pura: as leituras entram injetadas (fiação real em gatilhos-real.js, que já tem o banco); motivo FIXO quando não.
export const MOTIVOS_INTEGRACAO = {
  sem_conexao_ml: 'Sem conexão ativa com o Mercado Livre (ou a conexão está em erro).',
  coleta_atrasada: 'A coleta do Mercado Livre não roda há mais de 3 dias.',
  sem_vendas_28d: 'Sem vendas no Mercado Livre nos últimos 28 dias.',
}
export const DIAS_COLETA = 3
const addDias = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

// leituras: { conectado(c) → bool, ultimaColeta(c) → 'AAAA-MM-DD' | '', vendas28d(c, { de, ate }) → unidades, hoje() → 'AAAA-MM-DD' }
// → { ok: true, motivo: '' } | { ok: false, motivo: 'sem_conexao_ml' | 'coleta_atrasada' | 'sem_vendas_28d' }
export function integracaoMlAtiva(cliente, { conectado, ultimaColeta, vendas28d, hoje }) {
  const h = hoje()
  if (!conectado(cliente)) return { ok: false, motivo: 'sem_conexao_ml' }
  const u = String(ultimaColeta(cliente) || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(u) || u < addDias(h, -DIAS_COLETA)) return { ok: false, motivo: 'coleta_atrasada' }
  if (!(Number(vendas28d(cliente, { de: addDias(h, -28), ate: addDias(h, -1) })) > 0)) return { ok: false, motivo: 'sem_vendas_28d' }
  return { ok: true, motivo: '' }
}
