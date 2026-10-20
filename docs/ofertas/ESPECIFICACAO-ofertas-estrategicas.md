# Módulo de ofertas estratégicas por cliente

Especificação funcional e briefing de implementação — 07/10/2026

## 1. Resultado esperado

Dentro de Cliente → Anúncios, permitir cadastrar novos produtos e otimizar anúncios existentes: importar dados e fotos, diagnosticar oportunidades, calcular preço e margem, preparar ficha técnica e textos, gerar imagens reais por ferramenta integrada, validar a versão e publicar pelos conectores dos marketplaces. Após publicação, conferir o resultado e acompanhar os indicadores.

Este documento especifica o desenvolvimento. Não representa código instalado, conexão ativa, pastas já criadas no Google Drive ou anúncios publicados. O pacote enviado contém somente `oferta-mkt/SKILL.md`; os scripts, repositórios, moldes, credenciais e outras skills citados não estão incluídos.

## 2. Análise da skill recebida

| Elemento | Decisão para o sistema |
|---|---|
| Ficha baseada em fatos com fonte | Manter; armazenar origem, data e evidência por atributo. |
| Confirmação visual do produto antes de gerar | Manter como validação da referência por SKU e versão; reaproveitar enquanto a referência não mudar. |
| Aprovação da direção e da galeria | Transformar em etapas dentro do sistema, com responsável, versão e histórico. |
| Imagem avulsa, ficha avulsa e oferta completa | Manter como escopos separados para evitar alterações não solicitadas. |
| Conferência antes/depois e leitura após gravação | Manter; acrescentar tratamento de publicação parcial e reconciliação. |
| Aprendizado sobre imagens aprovadas/reprovadas | Manter por cliente, marca, categoria e produto; não aplicar decisões de uma conta a todas. |
| Desktop, Finder, OneDrive, SharePoint, caminhos locais e Node fixo | Substituir por Drive, banco de dados e trabalhadores de processamento no servidor. |
| Aprovação por célula amarela | Substituir por registro explícito de aprovação. Cor será apenas apresentação. |
| Quatro candidatas e três rodadas sempre | Tornar configurável, com orçamento, prazo e limite por tarefa. |
| Regras de edição contraditórias | Definir: criação usa base original; ajuste pontual usa versão aprovada mais referência original para conferir fidelidade. |
| Aceitar pequenas alterações do produto | Não usar como aprovação automática. Erros em cor, peças, quantidade, medidas, botões ou identidade bloqueiam. |
| MPN, fabricante, modelo e acessórios como espaço para campanhas | Remover. Cada campo deve representar o atributo real. Palavras-chave entram apenas onde forem pertinentes e permitidas. |
| Janela de 40 caracteres, prazo de indexação, título travado e demais conclusões de contas antigas | Tratar como observações históricas, não como regras universais. Verificar capacidades e restrições atuais por canal, conta e categoria. |
| Ignorar divergências de identificadores | Corrigir: registrar divergência e pedir validação; nunca substituir GTIN, MPN ou certificação silenciosamente. |
| Ocultar restrições relevantes para melhorar conversão | Corrigir: cenas e textos não podem induzir uma capacidade não comprovada. |

O sistema deve separar estratégia de execução: a skill propõe e justifica; serviços executam cálculos, geração de imagens e integrações; a política de aprovação determina o que pode ser publicado.

## 3. Experiência dentro do sistema

Na lista de anúncios, incluir: Novo produto, Importar planilha, Importar anúncio existente, Otimizar selecionados e Fila de produção.

Cada linha mostra foto, cliente, canal, conta, produto, SKU/variação, ID do anúncio, preço atual, margem estimada, estoque, vendas, faturamento, consultor, analista, status e última sincronização. Não misturar estoque e margem atuais com indicadores históricos sem indicar suas datas.

