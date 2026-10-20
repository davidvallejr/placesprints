// Fiação REAL do perfil de informação do cliente (src/lib/perfil-informacao.js): banco local, relógio, livro de registro, quem pode registrar (líder/consultor ou o CS
// DESTE cliente, como no dossiê) e a carteira (clientes ativos da central). O autoteste usa a fábrica com banco em memória; este arquivo não roda nos testes.
import { db, agora } from './db.js'
import { livroReal, validarDossie, clientesAtivos } from './livro-registro-real.js'
import { criarPerfilInformacao } from './perfil-informacao.js'

let perfis = null
export const perfilInformacaoReal = () => perfis ||= criarPerfilInformacao(db, { livro: livroReal(), agora, validarPor: validarDossie, clientes: clientesAtivos })
