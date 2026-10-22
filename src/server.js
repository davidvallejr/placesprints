import express from 'express'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync } from 'node:fs'
import { env, ROOT } from './lib/env.js'
import { db, getEstado, setEstado, log, hojeLocal, agora } from './lib/db.js'
import { compilarSQL, expandir, desserializar } from './lib/filtros.js'
import { carregarClientes, normNome, lideresEConsultores, validarLiderOuConsultor, clientesElegiveis, equipeCfg } from './lib/equipe.js'
import { notionReq } from './lib/notion.js'
import { mapeamento } from './lib/extrair.js'
import { playbook } from './lib/plano-cliente.js'
import { criarDependencias } from './lib/dependencia-cliente.js'
import { criarRotasDependencia } from './rotas-dependencia.js'
import { criarRelatorioEnvio, lerConfig as lerConfigRelatorio } from './lib/relatorio-envio.js'
import { criarRotasRelatorio } from './rotas-relatorio.js'
import { criarCatalogo } from './lib/catalogo-db.js'
import { criarRotasCatalogo } from './rotas-catalogo.js'
import { alinhamentosReal } from './lib/alinhamentos-real.js'
import { criarRotasAlinhamentos } from './rotas-alinhamentos.js'
import { criarRotasPendencias } from './rotas-pendencias.js'
import { criarRotasAbaDoCliente } from './rotas-aba-do-cliente.js'
import { criarAbaDoClienteReal } from './lib/aba-do-cliente-real.js'
import { pendenciasReal } from './lib/pendencias-cliente-real.js'
import { briefReal, nomesInternos as nomesInternosRelatorio } from './lib/relatorio-brief-real.js'
import { criarAlertaReal } from './lib/alerta-cliente-real.js'
import { criarRotasAlertas } from './rotas-alertas.js'
import { criarGatilhosReal } from './lib/gatilhos-real.js'
import { comprasDoCliente } from './lib/gatilhos-real.js'
import { criarRotasCompras, criarRotasConcorrencia } from './rotas-compras.js'
import { criarConcorrencia } from './lib/concorrencia.js'
import { criarLeadTime } from './lib/lead-time.js'
import { algoritmo, diagnosticarConta } from './lib/diagnostico-conta.js'
import { criarRotasProdutos } from './rotas-produtos.js'
import { produtosDoCliente, mapeamentoDoCliente, criarVinculoProduto, criarEstoqueDeclarado, upsDosProdutos, estoqueRestanteHoje, lerEstoqueUps, upsParaLer, kitsDoCliente, criarKit, lerKitsVirtuais } from './lib/produto-estoque-real.js'
import { dreDoCliente, coletarFinanceiro, semanticaTarifa } from './lib/lucro-real.js'
import { criarRotasRelatoriosCiclo } from './rotas-relatorios-ciclo.js'
import { relatorioDoCliente, criarErp } from './lib/relatorios-ciclo-real.js'
import { criarRotasGuardiao } from './rotas-guardiao.js'
import { raioXDoCliente, pautaDoCliente, criarGuardiao } from './lib/guardiao-real.js'
import { FONTES as FONTES_ED, CSS as CSS_ED, capa as capaEd } from './lib/estilo-editorial.js'
import { gerarPdf as gerarPdfChrome } from './lib/relatorio-pdf.js'
import { criarRotasGatilhos, criarRotasGatilhosHmac } from './rotas-gatilhos.js'
import { criarRotasConsultor } from './rotas-gatilhos.js'
import { criarRespostasReal } from './lib/respostas-relatorio-real.js'
import { criarRotasFeedback, criarRotasPerfilInformacao } from './rotas-feedback.js'
import { perfilInformacaoReal } from './lib/perfil-informacao-real.js'
import { criarRotasDossie, uploadJson, ROTAS_UPLOAD } from './rotas-dossie.js'
import { criarRotasNotaFiscal, criarRotaWebhookNota, ROTA_CERTIFICADO, certificadoJson } from './rotas-nota-fiscal.js'
import { criarNotaFiscal, lerPedidosMl, anexarXmlMl } from './lib/nota-fiscal-real.js'
import { criarFocus } from './lib/emissores/focus-nfe.js'
import { criarSefazNativo } from './lib/emissores/sefaz-nativo.js'
import { chamar as chamarMlNota } from './lib/meli-api.js'
import { tokenValido as tokenValidoNota } from './lib/meli-contas.js'
import { livroReal, riscoReal, contratosReal, quemDossie, ingerirLivro, validarDossie } from './lib/livro-registro-real.js'
import { dossiesReal } from './lib/dossie-real.js'
import { criarConsultorDiscordReal } from './lib/consultor-discord.js'
import { criarRotasCadastro } from './rotas-cadastro.js'
import * as cadastroClientes from './lib/cadastro-clientes.js'
import { notionCliente } from './lib/notion-cliente-real.js'
import { criarRotasNotionCliente } from './rotas-notion-cliente.js'
import { descobrirFontes } from './lib/descobrir.js'
import { resolverPaginaCliente, acharInformacoesDb, invalidarCliente } from './lib/plano-informacoes.js'
import {
  opcoesFiltros, calcularKpis, listarTarefas, graficoStatus, graficoProcessos,
  graficoBurnup, graficoSemanas, riscos, ordemSprints,
} from './lib/metricas.js'
import { montarRelatorio } from './lib/relatorio.js'
import { renderRelatorio } from './lib/render-relatorio.js'
import { montarSemanal } from './lib/semanal.js'
import { renderSemanal } from './lib/render-semanal.js'
import { workloadAnalista } from './lib/analista.js'
import { renderMatrizAnalista } from './lib/render-matriz-analista.js'
import { sincronizar } from './lib/sync.js'
import { rotasPlanos } from './rotas-planos.js'
import { rotasProfissionais } from './rotas-profissionais.js'
import { opcoesSemanal } from './rotas-perfil.js'
import { listarPerfis, coletaPromocoesDoCliente } from './lib/perfil-cliente.js'
import { rotasPromocoes, depsPromocoes } from './rotas-promocoes.js'
import { urlAutorizacao, trocarCodigo, buscarPerfil, revogarAutorizacao } from './lib/meli-oauth.js'
import { empacotarState, desempacotarState, validar as validarLinkMeli } from './lib/meli-link.js'
import { salvarConexao, listarConexoes, listarConexoesColeta, outraConexaoDoApp, desconectar as desconectarMeli, statusConexao, backupConexoes, restaurarConexoes, recuperarPendentes, aguardarRenovacoes } from './lib/meli-contas.js'
import { notificar } from './lib/notificacoes.js'
import { voz } from './lib/sistemas.js'
// logs principais com o sistema de origem (config/sistemas.json): «[info] Trinity · coleta diária ML ok — Acme»
const logS = (sistema, nivel, msg) => log(nivel, voz(sistema, msg))
import { paginaOk as meliPaginaOk, paginaErro as meliPaginaErro } from './lib/meli-paginas.js'
import { guardaLocal } from './lib/guarda-local.js'
import { rotasPublicas } from './rotas-publicas.js'
import { rotasSprint90, s90 as s90lib, hostS90Publico } from './rotas-sprint90.js'
import { ehChaveS90 } from './lib/s90-chave.js'
import { prospectoPorChave, ehChaveProspecto, coletaEmCurso, lerReputacaoProspecto } from './lib/comercial.js'
import { rotasWebhookCustos, configurarLog as configurarLogWebhookCustos } from './lib/custos-webhook.js'
import { configurarLog as configurarLogCustos, aplicarLote, vinculosCusto, getCfgCustos, chaveSku } from './lib/custos-db.js'
import { criarUploadCustos } from './lib/custos-upload.js'
import { criarRotasCustosUpload } from './rotas-custos-upload.js'
import { tickCustos, processarFila, configurarLog as configurarLogSyncErp } from './lib/erp-sync.js'
import { sanitizar as sanitizarErp } from './lib/erp-http.js'
import { tratarCallbackErp } from './lib/erp-credenciais.js'
import { rotasCustos } from './rotas-custos.js'
import { rotasOfertas } from './rotas-ofertas.js'
import { rotasChaveiro } from './rotas-chaveiro.js'
import { criarRotasChaveiroEstoque } from './rotas-chaveiro-estoque.js'
import * as syncEstoque from './lib/chaveiro-estoque-real.js'
import { criarRotasChaveiroExecutor } from './rotas-chaveiro-executor.js'
import * as execChaveiro from './lib/chaveiro-executor-real.js'
import { rotasHistorico } from './rotas-historico.js'
import { rotasSaude } from './rotas-saude.js'
import { criarSaudeSistema } from './lib/saude-sistema-real.js'
import { criarRotasSaudeSistema } from './rotas-saude-sistema.js'
import { criarRotasAjuda } from './rotas-ajuda.js'
import { criarRotasEstrutura } from './rotas-estrutura.js'
import { contextoReal as contextoEstrutura, estruturaReal, equipeReal } from './lib/estrutura-estado-real.js'
import { criarRotasProgresso } from './rotas-progresso.js'
import { criarProgressoReal } from './lib/progresso-real.js'
import { criarRotasFila } from './rotas-fila.js'
import { criarFilaReal } from './lib/fila-real.js'
import { criarEnvio as criarEnvioSaude } from './lib/gatilhos-envio.js'