Dentro do produto, usar abas: Visão geral; Dados e ficha técnica; Custos e preços; Fotos e galeria; Estratégia; Aprovação; Publicação; Histórico e resultados.

Ao solicitar otimização, selecionar o escopo: oferta completa, título/descrição, ficha técnica, preço, imagem avulsa ou galeria. Permitir executar em um produto ou em lote, com resultado individual por item.

Exibir antes/depois e o motivo de cada alteração. O operador deve conseguir editar propostas, escolher imagens, reordenar a galeria e aprovar campos individualmente. Reprovação exige motivo curto reaproveitável pela próxima rodada.

## 4. Identidade e dados

Separar Produto (identidade física), Variante (cor/tamanho e SKU), Anúncio (representação em uma conta/canal) e Oferta comercial (preço, estoque, condições). Um produto pode ter diversas variantes e anúncios. Não inferir vínculo por nome parecido.

Chave interna: organização + cliente + produto/variante. Chave externa: canal + conta + identificador de anúncio/variação. SKU sozinho não é globalmente único.

Entidades mínimas: clientes; contas conectadas; produtos; variantes; anúncios; atributos com evidências; custos; regras comerciais; ativos de imagem; trabalhos de otimização; propostas versionadas; aprovações; trabalhos de publicação; eventos de auditoria; métricas diárias.

Definir a fonte responsável por campo: ERP para estoque/custo quando integrado; cadastro validado para atributos físicos; canal para status e dados efetivamente publicados; sistema para propostas e aprovações. Conflitos não são resolvidos pelo último texto recebido: exibir a divergência com a origem de cada valor.

Planilha é entrada e revisão assistida. Banco do sistema é responsável por estado, tarefas e aprovações. Guardar a revisão importada e nunca usar número da linha como identificador permanente. Editar a planilha não publica automaticamente.

## 5. Estrutura proposta no Google Drive

Raiz: `Operacao-Marketplaces/Clientes/{cliente_id}-{nome}/`.

| Caminho relativo | Conteúdo |
|---|---|
| `00-Gestao/` | Identidade visual, responsáveis e regras comerciais aprovadas. |
| `01-Planilhas/` | Cadastro, custos, preços e relatório de importação. |
| `02-Produtos/{produto_id}-{nome}/00-Referencias/` | Manuais, ficha do fabricante e comprovações. |
| `02-Produtos/{produto_id}-{nome}/Variantes/{sku}/01-Originais/` | Fotos originais daquela variante, preservadas. |
| `02-Produtos/{produto_id}-{nome}/Variantes/{sku}/02-Geradas/{job_id}/` | Candidatas e versões produzidas. |
| `02-Produtos/{produto_id}-{nome}/Variantes/{sku}/03-Aprovadas/{versao}/` | Galeria aprovada ordenada. |
| `02-Produtos/{produto_id}-{nome}/Variantes/{sku}/04-Publicadas/{canal}/{anuncio_id}/{versao}/` | Arquivos, manifesto e retorno da publicação. |
| `02-Produtos/{produto_id}-{nome}/Variantes/{sku}/05-Historico/` | Versões substituídas e registros de decisão. |
| `03-Relatorios/` | Exportações e resultados. |

Nome de imagem: `{sku}-{canal}-{posicao_02d}-{papel}-v{versao}.jpg`. Usar ID de arquivo/pasta do Drive no banco; renomear não pode quebrar o vínculo. Não selecionar arquivos por ordem alfabética para decidir a publicação: a ordem vem do manifesto aprovado.

Criar pastas idempotentemente e apenas no cliente correto. Fotos comuns podem ser referenciadas por mais de uma variante quando realmente aplicáveis. Não recolorir produto sem referência real da cor. Nunca tornar a pasta de custos pública para permitir envio de fotos.

Para publicar, obter os bytes por acesso autorizado ao Drive e usar o mecanismo de upload do canal. Quando o canal exigir URL acessível, hospedar somente o ativo aprovado em armazenamento próprio com acesso e prazo compatíveis. Link de visualização do Drive não deve ser tratado como URL direta de imagem.

