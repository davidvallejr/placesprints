// Páginas do retorno OAuth dos ERPs (/erp/callback) — o que o CLIENTE vê no navegador depois de autorizar
// o Bling ou o Tiny. Mesma identidade visual de meli-paginas.js; todo texto dinâmico passa por esc().
// no-referrer: a URL do callback carrega `code` e `state` — não vazam para as fontes externas da página.
import { FONTES, CSS, esc } from './estilo-editorial.js'

function pagina(corpo) {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex">
<title>ERP — Place2u</title>${FONTES}<style>${CSS}
.central{max-width:480px;margin:80px auto;padding:0 20px;text-align:center}
.selo{width:64px;height:64px;border-radius:16px;margin:0 auto 24px;display:flex;
  align-items:center;justify-content:center;font-size:30px}
.selo.ok{background:var(--sage);color:#fff} .selo.erro{background:var(--blood);color:#fff}
.central h1{font-size:24px;margin-bottom:10px} .central p{font-size:14px;color:var(--rule)}
</style></head><body><div class="central">${corpo}</div></body></html>`
}

export const paginaOkErp = (cliente, erp) => pagina(`
  <div class="selo ok">✓</div>
  <h1>ERP conectado</h1>
  <p><b>${esc(cliente)}</b> foi conectado ao <b>${esc(erp)}</b>.</p>
  <p style="margin-top:18px">A Place2u só <b>lê</b> o custo dos produtos — nada é alterado no seu ERP. Pode fechar esta janela.</p>`)

export const paginaErroErp = motivo => pagina(`
  <div class="selo erro">!</div>
  <h1>Não foi possível conectar o ERP</h1>
  <p>${esc(motivo || 'Ocorreu um erro inesperado.')}</p>
  <p style="margin-top:18px">Fale com seu consultor Place2u para gerar um novo link.</p>`)
