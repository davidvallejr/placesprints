// Emissor Focus NFe (F8a) — API REST v2, conferida na doc pública em 15/10/2026 (doc.focusnfe.com.br/reference/*.md + campos.focusnfe.com.br/nfe/NotaFiscalXML.html,
// cópias em scratchpad/v3/f8/). Interface em emissores/sefaz-nativo.js. Nenhuma chamada real nos testes (fetch injetado); a chave nf.ligado nasce DESLIGADA.
// VERIFICADO NA DOC: bases https://homologacao.focusnfe.com.br e https://api.focusnfe.com.br com prefixo /v2; HTTP Basic com o token como usuário e senha vazia;
//   POST /v2/nfe?ref= (201 autorizado síncrono | 202 processando_autorizacao | 422 already_processed/pending_operation/erro_validacao_schema | 400 | 401 | 415);
//   GET /v2/nfe/{ref} (status autorizado|cancelado|erro_autorizacao|processando_autorizacao, status_sefaz, mensagem_sefaz, chave_nfe, numero, serie, caminho_xml_nota_fiscal);
//   DELETE /v2/nfe/{ref} {justificativa} (síncrono; cancelado|erro_cancelamento; até 24 h, algumas UFs mais);
//   POST /v2/nfe/{ref}/carta_correcao {correcao} (síncrono; autorizado|erro_autorizacao; não corrige imposto, emitente/destinatário nem datas);
//   webhooks: gatilho com `authorization` + `authorization_header` (valor enviado no cabeçalho escolhido), reenvio com backoff por até 48 h, depois só GET;
//   PUT /v2/empresas/{id} com arquivo_certificado_base64 + senha_certificado; resposta com certificado_valido_ate.
//   Campos do JSON da nota (nomes da tabela de campos): ver paraFocus().
// NOT_VERIFIED: (1) corpo do webhook = o mesmo JSON do GET (a doc não mostra exemplo); (2) status 'denegado' (fora do enum documentado: tratado como rejeitada);
//   (3) o token da conta Place2u emitir para qualquer CNPJ cadastrado nela × token por empresa (EmpresaResponse traz token_producao/token_homologacao) — por isso
//   cliente_fiscal.token_ref; (4) campos do emitente preenchidos pelo cadastro da empresa na Focus quando só cnpj_emitente vai no corpo;
//   (5) município do destinatário por nome + UF (sem código IBGE); (6) limite de taxa (429).
import { timingSafeEqual, createHash } from 'node:crypto'
import { reais } from '../nota-fiscal.js'

const BASE = { homologacao: 'https://homologacao.focusnfe.com.br', producao: 'https://api.focusnfe.com.br' }
const ESTADO = { autorizado: 'autorizada', processando_autorizacao: 'enviada', erro_autorizacao: 'rejeitada', denegado: 'rejeitada', cancelado: 'cancelada' }
const txt = v => (v == null ? '' : String(v))

