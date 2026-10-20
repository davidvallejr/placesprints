# Landing de referência — lp.place2u.com.br/analise-diagnostica (fonte de verdade)

Baixada com `curl` em 16/10/2026. É a página que a landing pública `/diagnostico` (diagnosticomeli.place2u.com.br) reproduz: **mesmos campos** do formulário (Gravity Forms id 65) e a **mesma comunicação**, reescrita com foco no Mercado Livre. Quem mexer em `src/rotas-publicas.js` ou em `CAMPOS_FORMULARIO` (`src/lib/comercial.js`) confere aqui primeiro.

## Textos (tudo o que a página mostra, na ordem)

| Bloco | Texto da referência |
|---|---|
| `<title>` | Análise diagnostica – Place2u |
| Headline (herói, fundo azul-marinho `#112337`, logo branco) | Descubra o que está limitando seus resultados com uma análise diagnóstica. |
| Prova social (5 avatares `aluno01..05.webp`) | +1000 empresas atendidas |
| Prova social, linha 2 | (4.8 de 5) em avaliações |
| Imagem do herói | `marketplacesmelhor.webp` (1047×428) |
| Título do formulário (`gform_title`, Gravity Forms) | Produto gestão - Analise diagnostica |
| Legenda de obrigatórios (`gform_required_legend`) | "*" indica campos obrigatórios |
| Botão | ENVIAR |
| Rodapé | © Todos os direitos Reservados a Place2u. |
| Rodapé | CNPJ: 34.243.829/0001-37 |
| Utilitários do tema | Voltar para o topo · Rolar para cima |

Não existem na referência: subtítulo, parágrafos, bullets de benefícios, FAQ, texto de consentimento/LGPD, placeholders, link de política de privacidade, descrições de campo. Fontes: Poppins. Cores: azul-marinho `#112337`, laranja `#E44919` (botão).

## Campos do formulário (Gravity Forms `gform_65`), na ordem

| # | Rótulo | Tipo | Obrigatório | Opções (valor = rótulo) | Placeholder |
|---|---|---|---|---|---|
| 1 | Nome | text (`input_1`) | sim | — | nenhum |
| 2 | E-mail | email (`input_3`) | sim | — | nenhum |
| 3 | Telefone | tel (`input_4`) | sim | — | nenhum |
| 4 | Nome da empresa | text (`input_6`) | sim | — | nenhum |
| 5 | Nicho em que atua | text (`input_8`) | sim | — | nenhum |
| 6 | Já vende nos marketplaces? Se sim, quais? | checkbox múltiplo (`input_13.1`…`13.8`) | sim | Mercado Livre · Amazon · Americanas marketplace · Shopee · Olist · Magazine Luiza · Outros · Ainda não vendo nos marketplaces | — |
| 7 | Quantos funcionários tem na sua empresa? | select (`input_18`) | sim | 1 a 5 · 6 a 10 · Mais de 10 (sem opção vazia) | — |
| 8 | O faturamento mensal da sua empresa? (Loja Física e online) | select (`input_19`) | sim | Até R$7.000 · R$7mil a R$40mil · R$40mil a R$100mil · R$100mil a R$300mil · R$300mil a R$1 milhão · Acima de R$1 milhão (sem opção vazia) | — |
| — | Botão | submit | — | ENVIAR | — |

Observações: todos os 8 campos levam `gfield_contains_required` (asterisco). Não há campo de consentimento nem honeypot visível (o Gravity Forms usa os campos ocultos `gform_*` próprios).

## Como a landing `/diagnostico` aplica isto

- Os 8 campos, na mesma ordem, com os mesmos rótulos e opções, todos obrigatórios. Os selects ganham uma 1ª opção vazia «Selecione» só para o obrigatório valer de verdade (a referência deixa o 1º valor pré-selecionado).
- A mais, por exigência nossa: consentimento LGPD (obrigatório, texto curto) e honeypot. O envio leva DIRETO ao OAuth do Mercado Livre.
- Nome, e-mail, telefone e empresa vão para as colunas do prospect; nicho, canais, funcionários e faturamento vão para `prospectos.formulario_json` (lista fechada em `CAMPOS_FORMULARIO`, selects validados contra as opções, `limpa` em tudo). Aparecem só no painel Comercial e em «Dados do lead (interno)» do relatório — nunca na página pública nem no dataLayer.
- Comunicação: a headline e a prova social da referência, com o foco trazido para o Mercado Livre (faturamento, visitas, conversão, anúncios, Ads, reputação, estoque/Full), sem números inventados.