## 6. Modelo da planilha: uma linha por SKU/variante

Na aba principal, cada linha representa uma unidade vendável: produto sem variação = uma linha; produto com três cores = três linhas ligadas pelo mesmo `produto_id`. A foto fica visível na primeira coluna, mas o vínculo operacional é o ID/link do arquivo. A miniatura é prévia; o processamento utiliza o original.

### Aba PRODUTOS

| Grupo | Colunas |
|---|---|
| Foto | foto_principal_preview, foto_principal_drive_id, pasta_fotos_drive_id |
| Identificação | cliente_id, produto_id, variante_id, sku, sku_pai, nome_produto, marca, modelo, gtin, mpn |
| Variação | cor, tamanho, material, quantidade_kit, unidade_venda |
| Logística | peso_produto_kg, peso_embalado_kg, altura_embalagem_cm, largura_embalagem_cm, comprimento_embalagem_cm |
| Operação | estoque_disponivel, consultor_id, analista_id, prioridade, objetivo_otimizacao |
| Evidências | ficha_fonte_drive_id, observacoes, referencia_confirmada, confirmado_por, confirmado_em |
| Controle | status_importacao, pendencias, atualizado_em, versao |

Campos numéricos com unidade explícita; identificadores como GTIN e SKU devem permanecer texto para preservar zeros. Campos vazios significam desconhecido, nunca zero automático.

### Aba ANUNCIOS

Uma linha por cliente + variante + canal + conta + anúncio. Campos: cliente_id, variante_id, sku, canal, conta_id, anuncio_id, variacao_externa_id, catalogo_id, categoria_id, url_anuncio, titulo_atual, preco_atual, estoque_canal, status_canal, criado_em, sincronizado_em. Um anúncio agrupado pode referenciar várias variantes sem duplicar a entidade anúncio no banco.

### Aba CUSTOS

Uma linha por variante e vigência: cliente_id, variante_id, sku, moeda, custo_compra, frete_entrada_unitario, embalagem_unitaria, preparo_unitario, outros_custos_unitarios, inicio_vigencia, fim_vigencia, fonte, atualizado_em. Rateio por pedido precisa explicitar unidades e regra. Não duplicar embalagem/frete em outra aba de cálculo.

### Aba PRECOS_POR_CANAL

Uma linha por variante + conta/canal + modalidade + vigência: comissão estimada ou consultada, tarifa fixa, base de cada incidência, tributos parametrizados, frete a cargo do vendedor, desconto financiado pelo vendedor, contribuição promocional, provisão de devolução, verba estimada de Ads, margem de contribuição mínima e alvo, preço vigente, preço proposto, piso calculado, margem prevista, fonte das taxas, consultado_em e validade da simulação.

### Aba ATRIBUTOS

Uma linha por variante + canal/categoria + atributo: id_atributo, nome, tipo, unidade, valor_atual, valor_proposto, obrigatorio, editavel, fonte, validacao, aprovado_por. Não criar centenas de colunas fixas que não se aplicam a todas as categorias.

### Aba IMAGENS

Uma linha por imagem: asset_id, variante_id, drive_file_id, papel (original/capa/benefício/medida/kit/uso), ordem, canal, versao, hash, largura, altura, bytes, fonte, prompt, job_id, status, motivo_reprovacao, aprovado_por, aprovado_em. Acesso ao prompt pode ser interno; cliente vê o resultado e a decisão.

### Aba FILA

job_id, cliente_id, variante_id, anuncio_id, escopo, objetivo, solicitante, responsavel, status, pendencias, proposta_versao, aprovacao_id, agendado_em, publicado_em, erro_acionavel. Colunas de aprovação e status espelham o sistema e não podem ser alteradas para burlar o fluxo.