// nota canônica (centavos) → JSON da Focus (reais com 2 casas). Só campos documentados; nada que a regra não declarou.
export function paraFocus(nota, { data_emissao }) {
  const d = nota.destinatario || {}, t = nota.totais
  const out = {
    natureza_operacao: nota.natureza_operacao, data_emissao, tipo_documento: 1, finalidade_emissao: 1, local_destino: nota.local_destino,
    consumidor_final: nota.consumidor_final, presenca_comprador: 2, indicador_intermediario: 1, cnpj_intermediario: nota.intermediador.cnpj, id_intermediario: nota.intermediador.id,
    cnpj_emitente: nota.emitente.cnpj, inscricao_estadual_emitente: nota.emitente.ie, regime_tributario_emitente: nota.emitente.crt,
    nome_destinatario: d.nome, [d.doc?.length === 14 ? 'cnpj_destinatario' : 'cpf_destinatario']: d.doc, indicador_inscricao_estadual_destinatario: d.indicador_ie,
    logradouro_destinatario: d.logradouro, numero_destinatario: d.numero, ...(d.complemento ? { complemento_destinatario: d.complemento } : {}), bairro_destinatario: d.bairro,
    municipio_destinatario: d.municipio, uf_destinatario: d.uf, cep_destinatario: d.cep, pais_destinatario: 'Brasil',
    valor_produtos: reais(t.produtos_c), valor_desconto: reais(t.desconto_c), valor_frete: reais(t.frete_c), valor_total: reais(t.nota_c), modalidade_frete: nota.modalidade_frete,
    items: nota.itens.map(i => ({
      numero_item: i.n_item, codigo_produto: i.sku, descricao: i.descricao, cfop: i.cfop, codigo_ncm: i.ncm, ...(i.cest ? { cest: i.cest } : {}),
      unidade_comercial: i.unidade, unidade_tributavel: i.unidade, quantidade_comercial: i.quantidade, quantidade_tributavel: i.quantidade,
      valor_unitario_comercial: reais(i.valor_unit_c), valor_unitario_tributavel: reais(i.valor_unit_c), valor_bruto: reais(i.valor_bruto_c),
      ...(i.frete_c ? { valor_frete: reais(i.frete_c) } : {}), inclui_no_total: 1, icms_origem: i.origem, icms_situacao_tributaria: i.cst_csosn,
      ...(i.icms_valor_c != null ? { icms_modalidade_base_calculo: 3, icms_base_calculo: reais(i.icms_base_c), icms_aliquota: i.icms_aliquota, icms_valor: reais(i.icms_valor_c),
        ...(i.icms_reducao_bc != null ? { icms_reducao_base_calculo: i.icms_reducao_bc } : {}) } : {}),
      pis_situacao_tributaria: i.pis_cst, ...(i.pis_valor_c != null ? { pis_base_calculo: reais(i.pis_base_c), pis_aliquota_porcentual: i.pis_aliquota, pis_valor: reais(i.pis_valor_c) } : {}),
      cofins_situacao_tributaria: i.cofins_cst, ...(i.cofins_valor_c != null ? { cofins_base_calculo: reais(i.cofins_base_c), cofins_aliquota_porcentual: i.cofins_aliquota, cofins_valor: reais(i.cofins_valor_c) } : {}),
    })),
    formas_pagamento: nota.pagamentos.map(p => ({ forma_pagamento: p.forma, valor_pagamento: reais(p.valor_c),
      ...(p.tipo_integracao ? { tipo_integracao: p.tipo_integracao, cnpj_credenciadora: p.cnpj_credenciadora, bandeira_operadora: p.bandeira, numero_autorizacao: p.autorizacao } : {}) })),
  }
  return out
}

// resposta da Focus → resultado da interface (só campos fiscais; nada do comprador volta daqui)
export function mapear(j, status) {
  const estado = ESTADO[j?.status] || 'erro'
  return { estado, status_sefaz: txt(j?.status_sefaz), mensagem: txt(j?.mensagem_sefaz || j?.mensagem).slice(0, 300), chave: txt(j?.chave_nfe).replace(/^NFe/, ''),
    numero: txt(j?.numero), serie: txt(j?.serie), caminho_xml: txt(j?.caminho_xml_nota_fiscal), codigo: txt(j?.codigo), ref: txt(j?.ref), http: status || 0 }
}

