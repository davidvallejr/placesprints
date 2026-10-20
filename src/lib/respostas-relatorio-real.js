// Fiação REAL da coleta de respostas ao relatório (src/lib/respostas-relatorio.js): banco local, env do n8n (o MESMO PLACE_GATILHOS_URL/SECRET e a mesma assinatura de
// gatilhos-envio.postar), quem pode marcar (líder/consultor) e o carimbo diário em sync_estado. Os grupos vêm de clientes_central.notificacao_json (padrão do núcleo).
// (O autoteste usa stubs; este arquivo não roda nos testes.)
import { db, agora, log, getEstado, setEstado } from './db.js'
import { env } from './env.js'
import { validarLiderOuConsultor } from './equipe.js'
import { criarEnvio } from './gatilhos-envio.js'
import { criarRespostas, lerConfig } from './respostas-relatorio.js'

export function criarRespostasReal() {
  const cfg = lerConfig()
  const envio = criarEnvio({ env, agora, webhook: { timeout_ms: cfg.webhook.timeout_ms }, log })
  return criarRespostas(db, { cfg, envio, agora, validarPor: validarLiderOuConsultor, estado: { get: getEstado, set: setEstado }, log })
}