configurarLogCustos(log); configurarLogWebhookCustos(log); configurarLogSyncErp(log)   // custos de ERP/planilha logam no mesmo log (nunca corpo/segredo)
const app = express()
app.disable('x-powered-by')   // não anuncia o framework nos hosts públicos (sprint90, comercial, ML)
app.use(guardaLocal)      // Host loopback + Origin de mutação == host:porta do próprio painel (src/lib/guarda-local.js)
// nenhuma tela pode ser emoldurada por outro site (clickjacking do "Cancelar a conta" em /integracoes); as páginas /c/* sobrescrevem com DENY + CSP própria
app.use((req, res, next) => { res.set({ 'X-Frame-Options': 'SAMEORIGIN', 'Content-Security-Policy': "frame-ancestors 'self'" }); next() })
app.use('/webhook/custos', rotasWebhookCustos)   // ANTES do express.json: o HMAC é sobre os bytes crus (src/lib/custos-webhook.js)
// corpo comprimido (gzip ~1 KB que infla para 1 MB) seria inflado e parseado ANTES da sessão/limite de qualquer rota pública (DoS barato): 415 sem inflar —
// nenhum navegador comprime pedido. Equivale a json({ inflate: false }) sem mudar a linha abaixo (outras frentes a localizam pelo texto).
app.use((req, res, next) => /^(identity)?$/i.test(String(req.headers['content-encoding'] || '').trim()) ? next() : res.status(415).json({ erro: 'corpo comprimido não é aceito' }))
// Gatilhos ao cliente (docs/desenho-gatilhos-n8n.md): chave «gatilhos_ligado» NASCE DESLIGADA; recibo e lote diário do n8n chegam com HMAC sobre o corpo cru — ANTES do express.json
const gatilhos = criarGatilhosReal({ clienteCanonico: nome => carregarClientes().find(c => normNome(c.cliente).trim() === normNome(nome).trim())?.cliente || '' })
// Aviso INTERNO ao time no canal do cliente no Discord («Webhook ML»; o cliente não está lá): resumo semanal TERÇA 08:30 (urgente interno desligado por config); chave
// «consultor_discord_ligado» NASCE DESLIGADA; todo cliente Ativo com integração ML de fato e «Webhook ML» (independe do WhatsApp do cliente); nada antes de inicio_envios.
// Mesmo webhook do n8n; o recibo chega pela rota de recibo dos gatilhos.
const consultor = await criarConsultorDiscordReal({ gatilhos })
app.use(criarRotasGatilhosHmac({ gatilhos, consultor, secret: () => env.PLACE_GATILHOS_SECRET, janelaS: gatilhos.config.webhook.janela_s, log }))
app.use(ROTAS_UPLOAD, uploadJson)   // contrato/pagamento com arquivo ≤ 5 MB em base64 (limite próprio de 7 MB) — ANTES do parser global de 1 MB, que passa a não fazer nada nessas duas rotas
// V3 F8 — Nota fiscal (docs/desenho-v3-erp.md § B; config/nota-fiscal.json): chaves nf.ligado / nf.envio_ml_ligado / nf.producao_ligada NASCEM DESLIGADAS.
// Regras fiscais só do contador do cliente (sem regra, sem nota); certificado A1 só no provedor (cliente_fiscal guarda a referência); webhook público exato com cabeçalho do gatilho.
const cfgNota = JSON.parse(readFileSync(join(ROOT, 'config', 'nota-fiscal.json'), 'utf-8'))
const notaFiscal = criarNotaFiscal({ handle: db, cfg: cfgNota, agora, validarPor: validarLiderOuConsultor, dirXml: join(ROOT, 'data', 'nf'), raizDados: join(ROOT, 'data'),
  emissores: { focus: criarFocus({ segredoWebhook: () => process.env.FOCUS_WEBHOOK_SECRET || '' }), sefaz: criarSefazNativo() },
  ml: { lerPedido: (c, ids) => (cfgNota.nf.ligado === true ? lerPedidosMl(chamarMlNota, c, ids) : null),          // billing info: permissão «Faturamento» do app ainda NOT_VERIFIED
    anexar: async (c, a) => anexarXmlMl({ token: await tokenValidoNota(c), ...a }) },
  termoTexto: readFileSync(join(ROOT, cfgNota.termo.arquivo), 'utf-8'), log })
app.use(criarRotaWebhookNota({ nf: notaFiscal, log }))
app.use(ROTA_CERTIFICADO, certificadoJson)   // certificado A1 em base64 ≤ 5 MB (vai ao provedor; nunca gravado) — ANTES do parser global de 1 MB
app.use(express.json({ limit: '1mb' }))
app.use(rotasPublicas)     // /diagnostico + /d/:token — o túnel só alcança pelo host COMERCIAL_PUBLIC_HOST
app.use(rotasSprint90)     // Place Sprint 90: /c/* (painel do cliente, host SPRINT90_PUBLIC_HOST) + /api/sprint90/* (equipe, loopback); sem a env nada existe — ANTES do estático
app.use(rotasPlanos)
app.use(rotasProfissionais)   // melhor profissional para a tarefa (Merovíngio por pessoa × família)
app.use(rotasPromocoes)
app.use(rotasCustos)      // /api/custos/* (gestão; não é rota pública: o túnel recebe 403)
app.use(rotasOfertas)     // /api/ofertas/* (Ofertas Estratégicas por cliente: importar, estratégia, aprovação, publicação, conferência)
app.use(rotasHistorico)   // GET /api/cliente/anuncio/historico + POST /api/cliente/anuncio/snapshot ("Como era" do anúncio; só leitura do ML)
app.use(rotasChaveiro)    // GET /api/cliente/execucao (cobertura do plano por caminho: automático/assistido/cliente/sem caminho; só leitura)
// V3 F6: sincronismo de estoque do Chaveiro — prévia/preparar/executar/conferir/liberar/parar; a escrita no ML só passa pelas travas de chaveiro-estoque.js (chave sync_estoque_ligado NASCE false)
app.use(criarRotasChaveiroEstoque({ sync: syncEstoque, clienteCanonico: c => clienteDaCentral(c), validarPor: (n, c) => validarDossie(n, c) }))
// Chaveiro F4+: console de execução (prévia/preparar/aprovar/executar/conferir/reverter/liberar/parar); escrita no ML só por executarOrdem, atrás de execucao_ligada + adaptadores_live (NASCEM false) + liberação + estreia
app.use(criarRotasChaveiroExecutor({ exec: execChaveiro, clienteCanonico: c => clienteDaCentral(c), validarPor: (n, c) => validarDossie(n, c) }))
// autogestão (docs/plano-autogestao.md A2/A3/A5): sinais por sistema + incidentes (dono Head de canais) + data/batimento.json p/ o vigia externo; GET /api/saude só no loopback
const saudeSis = criarSaudeSistema({ handle: db, getEstado, agora, log, notificar, envio: criarEnvioSaude({ env: process.env, log }) })
app.use(criarRotasSaudeSistema({ saude: saudeSis }))
app.use(criarRotasAjuda({ contexto: () => contextoEstrutura({ saude: saudeSis }) }))   // ícone (i) «Como fazer»: texto de config/ajuda.json + estado real (F3)
app.use(criarRotasEstrutura({ estrutura: () => estruturaReal({ saude: saudeSis }), equipe: equipeReal }))   // tela de Estruturas (F3): só leitura; Ligar/Desligar reusa as rotas de banco que já existem
app.use(rotasSaude)       // GET /api/cliente/saude + POST /api/cliente/saude/atualizar (saúde da conta gravada: reputação, perguntas, reclamações, atrasos, Full; só leitura no ML)
// encerramento por dependência do cliente (prévia por padrão; confirmar:true grava "Aguardando Devolutiva do Cliente" no Notion + registro local)
const dependencias = criarDependencias({ handle: db, notion: { req: notionReq }, agora, hoje: hojeLocal, validarPor: validarLiderOuConsultor, mapeamento,
  limiares: { atencao: playbook.limiares.dependencia_atencao_dias, revisar: playbook.limiares.dias_parada } })
app.use(criarRotasDependencia({ dependencias, quem: lideresEConsultores }))
// Relatório de Sprints ao Notion do cliente (prévia por padrão; confirmar:true escreve; agendador nasce DESLIGADO e só envia a quem um líder liberou)
const clienteDaCentral = nome => carregarClientes().find(c => normNome(c.cliente).trim() === normNome(nome).trim())?.cliente || ''   // prospect "[Comercial] …" não está na central
const relatorios = criarRelatorioEnvio({ handle: db, notion: { req: notionReq }, brief: briefReal, nomesInternos: nomesInternosRelatorio,
  destinos: { fontes: descobrirFontes, resolverPaginaCliente, acharInformacoesDb, invalidar: invalidarCliente },
  agora, validarPor: validarLiderOuConsultor, notificar, log: (n, m) => logS('morpheus', n, m), elegiveis: () => clientesElegiveis().elegiveis,
  clienteCanonico: clienteDaCentral, cfg: lerConfigRelatorio(), mapeamento,
  // plano B (tarefa no quadro): quem é «Pamela» = usuário do Notion pelo nome (config/equipe.json → usuarios_notion primeiro, depois os colhidos dos quadros)
  usuarios: () => [...Object.entries(equipeCfg.usuarios_notion || {}).filter(([k]) => k !== '$comentario').map(([nome, id]) => ({ id, nome })), ...db.prepare('SELECT id, nome FROM usuarios_notion').all()] })
app.use(criarRotasRelatorio({ relatorios, quem: lideresEConsultores, clienteCanonico: clienteDaCentral }))
app.use(criarRotasProgresso({ progresso: criarProgressoReal({ relatorios }), clienteCanonico: clienteDaCentral }))   // progresso do processo, 10 etapas (F4): só leitura sobre números que já existem
app.use(criarRotasFila({ fila: criarFilaReal({ estrutura: () => estruturaReal({ saude: saudeSis }), progresso: criarProgressoReal({ relatorios }), aba: criarAbaDoClienteReal({ rotulo: c => gatilhos.rotulo(c) }) }) }))   // Hoje (F5): fila do dia por papel, só leitura; cada botão reusa uma rota de escrita que já existia
app.use(criarRotasCatalogo({ catalogo: criarCatalogo(db, { agora, validarPor: validarLiderOuConsultor, log }), quem: lideresEConsultores, clienteCanonico: clienteDaCentral }))   // catálogo próprio × terceiros (marcação manual; prévia por padrão)
// alinhamentos: a central também gerencia (lista, encerra, renova) os da conta do Sprint 90 — chave "[S90] …" válida de uma conta existente (nunca entra em clientes_central)
const clienteOuS90 = nome => clienteDaCentral(nome) || (ehChaveS90(nome) && db.prepare('SELECT 1 FROM s90_conta WHERE chave = ?').get(String(nome)) ? String(nome) : '')
app.use(criarRotasAlinhamentos({ alinhamentos: alinhamentosReal(), quem: lideresEConsultores, clienteCanonico: clienteOuS90,
  anuncios: c => db.prepare('SELECT item_id AS id, titulo FROM meli_item WHERE cliente = ? ORDER BY titulo LIMIT 2000').all(c) }))   // alinhamentos com o cliente (exceções intencionais; prévia por padrão, confirmar:true grava)