// fetch injetado (testes: stub). segredoWebhook: valor esperado no cabeçalho do gatilho; cabecalhoWebhook: nome do cabeçalho (padrão authorization)
export function criarFocus({ fetch = globalThis.fetch, segredoWebhook = () => '', cabecalhoWebhook = 'authorization', timeoutMs = 30000 } = {}) {
  async function chamar(metodo, caminho, { ambiente, token }, corpo) {
    if (!BASE[ambiente]) throw Object.assign(new Error('ambiente inválido'), { status: 400 })
    if (!token) return { status: 0, j: { codigo: 'sem_token' } }
    let r
    try {
      r = await fetch(BASE[ambiente] + caminho, { method: metodo, signal: AbortSignal.timeout(timeoutMs),
        headers: { Authorization: 'Basic ' + Buffer.from(`${token}:`).toString('base64'), ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
        ...(corpo ? { body: JSON.stringify(corpo) } : {}) })
    } catch { return { status: 0, j: { codigo: 'rede' } } }                      // rede/timeout = incerto: a consulta decide, nunca reenvio às cegas
    const texto = await r.text().catch(() => '')
    let j = {}; try { j = texto ? JSON.parse(texto) : {} } catch { j = { codigo: 'resposta_nao_json' } }
    return { status: r.status, j, texto }
  }
  const ref = r => encodeURIComponent(r)
  return {
    nome: 'focus',
    async emitir(nota, o) {
      if (!o?.token) return { ...mapear({}, 0), codigo: 'sem_token' }
      const { status, j } = await chamar('POST', `/v2/nfe?ref=${ref(o.ref)}`, o, paraFocus(nota, o))
      if (status === 201 || status === 202) return mapear(j, status)
      if (status === 422 && ['already_processed', 'pending_operation'].includes(j.codigo)) return { ...mapear({}, status), estado: 'enviada', codigo: j.codigo }   // já existe: a consulta traz o estado real
      return { ...mapear(j, status), estado: status === 400 || status === 422 || status === 415 ? 'rejeitada' : 'erro', erros: (Array.isArray(j.erros) ? j.erros : []).slice(0, 20).map(e => ({ campo: txt(e.campo).slice(0, 60), mensagem: txt(e.mensagem).slice(0, 200) })) }
    },
    async consultar(r, o) { const { status, j } = await chamar('GET', `/v2/nfe/${ref(r)}`, o); return status === 200 ? mapear(j, status) : { ...mapear(j, status), estado: 'erro' } },
    async cancelar(r, justificativa, o) {
      const { status, j } = await chamar('DELETE', `/v2/nfe/${ref(r)}`, o, { justificativa })
      return { estado: j.status === 'cancelado' ? 'cancelada' : 'erro', status_sefaz: txt(j.status_sefaz), mensagem: txt(j.mensagem_sefaz || j.mensagem).slice(0, 300), http: status }
    },
    async cartaCorrecao(r, correcao, o) {
      const { status, j } = await chamar('POST', `/v2/nfe/${ref(r)}/carta_correcao`, o, { correcao })
      return { estado: j.status === 'autorizado' ? 'autorizada' : 'erro', status_sefaz: txt(j.status_sefaz), numero_carta: txt(j.numero_carta_correcao), mensagem: txt(j.mensagem_sefaz || j.mensagem).slice(0, 300), http: status }
    },
    async baixar(caminho, o) {
      if (!/^\/arquivos\/[\w./-]+\.xml$/.test(String(caminho)) || String(caminho).includes('..')) throw Object.assign(new Error('caminho do XML inválido'), { status: 400 })
      const { status, texto } = await chamar('GET', caminho, o)
      if (status !== 200 || !String(texto || '').trimStart().startsWith('<')) throw Object.assign(new Error('XML não baixado'), { status: 502 })
      return texto
    },
    webhook(headers, corpo) {
      const esperado = String(segredoWebhook() || ''), veio = String(headers?.[cabecalhoWebhook] || '')
      const h = s => createHash('sha256').update(s).digest()                    // compara digests: tamanho fixo, sem vazar o comprimento
      if (!esperado || !timingSafeEqual(h(esperado), h(veio))) throw Object.assign(new Error('não autorizado'), { status: 401 })
      const r = mapear(corpo, 200)
      if (!r.ref) throw Object.assign(new Error('notificação sem referência'), { status: 400 })
      return r
    },
    async cadastrarCertificado({ empresa_id, base64, senha }, o) {
      const { status, j } = await chamar('PUT', `/v2/empresas/${encodeURIComponent(empresa_id)}`, o, { arquivo_certificado_base64: base64, senha_certificado: senha })
      if (status !== 200) return { ok: false, http: status, codigo: txt(j.codigo) }
      return { ok: true, certificado_valido_ate: txt(j.certificado_valido_ate).slice(0, 10) }
    },
  }
}