Importação: mostrar prévia, validar chaves duplicadas, imagens acessíveis, unidades e campos obrigatórios; produzir erros por linha; importar itens válidos sem esconder os inválidos. Fórmulas externas ou conteúdo de células não devem ser executados como comandos.

## 7. Cálculo de preço e viabilidade

Calcular no servidor com precisão decimal. A IA explica e propõe cenários, mas não é a calculadora oficial. Usar regras comerciais e parâmetros tributários fornecidos/validados pelo cliente; nenhuma alíquota universal presumida.

Receita considerada = preço efetivamente recebido da venda e repasses confirmados, conforme base definida. Margem de contribuição estimada = receita considerada menos produto, custos unitários, comissões, tarifas, tributos parametrizados, logística suportada pelo vendedor, descontos não deduzidos anteriormente, Ads estimado e provisões. Exibir composição; isso não é lucro líquido contábil.

No cenário simplificado em que todas as taxas percentuais incidem sobre a mesma receita P, custos absolutos somam C e o percentual total é t: contribuição = P × (1 − t) − C; preço para margem m = C / (1 − t − m). Bloquear se o denominador for menor ou igual a zero. Essa fórmula não deve ser aplicada a tabelas por faixa, bases diferentes, subsídios condicionais ou tarifas não lineares; nesses casos simular cada preço com as regras reais.

Exemplo puramente ilustrativo para teste: C = R$ 50, t = 20%, m = 20% → P = R$ 83,333…; arredondar para preço operacional e recalcular a margem. Desconto deve ser calculado uma vez, sem deduzi-lo na receita e novamente no custo.

Separar Ads por percentual de receita total de ACOS calculado sobre receita atribuída a anúncios. Não somar ACOS indiscriminadamente a todas as vendas. Sem dado confiável, marcar simulação e impedir aprovação automática do preço.

Recalcular no momento da publicação. Mudança material de custo, taxa, estoque ou validade da promoção invalida a proposta comercial e encaminha para revisão. Atualização somente de imagem não deve carregar preço/estoque no payload.

## 8. Estratégia de otimização

Capturar a linha de base antes de alterar: visitas, impressões e cliques quando disponíveis, pedidos pagos, unidades vendidas, receita, conversão com denominador declarado, preço, estoque, cancelamentos e devoluções, Ads e margem estimada. Ausência de dados não é zero.

Diagnosticar separadamente: descoberta; clique; conversão; viabilidade comercial; qualidade/fidelidade. Exemplo: muitas impressões e poucos cliques justificam testar capa e posicionamento; visitas sem vendas também exigem avaliar preço, frete, prazo e confiança; falta de estoque não se corrige com imagem.

Para cada proposta, registrar problema observado, evidência, hipótese, ação, métrica principal, janela de acompanhamento e fatores de confusão. Produto novo recebe estratégia inicial, sem alegar histórico inexistente.

Fontes para termos e objeções: dados autorizados do canal, perguntas e avaliações pertinentes, atributos comprovados e pesquisa identificada. Não prometer ranking, indexação ou aumento de vendas. Não copiar imagens de concorrentes como referência física do produto.

Permitir objetivos: lançar produto; elevar clique; melhorar conversão; preservar margem; corrigir ficha; campanha sazonal. O plano deve explicar por que aquele produto foi priorizado.

## 9. Geração real de imagens

O botão Gerar imagens precisa chamar um provedor conectado de geração/edição que aceite referências e devolva arquivos. Produzir apenas prompts não conclui o trabalho. Sem provedor disponível, mostrar integração pendente, não sucesso simulado.

Entrada: produto/variante exatos, fotos confirmadas, ficha factual, identidade visual, restrições do canal e briefing da imagem. Saída: arquivo, prévia, versão, dimensões, custo quando disponível, referência usada, prompt e resultado de verificação.

