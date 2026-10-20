// Chave do cliente do Place Sprint 90 (autoatendimento): "[S90] <loja> · <id8>". Predicado ÚNICO: meli-contas, plano-anuncios, server e s90 perguntam só a ele.
// Nunca entra em clientes_central (a central vem do Notion); "[S90]" não bate no jargão "sprint N" do auditor (relatorio-seguro.js).
export const ehChaveS90 = chave => /^\[S90\] .+ · [0-9a-f]{8}$/.test(String(chave || ''))
export const chaveS90 = (loja, id) => `[S90] ${loja} · ${id}`
// log/stdout viram arquivo (data/server.log) que a exclusão LGPD não alcança: a chave S90 sai só como "Sprint 90 <id8>" (a loja nunca contém "·": s90.normalizar troca por "-")
export const semChaveS90 = msg => String(msg ?? '').replace(/\[S90\] [^·\n]*? · ([0-9a-f]{8})/g, 'Sprint 90 $1')
// estados em que a conta S90 continua sendo lida/renovada/replanejada (cancelada, exclusão agendada, pendente: só consulta até o expurgo)
export const S90_FORA_DA_COLETA_SQL = "(cliente LIKE '[S90] %' AND cliente NOT IN (SELECT chave FROM s90_conta WHERE estado IN ('ativo','pausado','inadimplente')))"
// visões internas da equipe (insights, padrões da base, Gargalos): a conta S90 é do motor, não da carteira da assessoria (mesmo molde do fonte != 's90' das tarefas)
export const NAO_S90_SQL = "cliente NOT LIKE '[S90] %'"
