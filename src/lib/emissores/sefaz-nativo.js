// Emissor NATIVO SEFAZ (F8c, docs/desenho-v3-erp.md § B.3) — só o esqueleto atrás da MESMA interface do Focus. Nada implementado de propósito:
// XML 4.00, assinatura XML-DSig com o A1 (lido de arquivo cifrado FORA de data/, senha só em memória), SOAP por autorizador de UF, SVC-AN/SVC-RS em contingência,
// NFeAutorizacao4/NFeRetAutorizacao4, eventos 110111 (cancelamento) e 110110 (carta de correção), schemas XSD. Pronto quando 100 notas de homologação saírem
// idênticas às do provedor (diff do XML).
//
// Interface do emissor (a mesma em emissores/focus-nfe.js; nota-fiscal-real.js só conhece estes nomes):
//   emitir(nota, { ref, ambiente, token, data_emissao }) → { estado: 'enviada'|'autorizada'|'rejeitada'|'erro', status_sefaz?, mensagem?, chave?, numero?, serie?, caminho_xml?, codigo? }
//   consultar(ref, { ambiente, token })                 → idem (+ 'cancelada')
//   cancelar(ref, justificativa, { ambiente, token })    → { estado: 'cancelada'|'erro', status_sefaz?, mensagem? }
//   cartaCorrecao(ref, correcao, { ambiente, token })    → { estado: 'autorizada'|'erro', numero_carta?, status_sefaz? }
//   baixar(caminho, { ambiente, token })                 → texto (XML autorizado)
//   webhook(headers, corpo)                              → resultado como o de consultar(), com `ref`; assinatura inválida lança { status: 401 }
//   cadastrarCertificado({ empresa_id, base64, senha }, { ambiente, token }) → { certificado_valido_ate }
const nao = () => { throw Object.assign(new Error('emissor nativo SEFAZ não implementado (F8c)'), { code: 'NAO_IMPLEMENTADO', status: 501 }) }
export const criarSefazNativo = () => ({ nome: 'sefaz', emitir: nao, consultar: nao, cancelar: nao, cartaCorrecao: nao, baixar: nao, webhook: nao, cadastrarCertificado: nao })
