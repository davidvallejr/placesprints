// Fiação REAL dos alinhamentos com o cliente (src/lib/alinhamentos.js): banco, relógio local, auditor e validação de quem registra (líder/consultor da central).
// Nomes internos para o auditor do motivo: líderes/consultores + analistas oficiais + responsáveis das tarefas e ações do cliente — o mesmo conjunto de
// relatorio-brief-real.nomesInternos, lido aqui direto do banco porque aquele módulo importa plano-cliente (que importa este: ciclo).
import { db, agora, hojeLocal } from './db.js'
import { validarLiderOuConsultor, lideresEConsultores } from './equipe.js'
import { criarAlinhamentos } from './alinhamentos.js'

const separa = txt => String(txt || '').split(/[,;/]|\s+e\s+/i).map(x => x.replace(/\s+/g, ' ').trim()).filter(x => x && x !== '—')
function nomesInternos(cliente) {
  const nomes = new Set(lideresEConsultores())
  const tenta = (sql, ...a) => { try { return db.prepare(sql).all(...a) } catch { return [] } }
  for (const r of tenta('SELECT nome FROM analistas_oficiais')) nomes.add(r.nome)
  for (const r of tenta("SELECT DISTINCT responsavel FROM tarefas WHERE cliente = ? AND arquivada = 0 AND responsavel <> ''", cliente)) separa(r.responsavel).forEach(n => nomes.add(n))
  for (const r of tenta('SELECT DISTINCT responsavel, delegado_a, squad FROM acoes_plano WHERE cliente = ?', cliente)) [...separa(r.responsavel), ...separa(r.delegado_a), ...separa(r.squad)].forEach(n => nomes.add(n))
  return [...nomes]
}

let inst = null
export const alinhamentosReal = () => inst ||= criarAlinhamentos({ handle: db, hoje: hojeLocal, agora, nomesInternos, validarPor: validarLiderOuConsultor })
