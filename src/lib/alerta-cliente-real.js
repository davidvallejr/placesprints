// Fiação REAL do alerta de pendência crítica ao cliente (src/lib/alerta-cliente.js): banco, Notion, avaliador de pendências e as leituras AO VIVO da reconferência.
// As leituras ao vivo são SÓ de leitura: Mercado Livre (multiget de anúncios com available_quantity e status; /users/me) e Notion (GET da página da tarefa). Nada é escrito aqui;
// a escrita no Notion do cliente só acontece em criarAlertaCliente, depois de todas as salvaguardas. (O autoteste usa stubs; este arquivo não é executado nos testes.)
import { db, agora, log } from './db.js'
import { notionReq } from './notion.js'
import { notificar } from './notificacoes.js'
import { validarLiderOuConsultor, clientesElegiveis } from './equipe.js'
import { descobrirFontes } from './descobrir.js'
import { resolverPaginaCliente, acharInformacoesDb, invalidarCliente } from './plano-informacoes.js'
import { nomesInternos } from './relatorio-brief-real.js'
import { pendenciasReal } from './pendencias-cliente-real.js'
import { chamar, multiget } from './meli-api.js'
import { extrairTarefa } from './extrair.js'
import { criarAlertaCliente, criarReconferencia } from './alerta-cliente.js'

const ID_ML = /^[A-Za-z]{3}\d{5,15}$/        // anúncio do ML (MLB…): só isso entra na URL do multiget

export function criarAlertaReal({ clienteCanonico } = {}) {
  const pendencias = pendenciasReal()
  // disponível e status atuais dos anúncios (leitura; uma chamada de multiget por reconferência, no máximo 3 itens)
  const estoqueAoVivo = async (cliente, ids) => {
    const lista = ids.filter(i => ID_ML.test(String(i)))
    const out = new Map()
    if (!lista.length) return out
    let corpos
    try { corpos = await multiget(cliente, lista, 'id,available_quantity,status') } catch { throw new Error('leitura ao vivo indisponível') }   // /items/bulk; 0 lidos de N = indisponível (nunca decide)
    for (const b of corpos) out.set(String(b.id), { disponivel: Number.isFinite(b.available_quantity) ? b.available_quantity : null, status: String(b.status || '') })
    return out
  }
  // status atual da tarefa NO NOTION (mesma normalização do sync: extrairTarefa); página arquivada ou removida = fora da dependência
  const statusTarefasAoVivo = async ids => {
    const out = new Map()
    for (const id of ids) {
      try {
        const pg = await notionReq(`pages/${id}`)
        out.set(id, pg?.archived || pg?.in_trash ? 'arquivada' : extrairTarefa(pg).tarefa.status)
      } catch (e) { if (e?.status === 404) out.set(id, 'arquivada'); else throw e }
    }
    return out
  }
  // a conta do cliente ainda não responde? ('erro' confirma o alerta; 'ok' o nega). Falha de rede NÃO decide: lança e a reconferência fica indisponível.
  const contaAoVivo = async cliente => {
    try {
      const r = await chamar(cliente, '/users/me', { permitirFalha: true })
      if (!r?._erro) return 'ok'
      if ([401, 403].includes(r.status)) return 'erro'
      throw new Error('leitura ao vivo indisponível')
    } catch (e) {
      if (/não conectada|desconectada/i.test(String(e?.message))) return 'erro'
      throw e
    }
  }
  const reconferir = criarReconferencia({ handle: db, estoqueAoVivo, statusTarefasAoVivo, contaAoVivo, limiares: pendencias.cat?.limiares?.estoque })
  return criarAlertaCliente({
    handle: db, notion: { req: notionReq }, pendencias, nomesInternos, reconferir, agora, validarPor: validarLiderOuConsultor, notificar, log,
    destinos: { fontes: descobrirFontes, resolverPaginaCliente, acharInformacoesDb, invalidar: invalidarCliente },
    elegiveis: () => clientesElegiveis().elegiveis, clienteCanonico,
  })
}