// Pendências do cliente por canal (catálogo + avaliador único + registro manual; prévia por padrão, confirmar:true grava): config/dependencias-cliente.json
app.use(criarRotasPendencias({ pendencias: pendenciasReal(), quem: lideresEConsultores, clienteCanonico: clienteDaCentral }))
// aba «Do cliente» do /cliente: junta pendências, ações do plano com caminho cliente, compras do dia, tarefas em dependência e avisos (só leitura; marcar = prévia + confirmar; lembrete só prepara)
app.use(criarRotasAbaDoCliente({ aba: criarAbaDoClienteReal({ rotulo: c => gatilhos.rotulo(c) }), clienteCanonico: clienteDaCentral }))
// Alerta de pendência CRÍTICA do cliente: aviso interno com som (sempre) + página de alerta no Notion do cliente (interruptor «alerta_auto», NASCE DESLIGADO; prévia → confirmar no manual)
const alertas = criarAlertaReal({ clienteCanonico: clienteDaCentral })
app.use(criarRotasAlertas({ alertas, quem: lideresEConsultores, clienteCanonico: clienteDaCentral }))
// Gatilhos ao cliente (prévia, envio manual com confirmar:true por líder, liberação, chave, configuração de canais por cliente, teste de canal; nada sai sem liberação + chave)
app.use(criarRotasGatilhos({ gatilhos, quem: lideresEConsultores, clienteCanonico: clienteDaCentral }))
app.use(criarRotasConsultor({ consultor, clienteCanonico: clienteDaCentral }))   // aviso interno ao consultor no Discord: estado, prévia do resumo semanal, chave própria
// Respostas dos clientes ao relatório (só as que respondem às NOSSAS mensagens nos grupos ML; coleta pelo n8n, mesma assinatura dos gatilhos): docs/respostas-relatorio.md
const respostas = criarRespostasReal()
app.use(criarRotasFeedback({ respostas, quem: lideresEConsultores, clienteCanonico: clienteDaCentral }))
// Perfil de informação: o que cada cliente quer receber no relatório (temas em ordem, nível, serviço) + matriz da carteira; sugestão derivada das respostas, nunca grava
app.use(criarRotasPerfilInformacao({ perfis: perfilInformacaoReal(), quem: quemDossie, clienteCanonico: clienteDaCentral }))
// Prazo de reposição (lead time) informado + previsão de compras (Algoritmo v1.6.0): o prazo informado vence a premissa no ponto de reposição; a previsão é só leitura
const leadTimeCli = criarLeadTime(db, { agora, validarPor: validarDossie, anuncios: c => ({ itens: db.prepare('SELECT item_id FROM meli_item WHERE cliente = ?').all(c).map(r => r.item_id),
    skus: (() => { try { return db.prepare("SELECT DISTINCT sku FROM promo_anuncio WHERE cliente = ? AND sku != ''").all(c).map(r => r.sku) } catch { return [] } })() }) })
app.use(criarRotasCompras({ leadTime: leadTimeCli, compras: c => comprasDoCliente(c), quem: quemDossie, clienteCanonico: clienteDaCentral,
  premissa: { dias: algoritmo.limiares.lead_time_reposicao_dias, seguranca_dias: algoritmo.limiares.estoque_seguranca_dias } }))
// Produto por trás do anúncio (V3 F2, SOMBRA): aba Produtos «por anúncio × por produto», gaveta de mapeamento (vínculo manual/recusa com prévia + confirmar) e leitura
// do estoque por local (GET /stock, teto por dia); nada muda plano, aviso ou texto ao cliente (produto.diagnostico_ligado = false). docs/desenho-v3-produto-estoque-financeiro.md
app.use(criarRotasProdutos({ produtos: c => produtosDoCliente(c, diagnosticarConta(c), { cfg: algoritmo }), mapeamento: mapeamentoDoCliente,
  vinculos: criarVinculoProduto({ agora, validarPor: validarDossie }), estoqueFisico: criarEstoqueDeclarado({ agora, validarPor: validarDossie }), quem: quemDossie, clienteCanonico: clienteDaCentral,   // V3 F3: estoque físico declarado (modo «declarado»)
  kits: { listar: kitsDoCliente, salvar: criarKit({ agora, validarPor: validarDossie }).salvar },   // V3 F5: composição de kit (modo obrigatório, prévia → confirmar)
  estoque: { ups: upsDosProdutos, restante: c => estoqueRestanteHoje(c), ler: (c, ups) => lerEstoqueUps(c, { ups }), validarPor: validarDossie },
  dre: (c, mes) => dreDoCliente(c, mes), mesAtual: () => hojeLocal().slice(0, 7) }))   // V3 F4: DRE simples do mês (visão Lucro da aba Produtos), só leitura
// Concorrentes por anúncio cadastrados pelo consultor (bloco 🆚 do relatório personalizado; o anúncio precisa ser do cliente): prévia por padrão, confirmar:true grava
app.use(criarRotasConcorrencia({ concorrencia: criarConcorrencia(db, { agora, hoje: hojeLocal, validarPor: validarDossie,
  anuncioDoCliente: (c, id) => !!db.prepare('SELECT 1 FROM meli_item WHERE cliente = ? AND item_id = ?').get(c, id) }), quem: quemDossie, clienteCanonico: clienteDaCentral }))
// Livro de registro (fatos imutáveis e encadeados por cliente), cliente em risco (marcação por líder/consultor/CS + sinais só sugeridos) e contrato/pagamentos:
// base da Prestação de contas e do Dossiê de defesa. Prévia por padrão; confirmar:true grava e registra no livro.
// + Prestação de contas / Dossiê de defesa (Etapa 2): geração sob demanda (PDF + Word) guardada em data/dossies, download só no loopback, versão cliente ao Notion com confirmar:true
app.use(criarRotasDossie({ livro: livroReal(), risco: riscoReal(), contratos: contratosReal(), dossies: dossiesReal(), quem: quemDossie, clienteCanonico: clienteDaCentral }))
app.use(criarRotasNotaFiscal({ nf: notaFiscal, quem: lideresEConsultores, clienteCanonico: clienteDaCentral }))   // V3 F8: nota fiscal (prévia por padrão; aprovação líder/consultor; emissão só com nf.ligado)
// V3 F9: os 8 relatórios (ciclo financeiro, compras, estoque, logística, escalabilidade, lucro, caixa, reinvestimento) — Previsão · Chance · Medido, CSV/HTML/PDF; razão de estoque e
// pedidos ao fornecedor (prévia por padrão; confirmar:true grava). Só leitura no ML; nada muda plano, aviso ou texto ao cliente. docs/desenho-v3-erp.md § «F9 CONSTRUÍDA»
app.use(criarRotasRelatoriosCiclo({ relatorio: (c, nome) => relatorioDoCliente(c, nome), erp: criarErp({ agora, validarPor: validarDossie }), estilo: { FONTES: FONTES_ED, CSS: CSS_ED, capa: capaEd },
  gerarPdf: (html, destino) => gerarPdfChrome(html, destino), clienteCanonico: clienteDaCentral }))
// Planilha de custos subida na tela (/cliente › Configurar): prévia = a gravação desfeita; confirmar:true grava pela porta única aplicarLote (fonte 'upload'),
// vínculos pela resolução única de custo-vinculo, livro (resumo + hash; o arquivo fica em data/custos-upload/<hash do cliente>/). docs/integracao-custos-erp.md § «Subir planilha»
app.use(criarRotasCustosUpload({ clienteCanonico: clienteDaCentral, upload: criarUploadCustos({ handle: db, nucleo: { aplicarLote, vinculosCusto, getCfgCustos, chaveSku }, dir: join(ROOT, 'data', 'custos-upload'),
  validarPor: validarDossie, agora, livro: livroReal(), leadTime: leadTimeCli,
  curvas: c => new Map((diagnosticarConta(c).itens || []).map(i => [i.id ?? i.item_id, i.curva])),
  // tarifa conhecida = a última venda paga do anúncio (sale_fee, 90 d) na semântica conciliada (por unidade × por linha); sem venda = «—»
  tarifas: c => { const pu = semanticaTarifa(c).por_unidade, m = new Map()
    for (const r of db.prepare("SELECT item_id, tarifa_c, quantidade FROM meli_pedido_item WHERE cliente = ? AND status = 'paid' AND tarifa_c IS NOT NULL AND dia >= date('now','-90 day') ORDER BY dia").all(c)) m.set(r.item_id, Math.round(pu ? r.tarifa_c : r.tarifa_c / r.quantidade) / 100)
    return m },
  recalcular: c => { const d = diagnosticarConta(c), it = d.itens || [], ab = it.filter(i => ['A', 'B'].includes(i.curva))
    return { recalculado: true, anuncios: it.length, com_custo: it.filter(i => i.custo_unitario != null).length, curva_ab: ab.length, curva_ab_com_custo: ab.filter(i => i.custo_unitario != null).length,
      nota: 'diagnóstico recalculado agora (margem, lucro F4 e Guardião leem o custo novo); o plano regera no próximo ciclo' } } }) }))
// Agente Smith G0 (Guardião financeiro): raio-X e pauta de reunião só leitura; «decisão do cliente» (1 clique) e lojas do mesmo dono com prévia/confirmar — docs/desenho-guardiao-financeiro.md
app.use(criarRotasGuardiao({ raioX: c => raioXDoCliente(c).rx, pauta: (c, o) => pautaDoCliente(c, o), guardiao: criarGuardiao({ livro: livroReal(), validarPor: n => validarLiderOuConsultor(n) }),
  gerarPdf: (html, destino) => gerarPdfChrome(html, destino), clienteCanonico: clienteDaCentral }))
