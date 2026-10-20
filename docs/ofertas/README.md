# Ofertas estratégicas por cliente — onde está cada coisa

| O quê | Onde |
|---|---|
| Especificação funcional (a sua, de 07/10/2026) | `docs/ofertas/ESPECIFICACAO-ofertas-estrategicas.md` (cópia do arquivo do Desktop) |
| Método original (skill `oferta-mkt`: GATE 0, molde, ficha avulsa, lições) | `docs/ofertas/oferta-mkt-SKILL.md` |
| Matriz de capacidades, critérios de aceite 1–17 e pendências | `docs/ofertas-estrategicas.md` (gerado no fim da implementação do backend) |
| Dados (12 tabelas `of_*`) | `src/lib/ofertas-schema.js` |
| Entidades, importação, jobs, versões, aprovação, auditoria | `src/lib/ofertas.js` |
| Preço e viabilidade (centavos, composição, bloqueios) | `src/lib/ofertas-preco.js` |
| Diagnóstico em 5 lentes e proposta versionada | `src/lib/ofertas-diagnostico.js` |
| Adaptador Mercado Livre (dry-run, diff, publicação segura, conferência) | `src/lib/ofertas-ml.js` |
| Provedor de imagens (pendente sem chave) e Drive (pendente) | `src/lib/ofertas-imagens.js` |
| Fluxo ponta a ponta (importar → preparar → aprovar → publicar → conferir → monitorar) | `src/lib/ofertas-fluxo.js` |
| Rotas HTTP `/api/ofertas/*` | `src/rotas-ofertas.js` |
| Parâmetros (termos proibidos, arredondamento, galeria padrão) | `config/ofertas.json` |
| Testes | `scripts/teste-ofertas-*.mjs` |
| Tela: Cliente → aba Anúncios (Novo produto · Importar planilha · Importar anúncio · Otimizar selecionados · Fila) | `src/web/cliente.js` + `src/web/ofertas.js` (entra depois do redesenho das telas) |

Regra do projeto (`CLAUDE.md`): o módulo não tem motor próprio — as propostas viram ações do plano (`acoes_plano`, regras `oferta_*`), passam pelo Notion, pelo vínculo com o anúncio e pela medição do Merovíngio.