Galeria proposta ajustável à categoria/canal: capa; benefício principal; uso real; diferenciais; medidas; conteúdo da embalagem; compatibilidade/cuidados. Quantidade, formato, resolução, peso e possibilidade de texto/fundo são regras configuráveis por destino, consultadas antes da exportação.

Conferir formato, cor, proporção, número de componentes, botões, conectores, rótulos, acessórios e telas. Benefício ou cena não pode sugerir resistência, certificação ou função não comprovada. Para smartwatch: preservar caixa, botão/coroa, pulseira e mostrador real; pessoa em academia/corrida/dança deve usar relógio com escala física plausível. Não inserir natação ou GPS autônomo sem evidência.

Renderizar textos e medidas em camada controlável, com checagem de contraste, ortografia e recorte. Medidas são do cadastro validado, não estimadas a partir da foto. Fazer prévia em tamanho pequeno e ampliada. Edição de uma peça aprovada preserva o restante e cria versão derivada, sem sobrescrever o original.

Registrar aprovação automática técnica separada da aprovação visual da operação. Validação visual não comprova especificações técnicas. Conferência humana permanece para referência nova ou dúvida relevante. Se houver orçamento automático aprovado para geração, executar dentro dele; ao atingir o teto, preservar o trabalho e mostrar a pendência.

## 10. Máquina de estados e aprovação

Fluxo principal: Rascunho → Validando entrada → Pendente de dados ou Referência confirmada → Estratégia preparada → Estratégia aprovada → Em produção → Em revisão → Aprovado para publicar → Agendado/Na fila → Publicando → Em conferência → Publicado confirmado → Monitorando.

Estados adicionais: Falha recuperável, Falha parcial, Aguardando canal, Conflito externo, Cancelado e Rejeitado. Cada estado tem ação clara, responsável e motivo. Não chamar tudo de “em processamento”.

Aprovação deve referenciar exatamente a versão da ficha, imagens, preço e plano de alterações, com autor e horário. Se uma parte muda, invalidar aprovações dependentes. Aprovação por lote deve identificar cada item incluído, sem aprovar implicitamente linhas filtradas ou fora da seleção.

Modos: (1) preparar rascunho; (2) publicar automaticamente após aprovação da operação; (3) automatização recorrente com política previamente autorizada por cliente, canal, campos, teto de geração e piso de margem. O modo 2 é o padrão proposto: depois da aprovação, o sistema publica sem pedir outro clique redundante.

O aprovador pode ser analista, consultor, gestor ou cliente conforme regra do contrato. Não exigir aprovação pessoal do dono em todas as etapas quando a operação já recebeu essa atribuição.

## 11. Publicação e integrações

Criar adaptador por canal. Contrato interno sugerido: consultarCapacidades, importarAnuncio, consultarCategoriaEAtributos, consultarRegrasComerciais, validarProposta, enviarImagem, criarAnuncio, atualizarCamposPermitidos, consultarProcessamento e conferirPublicado. Esses nomes são funções internas propostas, não endpoints oficiais.

Capacidades variam por conta, categoria, modalidade, catálogo e versão da API. Mercado Livre, Shopee, Amazon e eventual Magalu devem ter implementação e validação próprias. Não reutilizar payload do ML nos demais. Começar por um canal ponta a ponta e habilitar os seguintes somente após comprovar o fluxo.

No ML, a documentação consultada já orienta novos desenvolvimentos a considerar User Products; não congelar a publicação em uma receita antiga de título/variação da skill. Conteúdo compartilhado de catálogo deve seguir o fluxo permitido de correção/revisão; não confundir ajuste da oferta do vendedor com alteração do produto do catálogo.

Antes de gravar: verificar autorização e conta, atualizar o anúncio, comparar com a versão usada no diagnóstico, validar categoria e campos, recalcular preço se incluído, guardar snapshot e produzir diff/payload. Modificar somente os campos aprovados. Variações irmãs e suas imagens precisam ser preservadas.