// Cadastro do cliente (CS responsável, health score, observações; importação da planilha do CS por scripts/importar-base-clientes.mjs): docs/cadastro-clientes.md
app.use(criarRotasCadastro({ cadastro: cadastroClientes, quem: lideresEConsultores, clienteCanonico: clienteDaCentral }))
// Notion do cliente no painel (página, filhos e base Informações; só leitura no Notion; etapa do sync + atualização manual): docs/notion-cliente.md
app.use(criarRotasNotionCliente({ nc: notionCliente, quem: lideresEConsultores }))
app.use(express.static(join(ROOT, 'src', 'web')))
app.use('/evidencias', express.static(join(ROOT, 'data', 'evidencias')))
app.use('/relatorios', express.static(join(ROOT, 'data', 'relatorios')))
app.use('/assets', express.static(join(ROOT, 'assets')))

// logo oficial (assets/logo.png prevalece; senão a recriação .svg)
app.get('/logo', (req, res) => {
  for (const n of ['logo.png', 'logo.jpg', 'logo.jpeg', 'logo.webp', 'logo.svg']) {
    const p = join(ROOT, 'assets', n)
    if (existsSync(p)) return res.sendFile(p)
  }
  res.status(404).end()
})

const filtrosDe = q => ({
  cliente: q.cliente || '', projeto: q.projeto || '', sprint: q.sprint || '',
  processo: q.processo || '', responsavel: q.responsavel || '', status: q.status || '',
  de: q.de || '', ate: q.ate || '', interno: q.interno === '1',
  // filtro avançado (E/OU, operadores, período com data explícita): ?f=<base64url>; "consultor" vira a lista de clientes dele
  ...(q.f ? { sql: compilarSQL(expandir(desserializar(String([].concat(q.f)[0]), { painel: 'execucao', hoje: hojeLocal() }), { clientes_do_consultor: clientesDoConsultor })) } : {}),
})
// nome do consultor (igual/contém) → clientes da central em que ele responde por algum canal
function clientesDoConsultor(n) {
  const alvo = normNome(n.valor), lista = carregarClientes()
  const bate = x => n.operador === 'contem' ? normNome(x).includes(alvo) : normNome(x) === alvo
  return lista.filter(c => Object.values(c.consultores).some(bate) || bate(c.principal)).map(c => c.cliente)
}

// ── APIs do dashboard (tudo determinístico) ─────────────────────────────
app.get('/api/opcoes', (req, res) => res.json({ ...opcoesFiltros(), ordem_sprints: ordemSprints() }))
app.get('/api/kpis', (req, res) => res.json(calcularKpis(filtrosDe(req.query))))
app.get('/api/tarefas', (req, res) => res.json(listarTarefas(filtrosDe(req.query))))
app.get('/api/graficos', (req, res) => {
  const f = filtrosDe(req.query)
  res.json({
    status: graficoStatus(f), processos: graficoProcessos(f),
    burnup: graficoBurnup(f), semanas: graficoSemanas(f),
    riscos: Object.fromEntries(Object.entries(riscos(f)).map(([k, v]) => [k, v.map(t => ({ id: t.id, titulo: t.titulo, responsavel: t.responsavel, prazo: t.prazo, url: t.url, desde: t.desde ?? null, dias: t.desde ? Math.max(0, Math.round((Date.parse(hojeLocal()) - Date.parse(t.desde)) / 86_400_000)) : null }))])),
  })
})
app.get('/api/estado', (req, res) => {
  res.json({
    ultimo_sync: getEstado('ultimo_sync') || null,
    tarefas: db.prepare("SELECT COUNT(*) AS n FROM tarefas WHERE arquivada = 0 AND fonte != 's90'").get().n,
    evidencias: db.prepare('SELECT COUNT(*) AS n FROM evidencias').get().n,
    notion_configurado: !!env.NOTION_TOKEN,
    ia_configurada: !!env.ANTHROPIC_API_KEY,
  })
})

// dispara sync sob demanda (botão no dashboard)
let sincronizando = false
app.post('/api/sync', async (req, res) => {
  if (sincronizando) return res.status(409).json({ erro: 'sync já em andamento' })
  sincronizando = true
  try { res.json(await sincronizar({ completo: req.query.completo === '1' })) }
  catch (e) { res.status(500).json({ erro: e.message }) }
  finally { sincronizando = false }
})

// ── relatório ────────────────────────────────────────────────────────────
app.get('/relatorio', async (req, res) => {
  try {
    const dados = await montarRelatorio(filtrosDe(req.query))
    res.send(renderRelatorio(dados))
  } catch (e) { res.status(500).send(`<pre>Erro ao montar relatório: ${e.message}</pre>`) }
})

// ── relatório semanal Place2u (individual por cliente). ?perfil=id[,id] troca o perfil só nesta geração;
// ?interno=1 é a versão da equipe (checklist de coleta + prontidão); sem ele é SEMPRE a versão do cliente.
const opcoesDaQuery = q => opcoesSemanal(q, listarPerfis().map(p => p.id))
const textoPre = e => `<pre>${String(e.message).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</pre>`
app.get('/semanal', async (req, res) => {
  try {
    const o = opcoesDaQuery(req.query)
    res.send(renderSemanal(await montarSemanal(o), { interno: o.interno }))
  } catch (e) { res.status(400).send(textoPre(e)) }
})

// ── matriz Eisenhower por analista (uso interno da liderança, nunca vai ao cliente)
app.get('/matriz', (req, res) => {
  if (!req.query.responsavel) return res.status(400).send('<pre>Informe ?responsavel=Nome</pre>')
  try {
    const dados = workloadAnalista(req.query.responsavel, { de: req.query.de, ate: req.query.ate })
    if (!dados.total_geral) return res.status(404).send('<pre>Nenhuma tarefa encontrada para esse responsável.</pre>')
    res.send(renderMatrizAnalista(dados))
  } catch (e) { res.status(400).send(`<pre>${e.message}</pre>`) }
})

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
function servirPdf(res, url, nomeArquivo) {
  if (!existsSync(CHROME)) return res.status(501).send('Google Chrome não encontrado — use Imprimir → Salvar como PDF na versão HTML.')
  const saida = join(tmpdir(), `relatorio-${Date.now()}.pdf`)
  const perfilChrome = mkdtempSync(join(tmpdir(), 'ps-chrome-'))   // ponytail (15/10): perfil por execução, apagado no fim (os scoped_dir* encheram o disco)
  execFile(CHROME, [
    '--headless', '--disable-gpu', '--no-pdf-header-footer',
    '--virtual-time-budget=9000', `--user-data-dir=${perfilChrome}`, `--print-to-pdf=${saida}`, url,
  ], { timeout: 60000 }, err => {
    try { rmSync(perfilChrome, { recursive: true, force: true }) } catch {}
    if (err || !existsSync(saida)) return res.status(500).send('Falha ao gerar PDF: ' + (err?.message || 'sem saída'))
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${nomeArquivo}.pdf"`)
    res.send(readFileSync(saida))
    unlinkSync(saida)
  })
}
const slugPdf = s => String(s || 'geral').replace(/\W+/g, '-')
app.get('/relatorio.pdf', (req, res) =>
  servirPdf(res, `http://127.0.0.1:${env.PORT}/relatorio?${new URLSearchParams(req.query)}`,
    `relatorio-${slugPdf(req.query.cliente)}-${slugPdf(req.query.sprint)}`))
app.get('/semanal.pdf', (req, res) => {
  let o
  try { o = opcoesDaQuery(req.query) } catch (e) { return res.status(400).send(textoPre(e)) }   // perfil inválido não gasta um Chrome
  servirPdf(res, `http://127.0.0.1:${env.PORT}/semanal?${new URLSearchParams(req.query)}`,
    `semanal-${slugPdf(o.cliente)}-${o.de}${o.interno ? '-interno' : ''}`)
})
app.get('/matriz.pdf', (req, res) =>
  servirPdf(res, `http://127.0.0.1:${env.PORT}/matriz?${new URLSearchParams(req.query)}`,
    `matriz-${slugPdf(req.query.responsavel)}`))
app.get('/plano.pdf', (req, res) =>
  servirPdf(res, `http://127.0.0.1:${env.PORT}/plano?${new URLSearchParams(req.query)}`,
    `plano-de-acao-${slugPdf(req.query.cliente)}`))
app.get('/planos', (req, res) => res.sendFile(join(ROOT, 'src', 'web', 'planos.html'))) // painel de planos de ação
app.get('/cliente', (req, res) => res.sendFile(join(ROOT, 'src', 'web', 'cliente.html'))) // visão por cliente (busca + plano + motor P→P→C)
app.get('/analistas', (req, res) => res.sendFile(join(ROOT, 'src', 'web', 'analistas.html'))) // gestão por analista (volume, velocidade, atraso, resultado)
app.get('/comercial', (req, res) => res.sendFile(join(ROOT, 'src', 'web', 'comercial.html'))) // prospect → link de conexão → diagnóstico (pré-venda)
app.get('/integracoes', (req, res) => res.sendFile(join(ROOT, 'src', 'web', 'integracoes.html'))) // central de integrações (ML/AMZ/SHO)
app.get('/comercial/diagnostico.pdf', (req, res) =>
  servirPdf(res, `http://127.0.0.1:${env.PORT}/comercial/diagnostico?${new URLSearchParams({ id: String([].concat(req.query.id || '')[0] || '') })}`, `diagnostico-de-conta-${slugPdf(req.query.id)}`))
app.get('/plano-conta.pdf', (req, res) =>
  servirPdf(res, `http://127.0.0.1:${env.PORT}/plano-conta?${new URLSearchParams(req.query)}`, `plano-da-conta-${slugPdf(req.query.cliente)}`))
