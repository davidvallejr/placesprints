// Google Tag Manager — SÓ nas páginas públicas do funil comercial (landing, resultado /d/<token>, páginas de volta do OAuth do prospect).
// Nunca no painel interno. O dataLayer leva só ids opacos (id curto do lead) e UTMs; nunca nome, e-mail, telefone ou empresa.
export const GTM_ID = 'GTM-T3LFKQP'
export const gtmHead = () => `<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTM_ID}');</script>`
export const gtmBody = () => `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${GTM_ID}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`
// evento no dataLayer; `dados` só com chaves da lista fechada (nada pessoal passa por aqui)
const CHAVES = ['lead_id', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'origem']
export const dlEvento = (evento, dados = {}) => {
  const o = { event: String(evento) }
  for (const k of CHAVES) if (dados[k] != null && dados[k] !== '') o[k] = String(dados[k]).slice(0, 120)
  return `<script>window.dataLayer=window.dataLayer||[];window.dataLayer.push(${JSON.stringify(o).replace(/</g, '\\u003c')});</script>`
}
