// E-mail do Place Sprint 90: canal "só no painel" nesta versão (docs/desenho-place-sprint-90.md, D4). Nenhum provedor integrado:
// toda chamada devolve `pendente` com o que falta — nada é enviado e nada finge ter sido. Quem integrar um provedor mexe só aqui.
import { env } from './env.js'

export function enviarEmail() {
  const faltando = ['EMAIL_PROVEDOR', 'EMAIL_REMETENTE'].filter(k => !env[k])
  return { estado: 'pendente', canal: 'painel', faltando: faltando.length ? faltando : ['integração do provedor de e-mail'], nota: 'Nenhum e-mail é enviado nesta versão: o link vai pela tela (painel) ou a equipe entrega.' }
}
