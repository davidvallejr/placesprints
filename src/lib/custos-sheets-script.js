// Gerador do Apps Script da planilha de custos (spec custos ERP, seção 8): lê custos-sheets/Codigo.gs e preenche a função
// instalar() com a URL e o segredo do webhook. O texto devolvido CARREGA O SEGREDO: quem chama entrega uma única vez
// (Cache-Control: no-store) e nunca registra em log — este módulo também não registra nada.
import { readFileSync } from 'node:fs'

const MODELO = new URL('./custos-sheets/Codigo.gs', import.meta.url)
const URL_OK = /^https:\/\/[^\s"'`\\]+$/        // \s cobre quebra de linha (inclusive U+2028/2029); sem aspas, crase nem barra invertida
const SEGREDO_OK = /^[0-9a-f]{64}$/
const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })

export function gerarScriptApps({ url, segredo } = {}) {
  if (typeof url !== 'string' || url.length > 2000 || !URL_OK.test(url)) throw erro('URL do webhook inválida: precisa começar com https:// e não ter espaços nem aspas')
  if (typeof segredo !== 'string' || !SEGREDO_OK.test(segredo)) throw erro('segredo do webhook inválido (esperado: 64 caracteres hexadecimais minúsculos)')
  let texto = readFileSync(MODELO, 'utf8')
  for (const [marca, valor] of [["'__WEBHOOK_URL__'", url], ["'__WEBHOOK_SECRET__'", segredo]]) {
    if (texto.split(marca).length !== 2) throw erro(`modelo do Apps Script alterado: ${marca} deveria aparecer uma única vez`, 500)
    texto = texto.replace(marca, () => JSON.stringify(valor))   // função: "$&" e afins dentro da URL não viram padrão de troca
  }
  return texto
}