app.get('/metodologia', (req, res) => res.sendFile(join(ROOT, 'src', 'web', 'metodologia.html')))   // metodologia viva do algoritmo
app.get('/gmv', (req, res) => res.sendFile(join(ROOT, 'src', 'web', 'gmv.html')))           // GMV por consultor/analista e resultado associado
app.get('/processos', (req, res) => res.sendFile(join(ROOT, 'src', 'web', 'processos.html')))   // como cada tarefa é feita em cada canal (Manual do Analista) + duplicação estratégica
app.get('/promocoes', (req, res) => res.sendFile(join(ROOT, 'src', 'web', 'promocoes.html'))) // promoções por cliente (campanhas, MC, analista, plano dry-run)
app.get('/resultados', (req, res) => res.sendFile(join(ROOT, 'src', 'web', 'resultados.html'))) // o que melhor funciona (padrões de tarefas)
app.get('/estrutura', (req, res) => res.sendFile(join(ROOT, 'src', 'web', 'estrutura.html'))) // Estrutura › Estruturas e Equipe: estado real de cada chave (F3)
app.get('/fila', (req, res) => res.sendFile(join(ROOT, 'src', 'web', 'fila.html')))           // Hoje: a fila do dia por papel, ≤ 5 blocos, 1 botão por item (F5)

// ── webhook do Notion (sincronização por evento; agendada segue como reforço)
let timerWebhook = null
app.post('/webhook/notion', (req, res) => {
  // handshake de verificação: o Notion envia verification_token no 1º POST
  if (req.body?.verification_token) {
    log('info', `webhook: verification_token recebido — cole-o na tela de webhooks da integração: ${req.body.verification_token}`)
    return res.json({ ok: true })
  }
  res.json({ ok: true })
  // debounce: várias edições seguidas geram UM sync incremental
  clearTimeout(timerWebhook)
  timerWebhook = setTimeout(() => {
    if (!sincronizando) { sincronizando = true; sincronizar().catch(e => logS('trinity', 'erro', `webhook sync: ${e.message}`)).finally(() => { sincronizando = false }) }
  }, 5000)
})

// ── notificações do Mercado Livre (tópicos orders/items/claims) ───────────
// O ML exige resposta 200 em < 500 ms, senão reenvia e pode desativar o tópico:
// respondemos primeiro e só REGISTRAMOS — a fonte dos números continua sendo a
// coleta via API na geração do plano (nenhum número nasce de notificação crua).
app.post('/webhook/meli', (req, res) => {
  res.json({ ok: true })
  try {
    const n = req.body || {}
    if (n.application_id && env.MELI_CLIENT_ID && String(n.application_id) !== String(env.MELI_CLIENT_ID)) return
    // vendedor sem conexão aqui (excluído com a revogação não confirmada no ML, desconectado, user_id inventado — a rota é aberta): nada a guardar (LGPD)
    if (!db.prepare('SELECT 1 FROM meli_contas WHERE CAST(meli_user_id AS TEXT) = ?').get(String(n.user_id ?? ''))) return
    db.prepare('INSERT INTO meli_notificacoes (topic, resource, user_id, application_id, corpo, recebido_em) VALUES (?,?,?,?,?,?)')
      .run(String(n.topic || ''), String(n.resource || ''), String(n.user_id || ''), String(n.application_id || ''), JSON.stringify(n).slice(0, 2000), new Date().toISOString())
    if (Math.random() < 0.01)   // poda ocasional: só as 10 mil mais recentes interessam
      db.prepare('DELETE FROM meli_notificacoes WHERE id NOT IN (SELECT id FROM meli_notificacoes ORDER BY id DESC LIMIT 10000)').run()
  } catch { /* registro é best-effort; a resposta já foi */ }
})

// ── Integração Mercado Livre (OAuth iniciado pelo botão no Notion) ────────
// Fluxo: cliente clica no link do Notion → /meli/conectar valida a
// assinatura e manda pro Mercado Livre → cliente autoriza → o ML chama
// /meli/callback → trocamos o código por tokens e salvamos por cliente.
app.get('/meli/conectar', (req, res) => {
  const v = validarLinkMeli(req.query.c, req.query.exp, req.query.sig)
  if (!v.ok) return res.status(400).send(meliPaginaErro(v.motivo))
  // Sprint 90 desligado ou conta fora de "ativa com aceite": nem leva ao consentimento do ML (o callback recusaria, e a autorização ficaria viva lá)
  if (ehChaveS90(v.cliente) && (!hostS90Publico() || !s90lib.podeConectar(v.cliente))) return res.status(410).send(meliPaginaErro('Este cadastro não está ativo para conectar. Volte ao painel.', { s90: true }))
  try {
    const state = empacotarState(req.query.c, req.query.exp, req.query.sig)
    res.redirect(urlAutorizacao(state, ehChaveProspecto(v.cliente)))   // prospect → app comercial só leitura, se configurado
  } catch (e) { res.status(500).send(meliPaginaErro(e.message, { s90: ehChaveS90(v.cliente) })) }
})

