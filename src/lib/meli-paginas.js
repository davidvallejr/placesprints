// Páginas de retorno do fluxo OAuth — o que o CLIENTE vê no navegador ao
// clicar no botão do Notion. Mesma identidade visual dos relatórios.
import { FONTES, CSS, esc } from './estilo-editorial.js'
import { gtmHead, gtmBody } from './gtm.js'

// gtm: SÓ nas páginas que o PROSPECT do funil comercial vê (server.js passa { gtm: true } quando a chave é de prospect); cliente/S90 nunca
function pagina(corpo, { gtm = false } = {}) {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mercado Livre — Place2u</title>${FONTES}<style>${CSS}
.central{max-width:480px;margin:80px auto;padding:0 20px;text-align:center}
.selo{width:64px;height:64px;border-radius:16px;margin:0 auto 24px;display:flex;
  align-items:center;justify-content:center;font-size:30px}
.selo.ok{background:var(--sage);color:#fff} .selo.erro{background:var(--blood);color:#fff}
.central h1{font-size:24px;margin-bottom:10px} .central p{font-size:14px;color:var(--rule)}
</style>${gtm ? gtmHead() : ''}</head><body>${gtm ? gtmBody() : ''}<div class="central">${corpo}</div></body></html>`
}

export const paginaOk = (cliente, nickname) => pagina(`
  <div class="selo ok">✓</div>
  <h1>Conta conectada</h1>
  <p><b>${esc(cliente)}</b>${nickname ? ` está conectado ao Mercado Livre como <b>${esc(nickname)}</b>.` : ' foi conectado ao Mercado Livre.'}</p>
  <p style="margin-top:18px">Pode fechar esta janela — os relatórios já vão usar os dados reais da conta.</p>`)

// s90: cliente do Place Sprint 90 (autoatendimento) não tem consultor — volta ao painel e tenta de novo
export const paginaErro = (motivo, { s90 = false, gtm = false } = {}) => pagina(`
  <div class="selo erro">!</div>
  <h1>Não foi possível conectar</h1>
  <p>${esc(motivo || 'Ocorreu um erro inesperado.')}</p>
  <p style="margin-top:18px">${s90 ? 'Volte ao painel e tente de novo. Se continuar, fale com a Place2u.' : gtm ? 'Volte à página do diagnóstico e tente de novo. Se continuar, fale com a Place2u.' : 'Fale com seu consultor Place2u para gerar um novo link.'}</p>`, { gtm })