Trabalhos assíncronos com identificador, progresso, tentativas limitadas e chave de idempotência por cliente/conta/alvo/versão/operação. Diante de timeout, consultar o resultado antes de repetir uma criação; não criar anúncios duplicados. Distinguir credencial expirada, falta de permissão, validação rejeitada, limite de uso, processamento pendente e erro transitório.

Não existe transação única entre Drive, banco e marketplaces: manter registro por etapa. Se fotos forem aceitas e ficha rejeitada, mostrar falha parcial, reconciliar o estado real e retomar apenas o necessário. Não afirmar rollback total; reversão usa snapshot e apenas campos que o canal ainda permite alterar. Não excluir anúncios para simular desfazer.

Depois: conferir IDs, campos e sequência de imagens, aguardar processamento do canal quando necessário e realizar nova consulta agendada. API aceitar solicitação não significa anúncio visível, aprovado ou indexado. Exibir separadamente enviado, aceito, em processamento, publicado e verificado. Alteração posterior pelo canal gera alerta de divergência antes de qualquer reenvio.

Guardar segredos no servidor, separados por conta; nunca na planilha, prompt ou logs. Aplicar isolamento de cliente em consultas, arquivos, tarefas e exportações. Testar explicitamente que usuários de um cliente não acessam outro por trocar IDs.

## 12. Filtros e relatórios

Aplicar a experiência já solicitada: cliente, canal, conta, consultor, analista, anúncio, SKU, categoria, status, escopo, prioridade, vendas, faturamento, margem e período. Combinar condições E/OU, salvar consultas, remover filtros e exportar o conjunto filtrado.

Períodos: hoje, ontem, este mês, mês passado, este ano, ano passado, últimos três meses e personalizado. Definição proposta para últimos três meses: três meses-calendário completos anteriores; últimos 90 dias é opção separada. Exibir sempre as datas resolvidas. Permitir escolher data de venda, criação, otimização ou publicação. Usar fuso do cliente e comparações com intervalos explícitos.

Painel operacional: produtos recebidos, pendências, galerias geradas/aprovadas, anúncios publicados, erros, tempo por etapa e custo de geração. Painel do cliente: o que mudou, justificativa, versão, aprovação e evolução dos resultados.

Métricas de resultado: receita, unidades, conversão, CTR onde houver dados, margem estimada e retorno de Ads com definição da base. Comparações antes/depois devem informar estoque, preço, campanha e sazonalidade; não atribuir causalidade automaticamente. Testes sequenciais não são A/B simultâneo. Deduplicar pedidos por canal/conta/ID para evitar faturamento duplicado.

## 13. Critérios de aceite

1. Importar duas linhas com SKUs iguais de clientes diferentes sem cruzar dados.
2. Importar três cores de um produto, exibir uma foto por linha e manter cada original na variante correta.
3. Reimportar a mesma planilha sem duplicar produtos/pastas; apontar alterações e conflitos por campo.
4. Falta de custo bloqueia preço automático; não impede preparar uma imagem com referência validada.
5. Foto incorreta ou referência contraditória bloqueia produção/publicação da variante afetada.
6. Gerar e abrir arquivos de imagem reais; registrar falha e custo/tentativa quando o provedor falhar.
7. Otimizar somente a ficha sem alterar título, preço, estoque ou imagens.
8. Reprovar qualquer tentativa de preencher MPN/fabricante com termos promocionais não factuais.
9. Aprovar versão 3, editar para versão 4 e comprovar que a aprovação anterior não autoriza o conteúdo alterado.
10. Publicar automaticamente após aprovação válida, sem confirmação redundante; reconciliar por leitura do canal.
11. Simular timeout de criação e demonstrar ausência de anúncio duplicado.
12. Alterar uma variação sem modificar as irmãs; detectar mudança externa ocorrida durante a aprovação.
13. Tratar catálogo/recurso não suportado como pendência identificada, sem retornar sucesso falso.
14. Simular publicação parcial, expiração de credencial e limite do provedor; retomar do ponto correto.
15. Verificar o exemplo de preço, arredondamento, bases percentuais e desconto sem dupla contagem.
16. Aplicar filtros e conferir consistência entre indicadores, tabela e exportação.
17. Confirmar isolamento entre clientes no backend e no acesso aos arquivos.