app.get('/meli/callback', async (req, res) => {
  const { code, state, error } = req.query
  const [c, exp, sig] = desempacotarState(state)
  const v = validarLinkMeli(c, exp, sig)
  // texto FIXO: error_description vem na query (qualquer um monta o link) e nunca vira mensagem com a marca da Place2u; no log, só o código do erro
  if (error) { log('aviso', `Mercado Livre callback: autorização não concluída (${String(error).replace(/[^\w.-]/g, '').slice(0, 40)})`); return res.send(meliPaginaErro(error === 'access_denied' ? 'Autorização recusada no Mercado Livre.' : 'O Mercado Livre não concluiu a autorização.', { s90: v.ok && ehChaveS90(v.cliente), gtm: v.ok && ehChaveProspecto(v.cliente) })) }
  if (!v.ok) return res.status(400).send(meliPaginaErro(v.motivo))
  const prospecto = ehChaveProspecto(v.cliente)
  // Place Sprint 90 (autoatendimento): o código NÃO é trocado aqui. O state é só HMAC (e o PKCE sai dele): quem tem o link pode autorizar a conta de OUTRA
  // pessoa. A troca acontece no host S90, em /c/conectar/fim, com a sessão que pediu o link (uso único, 10 min — rotas-sprint90.js); sem ela nada é gravado.
  const s90 = ehChaveS90(v.cliente)
  if (s90) {
    if (!hostS90Publico() || !s90lib.podeConectar(v.cliente)) return res.status(410).send(meliPaginaErro('Este cadastro não está ativo para conectar. Volte ao painel.', { s90 }))
    // volta ao host da sessão que pediu o link: o S90 público ou, no teste/piloto da equipe em localhost, o loopback dela (só loopback: nunca um host qualquer)
    const volta = s90lib.voltaDaConexao(sig)
    return res.redirect(302, `${volta ? `http://${volta}` : `https://${hostS90Publico()}`}/c/conectar/fim?${new URLSearchParams({ code: String(code || ''), state: String(state || '') })}`)
  }
  const rotulo = prospecto ? `prospect ${v.cliente.slice(-8)}` : v.cliente   // log de prospect: só o id (sem loja nem nickname)
  // prospect excluído (ou chave forjada de prospect inexistente): não troca o código, não grava token órfão
  const removido = () => meliPaginaErro('Este cadastro não existe mais. Gere um novo diagnóstico.', { gtm: true })
  if (prospecto && !prospectoPorChave(v.cliente)) return res.status(410).send(removido())
  try {
    const tok = await trocarCodigo(code, state, prospecto)
    const perfil = await buscarPerfil(tok.access_token, tok.user_id)
    const jaTinha = !prospecto && !!statusConexao(v.cliente)          // reconexão ≠ cliente novo (o aviso diz qual dos dois)
    // a exclusão pode ter ocorrido durante os awaits: recheca e grava na MESMA transação (nada de conexão órfã)
    const gravou = db.transaction(() => {
      if (prospecto && !prospectoPorChave(v.cliente)) return false
      salvarConexao(v.cliente, tok, perfil); return true
    })()
    if (!gravou) {
      // só revoga se nenhuma outra conexão do mesmo vendedor usa o mesmo app EFETIVO ('' = principal): o ML revoga o app inteiro para o vendedor
      if (!outraConexaoDoApp(tok.user_id, tok.app_id)) revogarAutorizacao(tok.access_token, tok.user_id, tok.app_id).catch(() => {})   // melhor esforço: não deixa a autorização viva no ML
      log('info', `Mercado Livre: ${rotulo} excluído durante a conexão — nada gravado`)
      return res.status(410).send(removido())
    }
    logS('trinity', 'info', `Mercado Livre conectado — ${prospecto ? rotulo : `${v.cliente} (${perfil.nickname || tok.user_id})`}`)
    // PROSPECT do comercial: nada do fluxo de cliente (série, plano, Notion). Lead público vê o próprio
    // diagnóstico no host comercial; prospect do closer recebe confirmação (a análise é apresentada pelo time).
    if (prospecto) {
      const p = prospectoPorChave(v.cliente)
      // link direto do site (sem formulário): o cadastro nasceu como «Loja (link do site)» → vira o apelido da conta no ML (só o rótulo do painel)
      if (p && p.empresa === 'Loja (link do site)' && perfil.nickname) { try { db.prepare('UPDATE prospectos SET empresa = ? WHERE id = ?').run(String(perfil.nickname).slice(0, 120), p.id); p.empresa = String(perfil.nickname).slice(0, 120) } catch {} }
      try { notificar({ tipo: 'prospect_conectado', nivel: 'sucesso', titulo: `Prospect conectou a conta: ${p?.empresa || 'novo cadastro'}`, corpo: `${p?.nome || 'O prospect'} autorizou a leitura do Mercado Livre. Estou preparando o diagnóstico para apresentar.`, cliente: v.cliente, link: '/comercial' }) } catch { /* aviso é melhor esforço */ }
      // dados do prospect para o relatório de diagnóstico do Comercial (apagados junto com o cadastro — LGPD); fora de plano, Notion e coleta diária
      coletaEmCurso.add(v.cliente)                                    // a página /d/<token> diz «estamos lendo» enquanto isso roda
      setImmediate(async () => {
        try {
          const { coletarCliente } = await import('./lib/meli-serie.js')
          await coletarCliente(v.cliente, { dias: 90 })
          if (p) await lerReputacaoProspecto(p.id).catch(e => log('aviso', `reputação do prospect ${rotulo}: ${e.message.slice(0, 120)}`))   // nível/medalha; falha fica declarada no relatório
          notificar({ tipo: 'diagnostico_pronto', nivel: 'sucesso', titulo: `Diagnóstico pronto: ${p?.empresa || 'prospect'}`, corpo: 'Os dados da conta foram lidos. Abra o Comercial e emita o relatório (PDF) para apresentar.', cliente: v.cliente, link: '/comercial' })
        } catch (e) { log('erro', `diagnóstico do prospect ${rotulo}: ${e.message}`); try { notificar({ tipo: 'coleta_falhou', nivel: 'erro', titulo: `Não consegui ler a conta do prospect ${p?.empresa || ''}`, corpo: 'A conexão foi feita, mas a leitura dos dados falhou. Tente emitir o diagnóstico de novo em alguns minutos.', cliente: v.cliente, link: '/comercial', dedupeMin: 60 }) } catch { /* sem aviso */ } }
        finally { coletaEmCurso.delete(v.cliente) }
      })
      if (p?.origem === 'publico' && env.COMERCIAL_PUBLIC_HOST) return res.redirect(`https://${env.COMERCIAL_PUBLIC_HOST}/d/${p.token_publico}`)
      return res.send(meliPaginaOk(p?.empresa || 'Sua conta', perfil.nickname))
    }
    // AVISO IMEDIATO no sistema (sino + som + faixa): cliente novo conectou — antes mesmo da coleta terminar
    try { notificar({ tipo: jaTinha ? 'cliente_reconectado' : 'cliente_conectado', nivel: 'sucesso', titulo: jaTinha ? `Cliente reconectou o Mercado Livre: ${v.cliente}` : `Novo cliente conectado: ${v.cliente}`, corpo: `Conta ${perfil.nickname || tok.user_id} autorizou a leitura. Estou buscando anúncios, vendas e visitas agora — o diagnóstico aparece aqui em instantes.`, cliente: v.cliente, link: `/cliente?cliente=${encodeURIComponent(v.cliente)}` }) } catch { /* aviso é melhor esforço */ }
    res.send(meliPaginaOk(v.cliente, perfil.nickname))
    // pós-conexão (roteiro de inteligência): primeira coleta + primeiro diagnóstico do cliente, em segundo plano
    setImmediate(async () => {
      try {
        const { resolverEscopo } = await import('./lib/equipe.js')
        const { gerarPlanosEscopo } = await import('./lib/plano-cliente.js')
        const { coletarCliente } = await import('./lib/meli-serie.js')
        await coletarCliente(v.cliente)                       // série diária de pedidos e visitas (base do GMV e da atribuição)
        await gerarPlanosEscopo(resolverEscopo({ tipo: 'selecao', clientes: [v.cliente] }), { comML: true })
        // plano por anúncio JÁ com a retroalimentação do Merovíngio + fotografias do acompanhamento; depois, o resumo vai para o aviso
        const { gerarPlanoConta } = await import('./lib/plano-anuncios.js')
        const { capturarAcompanhamento } = await import('./lib/acompanhamento.js')
        try { capturarAcompanhamento(v.cliente) } catch (e) { log('aviso', `acompanhamento inicial (${v.cliente}): ${e.message}`) }
        const pc = gerarPlanoConta(v.cliente)
        logS('arquiteto', 'info', `primeiro diagnóstico com dados do Mercado Livre gerado — ${v.cliente}`)
        const rs = pc.disponivel ? pc.diagnostico.resumo : null
        const estado = pc.retro?.estado
        notificar({ tipo: 'dados_prontos', nivel: 'sucesso', titulo: `Dados de ${v.cliente} prontos`,
          corpo: rs ? `${rs.anuncios_ativos} anúncios com venda ou Ads · faturamento de 28 dias R$ ${Math.round(rs.gmv).toLocaleString('pt-BR')}${rs.delta_pct != null ? ` (${rs.delta_pct > 0 ? '+' : ''}${rs.delta_pct}% sobre os 28 anteriores)` : ''}${estado && estado.estado !== 'sem_base' ? ` · conta em ${estado.rotulo.toLowerCase()}` : ''} · ${pc.acoes.length} ações no plano.` : 'A conta foi lida, mas ainda sem vendas suficientes para o diagnóstico.',
          cliente: v.cliente, link: `/cliente?cliente=${encodeURIComponent(v.cliente)}` })
      } catch (e) {
        logS('arquiteto', 'erro', `primeiro diagnóstico (${v.cliente}): ${e.message}`)
        try { notificar({ tipo: 'coleta_falhou', nivel: 'erro', titulo: `Cliente conectado, mas a leitura dos dados falhou: ${v.cliente}`, corpo: 'A conexão está ativa. Abra o cliente e use "Atualizar dados do Mercado Livre".', cliente: v.cliente, link: `/cliente?cliente=${encodeURIComponent(v.cliente)}`, dedupeMin: 60 }) } catch { /* sem aviso */ }
      }
    })
  } catch (e) {
    log('erro', `Mercado Livre callback (${rotulo}): ${e.message}`)
    res.status(500).send(meliPaginaErro('Não foi possível concluir a conexão. Tente novamente em alguns minutos.'))
  }
})

// ── OAuth dos ERPs (Bling/Tiny, só leitura): o cliente autoriza no ERP e volta aqui com code + state assinado (src/lib/erp-credenciais.js)
app.get('/erp/callback', async (req, res) => {
  res.set('Cache-Control', 'no-store')
  try { const r = await tratarCallbackErp(req.query); res.status(r.status).send(r.html) }
  catch (e) { log('erro', `ERP callback: ${sanitizarErp(e?.message)}`); res.status(500).send('Não foi possível concluir a conexão. Peça um novo link ao seu consultor.') }
})

// painel interno (dashboard) — status de conexões, nunca expõe tokens
app.get('/api/meli/conexoes', (req, res) => res.json(listarConexoes()))
app.post('/api/meli/desconectar', (req, res) => {
  if (!req.body?.cliente) return res.status(400).json({ erro: 'informe "cliente"' })
  desconectarMeli(req.body.cliente)             // cliente: a linha vai para o arquivo e dá para restaurar; os dados coletados são apagados
  res.json({ ok: true, restauravel: !ehChaveProspecto(req.body.cliente) && !ehChaveS90(req.body.cliente) })   // S90 nunca vai para o arquivo
})
// restaura uma conexão desconectada pelo painel (sem o cliente autorizar de novo, enquanto o ML não revogou)
app.post('/api/meli/restaurar', (req, res) => {
  if (!req.body?.cliente) return res.status(400).json({ erro: 'informe "cliente"' })
  const r = restaurarConexoes({ clientes: [String(req.body.cliente)], origem: 'arquivada' })
  res.json({ ok: r.length > 0, restauradas: r, nota: r.length ? 'Conexão restaurada. Rode "Atualizar dados do Mercado Livre" no cliente para recolher os dados.' : 'Nada para restaurar (a conexão já existe ou não há arquivo dela).' })
})

// ── coleta diária do Mercado Livre (SÓ LEITURA): 1×/dia entre 4h e 6h, uma conta por vez; depois regenera o plano de cada cliente.
// Sem isso o GMV e o plano ficariam congelados na data da última coleta manual. Falha de um cliente não derruba os outros.
let coletandoML = false
setInterval(async () => {
  saudeSis.bater('coleta')
  const h = new Date().getHours()
  // ponytail: a partir das 4h, uma vez por dia, no primeiro tick com o Mac acordado (antes: só 4h–6h, e o Mac dormindo pulava o dia inteiro — 10 a 12/10 sem coleta)
  if (h < 4 || coletandoML) return
  const { hojeLocal, setEstado } = await import('./lib/db.js')
  if (getEstado('coleta_ml_dia') === hojeLocal()) return
  coletandoML = true
  try {
    // ponytail (13/10): leitura incremental do Notion (SÓ LEITURA) antes da coleta — sem ela «o que a equipe fez» do plano de terça sai «sem a leitura» (o último sync manual era de 09/10)
    if (!sincronizando) { sincronizando = true; try { await sincronizar() } catch (e) { logS('trinity', 'erro', `sync diário do Notion: ${String(e?.message).slice(0, 160)}`) } finally { sincronizando = false } }
    const { coletarCliente } = await import('./lib/meli-serie.js')
    const { gerarPlanoConta } = await import('./lib/plano-anuncios.js')
    const { capturarAcompanhamento } = await import('./lib/acompanhamento.js')
    const { capturarLote } = await import('./lib/anuncio-historico.js')
    // alinhamentos com o cliente: vivo → vencido na data de revisão (o descarte vencido volta à fila) ANTES de regerar os planos — falha não derruba a coleta
    try { const v = alinhamentosReal().vencer(hojeLocal()); if (v.vencidos) logS('arquiteto', 'info', `alinhamentos: ${v.vencidos} vencido(s) para revisão, ${v.reabertas} ação(ões) descartada(s) de volta à fila`) }
    catch (e) { logS('arquiteto', 'erro', `alinhamentos (vencimento diário): ${String(e?.message).slice(0, 160)}`) }
    // listarConexoesColeta: sem conexão em erro e sem conta S90 fora de serviço (cancelada/exclusão agendada: dados só para consulta até o expurgo, nada novo é lido)
    for (const c of listarConexoesColeta()) {
      // coleta → fotografias do acompanhamento (antes/24h/48h/72h/1 semana) → plano regerado COM a retroalimentação do Merovíngio
      try {
        await coletarCliente(c.cliente)
        // V3 F4 (SÓ LEITURA): linhas de dias fechados (até 10/dia), cancelados e frete por envio (teto 300) — cada etapa com try próprio, nunca derruba a coleta; antes do
        // plano para que, com financeiro.margem_medida_nas_regras ligada, as regras leiam o frete do dia
        const fin = await coletarFinanceiro(c.cliente).catch(e => ({ erro: String(e?.message).slice(0, 160) }))
        logS('smith', fin.erro || fin.linhas?.erro || fin.cancelados?.erro || fin.fretes?.erro ? 'aviso' : 'info', `financeiro por pedido — ${c.cliente}: ${JSON.stringify(fin).slice(0, 300)}`)
        capturarAcompanhamento(c.cliente); gerarPlanoConta(c.cliente); logS('trinity', 'info', `coleta diária ML ok — ${c.cliente}`)
      }
      catch (e) { logS('trinity', 'erro', `coleta diária ML (${c.cliente}): ${e.message.slice(0, 160)}`) }   // chave S90 sai só como id: log() mascara (db.js)
      // fotografia completa do anúncio ("Como era": título, descrição, fotos, ficha, preço, frete) — A/B diário, C semanal, só grava quando muda (config/atribuicao.json → snapshot)
      try { const s = await capturarLote(c.cliente); logS('trinity', 'info', `snapshot de anúncios — ${c.cliente}: ${s.gravados} gravado(s), ${s.sem_mudanca} iguais, ${s.falhas} falha(s)${s.teto_atingido ? `, ${s.restantes} para amanhã` : ''}`) }
      catch (e) { logS('trinity', 'aviso', `snapshot de anúncios (${c.cliente}): ${e.message.slice(0, 160)}`) }
      // V3 F2 (SOMBRA, SÓ LEITURA): estoque por local dos UPs ambíguos (Full com Flex ou em 2+ logísticas, com venda em 28 d) — teto por cliente/dia, ~1 chamada/s
      try { const r = await lerEstoqueUps(c.cliente, { ups: upsParaLer(c.cliente) }); if (r.lidos || r.falhas) logS('trinity', 'info', `estoque por local (/stock) — ${c.cliente}: ${r.lidos} lido(s), ${r.falhas} falha(s)${r.pulados ? `, ${r.pulados} para amanhã (teto)` : ''}`) }
      catch (e) { logS('trinity', 'aviso', `estoque por local (${c.cliente}): ${String(e?.message).slice(0, 160)}`) }
      // V3 F5 (SÓ LEITURA, só com produto.diagnostico_ligado): composição dos Kits Virtuais — GET /items/{id} só dos anúncios com a tag bundle, teto por coleta, relido a cada 7 dias
      if (algoritmo.produto?.diagnostico_ligado === true) try { const r = await lerKitsVirtuais(c.cliente); if (r.lidos || r.falhas) logS('trinity', 'info', `kits virtuais — ${c.cliente}: ${r.lidos} lido(s), ${r.falhas} falha(s)`) }
      catch (e) { logS('trinity', 'aviso', `kits virtuais (${c.cliente}): ${String(e?.message).slice(0, 160)}`) }
    }
    // saúde da conta (SÓ LEITURA): reputação, perguntas, reclamações, atrasos de despacho e Full → 1 linha/dia por cliente (src/lib/saude-coleta.js); teto de tempo, falha de um não derruba os outros
    try { const { coletarSaudeTodos } = await import('./lib/saude-coleta.js'); const r = await coletarSaudeTodos({ tetoMs: 10 * 60_000, log }); logS('trinity', 'info', `saúde da conta: ${r.ok} ok, ${r.falhas} falha(s), ${r.pulados} pulado(s) pelo teto de tempo`) }
    catch (e) { logS('trinity', 'erro', `saúde da conta (coleta diária): ${String(e.message).slice(0, 160)}`) }
    // promoções (SÓ LEITURA) para todos os clientes conectados, em lotes por madrugada: interruptor por cliente (perfil_cliente.coleta_promocoes,
    // Cliente → Configurar), padrão e tamanho do lote em config/promocoes.json; quem nunca coletou vai primeiro. Falha de um não derruba os outros.
    // ponytail: não passa pelo lock de job de rotas-promocoes — uma coleta manual às 4h da manhã perderia a posse do carimbo (gravarColeta descarta a mais velha)
    try {
      const { coletarPromocoes, coletaLigada, loteNoturno } = await import('./lib/promocoes-coleta.js')
      const { lerColeta } = await import('./lib/promocoes-db.js')
      const emColeta = new Set(listarConexoesColeta().map(c => c.cliente))   // S90 fora de serviço não entra (mesmo critério da coleta acima)
      const lote = loteNoturno(listarConexoes().filter(x => !x.erro).filter(x => emColeta.has(x.cliente)).map(c => ({ cliente: c.cliente, coleta: lerColeta(c.cliente)?.concluida_em || null, ligada: coletaLigada(coletaPromocoesDoCliente(c.cliente)) })))
      for (const c of lote) {
        try { const r = await coletarPromocoes(c.cliente, { deps: depsPromocoes, por: 'madrugada' }); logS('trinity', 'info', `coleta de promoções (madrugada) ${r.estado} — ${c.cliente}: ${r.anuncios_lidos} anúncio(s) lido(s), ${r.started} em promoção`) }
        catch (e) { logS('trinity', 'erro', `coleta de promoções (madrugada) ${c.cliente}: ${String(e.message).slice(0, 160)}`) }
      }
    } catch (e) { logS('trinity', 'erro', `coleta de promoções (madrugada): ${String(e.message).slice(0, 160)}`) }
    setEstado('coleta_ml_em', agora())   // carimbo com hora: a saúde do sistema e o vigia medem a idade da coleta (autogestão)
    setEstado('coleta_ml_dia', hojeLocal())
    Promise.resolve().then(() => alertas.varrer({ origem: 'coleta' })).catch(e => logS('morpheus', 'erro', `varredura de alertas (pós-coleta): ${sanitizarErp(e?.message)}`))   // estoque novo → pendência crítica avisada no ciclo da coleta diária
    Promise.resolve().then(() => gatilhos.tick({ origem: 'coleta' })).then(() => consultor.tick({ origem: 'coleta' })).catch(e => logS('morpheus', 'erro', `gatilhos ao cliente (pós-coleta): ${sanitizarErp(e?.message)}`))   // dados novos → detecção para todo cliente elegível (aviso interno da equipe); envio ao cliente só com a chave ligada e liberação
  } finally { coletandoML = false }
}, 10 * 60 * 1000)

// ── custos de ERP (SÓ LEITURA no Bling/Tiny; não chama o ML, por isso não divide lock com a coleta acima). O tick varre 1×/dia a partir
// das 03h cada conta conectada (estado por cliente, até 3 tentativas), faz o keepalive do Tiny e a poda; a fila drena gatilhos/detalhes.
// ── renovação PREVENTIVA das contas do ML (a cada 30 min): renova o que vence em < 90 min e "toca" o refresh_token de contas
// ociosas, para a conexão ficar sempre ativa SEM o cliente precisar logar de novo. Falha definitiva (refresh queimado/revogado)
// vira log de ERRO + marca a conta para reconectar — nunca silencioso.
let renovandoML = false, ultimoBackupConexoes = ''
async function renovacaoPreventiva() {
  if (renovandoML) return
  renovandoML = true
  try {
    // backup das conexões (tokens cifrados) a CADA ciclo de 30 min — o refresh_token gira a cada ~5 h, então um snapshot só diário já nasceria velho —
    // e recuperação de qualquer par de tokens que não coube no banco numa renovação anterior
    try { const rec = recuperarPendentes(); if (rec) log('aviso', `conexões ML: ${rec} par(es) de token pendente(s) recuperado(s) do disco`) } catch (e) { log('erro', `recuperação de tokens pendentes: ${String(e.message).slice(0, 120)}`) }
    try { const b = backupConexoes(new Date().toISOString().slice(0, 10)); if (ultimoBackupConexoes !== new Date().toISOString().slice(0, 10) && b.n) { ultimoBackupConexoes = new Date().toISOString().slice(0, 10); log('info', `backup das conexões do Mercado Livre: ${b.n} conta(s)`) } } catch (e) { log('erro', `backup das conexões ML: ${String(e.message).slice(0, 120)}`) }
    const { renovarPreventivo } = await import('./lib/meli-contas.js')
    const r = await renovarPreventivo()
    saudeSis.bater('renovacao_ml'); saudeSis.registrarRenovacao(r.falhas)   // «sem token» transitório em 3 ciclos seguidos vira incidente (autogestão A3)
    if (r.renovadas) logS('trinity', 'info', `renovação preventiva ML: ${r.renovadas} conta(s) renovada(s), ${r.ok} ainda frescas`)
    if (r.recuperadas) logS('trinity', 'info', `renovação preventiva ML: ${r.recuperadas} conta(s) em erro voltaram a funcionar`)
    for (const f of r.falhas) logS('trinity', /transitória/.test(f.erro) ? 'aviso' : 'erro', `renovação preventiva ML (${f.cliente}): ${String(f.erro).slice(0, 140)}${/transitória/.test(f.erro) ? '' : ' — reconectar pelo botão'}`)
    // conexão que JÁ está caída continua pedindo reconexão: lembra 1×/dia no sino (não some só porque o aviso original foi lido)
    for (const c of listarConexoes().filter(x => x.erro)) {
      try { notificar({ tipo: 'conexao_caiu', nivel: 'erro', titulo: `Conexão com o Mercado Livre caída: ${c.cliente}`, corpo: 'Este cliente precisa autorizar de novo (o acesso foi revogado ou o refresh token já foi usado). Abra a Central de Integrações, gere o link de reconexão e envie ao cliente — os dados já coletados continuam no sistema.', cliente: c.cliente, link: '/integracoes', dedupeMin: 24 * 60 }) } catch { /* aviso é melhor esforço */ }
    }
  } catch (e) { logS('trinity', 'erro', `renovação preventiva ML: ${String(e.message).slice(0, 140)}`) }
  finally { renovandoML = false }
}
setTimeout(renovacaoPreventiva, 30 * 1000)                     // 30 s depois de subir (cobre reinício do Mac/servidor)
setInterval(renovacaoPreventiva, 30 * 60 * 1000)

setInterval(() => tickCustos().catch(e => logS('smith', 'erro', `tick de custos: ${sanitizarErp(e?.message)}`)), 10 * 60 * 1000)
// agendador dos relatórios ao Notion: a cada 10 min (sai sozinho se o interruptor está desligado, se já há envio em curso ou fora de seg-sex 17h–23h)
// batimento dos ticks de Morpheus para a Saúde do sistema (autogestão A2): o tick vira «bate e roda» sem mudar as linhas dos setInterval abaixo
for (const [nome, o] of [['relatorios', relatorios], ['consultor', consultor], ['gatilhos', gatilhos]]) { const t = o.tick.bind(o); try { o.tick = (...a) => { saudeSis.bater(nome); return t(...a) } } catch { /* objeto congelado: fica sem batimento, nunca derruba o servidor */ } }
setInterval(() => Promise.resolve().then(() => relatorios.tick()).catch(e => logS('morpheus', 'erro', `agendador de relatórios: ${sanitizarErp(e?.message)}`)), 10 * 60 * 1000)
// varredura de pendências críticas do cliente (alerta interno com som sempre; página no Notion só com o interruptor «alerta_auto» ligado): a cada 10 min
setInterval(() => Promise.resolve().then(() => alertas.varrer()).catch(e => logS('morpheus', 'erro', `varredura de alertas: ${sanitizarErp(e?.message)}`)), 10 * 60 * 1000)
// aviso interno ao time (Discord): resumo semanal terça 08:30 no fuso do cliente; registrado ANTES do tick dos gatilhos (o resumo vem antes do plano das 09:00)
setInterval(() => Promise.resolve().then(() => consultor.tick()).catch(e => logS('morpheus', 'erro', `aviso ao consultor: ${sanitizarErp(e?.message)}`)), 10 * 60 * 1000)
// gatilhos ao cliente: plano semanal terça 09:00 no fuso do cliente + urgente de estoque e preço na hora (só com urgente.na_hora_ligado no config, 14/10/2026), a cada 10 min; sai no 1º if se a chave «gatilhos_ligado» está desligada
setInterval(() => Promise.resolve().then(() => gatilhos.tick()).catch(e => logS('morpheus', 'erro', `gatilhos ao cliente: ${sanitizarErp(e?.message)}`)), 10 * 60 * 1000)
// V3 F6: tick do sincronismo de estoque (sai no 1º if com sync_estoque_ligado = false ou o kill switch ligado): confere ordens vencidas (só leitura) e executa só no nível executar_e_avisar
setInterval(() => syncEstoque.tickEstoque().catch(e => logS('chaveiro', 'erro', `sincronismo de estoque: ${sanitizarErp(e?.message)}`)), 10 * 60 * 1000)
// Chaveiro F4+: confere as ordens enviadas (só leitura) e avalia o Neo (proposta de ampliar com veto de 48 h); sai no 1º if com execucao_ligada = false; nunca executa sozinho
setInterval(() => execChaveiro.tickExecutor().catch(e => logS('chaveiro', 'erro', `execução: ${sanitizarErp(e?.message)}`)), 10 * 60 * 1000)
// respostas ao relatório: 1×/dia a partir das 18:00 (config/respostas-relatorio.json → coleta), só grupos com âncora/plano nos últimos 14 dias; sem n8n configurado não roda
setInterval(() => Promise.resolve().then(() => respostas.tick()).catch(e => logS('morpheus', 'erro', `respostas ao relatório: ${sanitizarErp(e?.message)}`)), 10 * 60 * 1000)
setInterval(() => ingerirLivro({ origem: 'tick' }), 10 * 60 * 1000)   // livro de registro: coleta, relatórios, planos, avisos e respostas novos entram com a data da fonte (ingerirLivro nunca lança)
// dossiê MENSAL p/ cliente com risco aberto: dia 1 a partir das 09:00 (America/Sao_Paulo), mês anterior, as duas versões ao n8n (#growth); chave dossie_mensal_ligado NASCE DESLIGADA
setInterval(() => dossiesReal().tickMensal().catch(e => logS('morpheus', 'erro', `dossiê mensal: ${sanitizarErp(e?.message)}`)), 10 * 60 * 1000)
setInterval(() => notaFiscal.tick().catch(e => logS('chaveiro', 'erro', `nota fiscal: ${sanitizarErp(e?.message)}`)), 10 * 60 * 1000)   // V3 F8: nada com nf.ligado = false
setInterval(() => processarFila().catch(e => logS('smith', 'erro', `fila de custos: ${sanitizarErp(e?.message)}`)), 5000)
// Place Sprint 90, 1×/dia (checado de hora em hora): expurgo LGPD (pendentes 7 dias sem conexão, cancelados 90 dias, exclusões agendadas, IPs de 12 meses)
// e ledger diário (contas, faturas, pagamentos, aceites) em data/backups/s90-<dia>.json (0600, 30 dias). Sem SPRINT90_PUBLIC_HOST, nada roda.
setInterval(() => {
  if (!hostS90Publico() || getEstado('s90_tick_dia') === hojeLocal()) return
  setEstado('s90_tick_dia', hojeLocal())
  // expurgo e ledger independentes: um expurgo que lança não deixa o dia sem ledger (cada conta já é isolada dentro do expurgar)
  Promise.resolve().then(async () => {
    const r = await s90lib.expurgar()
    log('info', `Sprint 90: expurgo (${r.pendentes} pendente(s), ${r.cancelados} cancelada(s), ${r.retentativas} exclusão(ões) agendada(s), ${r.ips} IP(s) apagado(s), ${r.orfaos} linha(s) órfã(s), ${r.fiscais} conta(s) no fim do prazo fiscal${r.falhas ? `, ${r.falhas} falha(s)` : ''})`)
  }).catch(e => log('erro', `Sprint 90 (expurgo): ${sanitizarErp(e?.message)}`))
    .finally(() => { try { const l = s90lib.exportarLedger(hojeLocal()); log('info', `Sprint 90: ledger com ${l.contas} conta(s)`) } catch (e) { log('erro', `Sprint 90 (ledger): ${sanitizarErp(e?.message)}`) } })
}, 60 * 60 * 1000)

// ── autogestão (docs/plano-autogestao.md A2/A3): saúde a cada minuto (batimento + incidentes a cada 5 min); sync incremental do Notion a cada 2 h com teto de tempo
// (as fontes que não couberem continuam no próximo); medição de resultados 1×/dia a partir das 06h (medirResultados só rodava ao gerar plano ou abrir /api/aprendizado)
setInterval(() => saudeSis.tick().catch(() => {}), 60 * 1000)
{ const cfgA = JSON.parse(readFileSync(join(ROOT, 'config', 'autogestao.json'), 'utf-8')).sync_notion
  setInterval(async () => {
    saudeSis.bater('sync_notion')
    if (sincronizando || coletandoML || !env.NOTION_TOKEN) return
    sincronizando = true
    try { await sincronizar({ tetoMs: cfgA.teto_min * 60_000 }) } catch (e) { logS('trinity', 'erro', `sync do Notion (2 h): ${String(e?.message).slice(0, 160)}`) } finally { sincronizando = false }
  }, cfgA.intervalo_min * 60_000) }
setInterval(async () => {
  saudeSis.bater('medicao')
  if (new Date().getHours() < 6 || getEstado('medicao_dia') === hojeLocal()) return
  setEstado('medicao_dia', hojeLocal())
  try { const { medirResultados } = await import('./lib/aprendizado.js'); const r = medirResultados(); setEstado('medicao_em', agora()); logS('merovingio', 'info', `medição diária: ${JSON.stringify(r)}`) }
  catch (e) { logS('merovingio', 'erro', `medição diária: ${String(e?.message).slice(0, 160)}`) }
}, 60 * 60 * 1000)

// erros: nunca devolver stack trace nem mensagem interna crua (JSON inválido = 400; o resto = 500 genérico, detalhe só no log)
// 4xx do parser (corpo acima de 1 MB = 413, charset inválido = 415...) é erro de quem chamou, com mensagem clara — nunca 500 'erro interno'
// Log: JSON malformado/corpo grande = só método, rota e status (a mensagem do JSON.parse ecoa um trecho do corpo, e um segredo colado
// sem aspas iria junto); outro erro perde tudo a partir da 1ª aspa (eco de dado) e passa pelo sanitizar (Bearer, JWT, chave=valor).
app.use((err, req, res, next) => {
  if (err?.filtro && !res.headersSent) return res.status(err.status || 400).json({ erro: err.message })   // filtro avançado inválido: 400 legível (as mensagens de lib/filtros.js nunca ecoam o valor recebido)
  return proximoErro(err, req, res, next)
})
const proximoErro = (err, req, res, next) => {
  const parse = err?.type === 'entity.parse.failed', grande = err?.type === 'entity.too.large', st = parse ? 400 : grande ? 413 : err?.status >= 400 && err?.status < 500 ? err.status : 500
  const detalhe = parse || grande ? '' : `: ${sanitizarErp(String(err?.message || err).replace(/["'`][\s\S]*$/, '…')).slice(0, 160)}`
  log(st < 500 ? 'aviso' : 'erro', `${req.method} ${req.path} → ${st}${detalhe}`)
  res.status(st).json({ erro: parse ? 'JSON inválido' : grande ? 'corpo grande demais (máx. 1 MB): divida a importação em partes menores' : st < 500 ? 'requisição inválida' : 'erro interno' })
}

// escuta SÓ no loopback: o cloudflared (túnel do OAuth do ML) conecta em 127.0.0.1; ninguém da rede local alcança o painel
// desligamento limpo: espera as renovações de token em voo (matar o processo entre a resposta do ML e a gravação perderia o refresh_token novo)
let encerrando = false
for (const sinal of ['SIGTERM', 'SIGINT']) process.on(sinal, async () => {
  if (encerrando) return
  encerrando = true
  try { await aguardarRenovacoes(25_000) } catch { /* sai mesmo assim */ }
  process.exit(0)
})
app.listen(env.PORT, '127.0.0.1', () => {
  console.log(`▶ Place Sprints em http://localhost:${env.PORT}`)
  console.log(`  Dashboard:  http://localhost:${env.PORT}`)
  console.log(`  Relatório:  http://localhost:${env.PORT}/relatorio?cliente=...&sprint=...`)
  console.log(`  PDF:        http://localhost:${env.PORT}/relatorio.pdf?cliente=...&sprint=...`)
  if (!env.NOTION_TOKEN) console.log('  ⚠ NOTION_TOKEN ausente — rode "npm run demo" para dados de demonstração ou configure o .env')
})