## 14. Ordem de desenvolvimento

1. Mapear o sistema existente, contas, ERP, banco, permissões e conectores realmente disponíveis. Produzir matriz de capacidades por canal.
2. Implementar identidade, importação, Drive, custos e validações; permitir cadastro e leitura de anúncio existente.
3. Implementar diagnóstico, proposta e provedor real de imagens; testar com produto de referência confirmado.
4. Implementar aprovação, fila e publicação em um canal; testar atualização e criação com escopo autorizado.
5. Implementar reconciliação, métricas, filtros e os demais canais. Ampliar automação somente após comprovar os critérios de aceite.

Dependências a preencher na implementação: repositório e stack; cliente-piloto; conta/canal-piloto; pasta raiz autorizada; planilha inicial; origem de estoque/custo; gerador de imagens; orçamento de geração; aprovadores e política de publicação. Não inventar credenciais ou anunciar integrações como prontas.

## 15. Pedido pronto para enviar ao sistema/desenvolvedor

Implemente no módulo de Anúncios a criação e otimização estratégica de ofertas por cliente, seguindo esta especificação. Primeiro inspecione a arquitetura e reutilize os cadastros, permissões e integrações existentes. Apresente as lacunas técnicas que realmente impedem cada etapa e siga com as partes disponíveis.

O fluxo precisa receber novos produtos ou importar anúncios existentes, vincular uma linha por SKU/variação a fotos reais no Drive, ler custos e calcular preços por canal, diagnosticar oportunidades, preparar textos e ficha factual, gerar/editar imagens por provedor real, exibir antes/depois, registrar aprovação versionada e publicar automaticamente após aprovação válida da operação.

Não entregue somente telas, prompts ou integrações simuladas como se estivessem funcionando. Conclua um fluxo verificável ponta a ponta no canal-piloto, com arquivos gerados, proposta, cálculo, validação, retorno da API, conferência e histórico. Campos não suportados devem ficar claramente identificados. Preserve dados e variações não incluídos na alteração. Use os critérios de aceite deste documento e registre o que foi implementado, testado e o que depende de acesso/configuração.

## Fontes e limites da análise

- Fonte principal: arquivo fornecido `oferta-mkt.skill`, contendo apenas `oferta-mkt/SKILL.md`. Os exemplos de contas/produtos são histórico dessa skill, não comprovação de regras atuais universais.
- Mercado Livre, publicação de produtos: https://developers.mercadolivre.com.br/devcenter/publicacao-de-produtos — consultado em 07/10/2026; adaptar o conector ao fluxo atual, inclusive User Products.
- Mercado Livre, atributos: https://developers.mercadolivre.com.br/pt_br/api-docs-pt-br/atributos — consultar metadados da categoria e representação correta dos atributos.
- Mercado Livre, correções de catálogo: https://vendedores.mercadolivre.com.br/aprender/nota/como-corrigir-as-informacoes-dos-produtos-de-catalogo — conteúdo compartilhado e revisão do canal; página localizada em busca, acesso direto não concluído nesta análise.
- Google Drive, download/exportação: https://developers.google.com/workspace/drive/api/guides/manage-downloads — acesso autorizado ao conteúdo e verificação de permissão de download.

Os fluxos específicos de escrita em Shopee, Amazon e Magalu não foram verificados nesta análise; deverão ser conferidos na documentação oficial e nas permissões da aplicação durante a implementação. Não se presume paridade entre canais.
