# Levar o Place Sprints para um servidor (checklist)

Hoje o sistema roda neste Mac (porta 3012, launchd, túnel cloudflared). Esta lista diz o que muda num servidor Linux e o que **ainda não está pronto** para isso. Marcado ⚠ = precisa de código antes de migrar.

## 1. O que o servidor precisa ter

| Item | Detalhe |
|---|---|
| Node 22 | o mesmo usado aqui (`~/.local/node/bin`) |
| Compilar `better-sqlite3` | `npm ci` com `build-essential` e `python3` instalados |
| Chrome/Chromium headless | para os PDFs (relatório, diagnóstico, dossiê) |
| Fuso `America/Sao_Paulo` | `TZ=America/Sao_Paulo` no serviço; os horários de terça e sexta dependem disso |
| Disco | banco hoje 391 MB + evidências; reserve ≥ 20 GB |
| Porta 3012 só local | o acesso público entra por proxy ou túnel, nunca expondo a porta |

## 2. ⚠ O que ainda está preso ao Mac

| Ponto | Onde | O que fazer |
|---|---|---|
| ⚠ Caminho do Chrome fixo do macOS | `src/lib/relatorio-pdf.js:15` e `src/server.js` (`servirPdf`) | trocar por variável `CHROME_PATH` com padrão por sistema |
| ⚠ Arquivamento frio usa o Google Drive do Mac + `scripts/bin/frio-evict` (Swift, só macOS) | `scripts/arquivar-evidencias.mjs`, `FRIO_DIR` | no servidor: desligar o frio ou trocar por rclone/S3 |
| ⚠ Backup grava no Drive do Mac | `scripts/backup-banco.mjs`, `BACKUP_DIR` | apontar `BACKUP_DIR` para S3/rclone; a chave fica em `~/.place-sprints/backup.key` |
| ⚠ Word do dossiê usa `textutil` (macOS) | `src/lib/render-dossie.js` | no Linux cai sozinho para `.doc` HTML (já previsto, conferir) |
| launchd | `automacao/*.plist` | virar systemd/cron (tabela abaixo) |

## 3. Agendamentos: launchd → systemd/cron

| Hoje (launchd) | Quando | No servidor |
|---|---|---|
| `com.place2u.place-sprints.servidor` | sempre, reinicia sozinho | serviço systemd com `Restart=always` |
| `com.place2u.place-sprints.vigia` | a cada 5 min | timer systemd ou cron `*/5 * * * *` |
| `com.place2u.place-sprints.backup` | 02:30 | cron `30 2 * * *` |
| `com.place2u.place-sprints.arquivar` | a cada 15 min | desligar ou trocar o destino (§ 2) |
| `com.place2u.place-sprints.git` | 23:30 | cron `30 23 * * *` (precisa de credencial do GitHub no servidor) |
| `com.place2u.place-sprints.semanal` | sexta 17:00 | **não carregar** junto com o relatório automático (o cliente receberia dois) |
| `com.place2u.cloudflared` | sempre | túnel no servidor ou proxy reverso com HTTPS |

Coleta diária (4–6 h), sync do Notion (2/2 h), medição (06 h), plano de terça e relatórios de sexta rodam **dentro** do servidor Node; não precisam de agendamento externo.

## 4. Variáveis de ambiente (só nomes; os valores ficam no `.env` deste Mac)

`PORT` · `PUBLIC_BASE_URL` · `COMERCIAL_PUBLIC_HOST` · `SPRINT90_PUBLIC_HOST` · `MELI_CLIENT_ID` · `MELI_CLIENT_SECRET` · `MELI_CLIENT_ID_COMERCIAL` · `MELI_CLIENT_SECRET_COMERCIAL` · `MELI_TOKEN_KEY` · `MELI_LINK_SECRET` · `NOTION_TOKEN` · `NOTION_VERSION` · `PLACE_GATILHOS_URL` · `PLACE_GATILHOS_SECRET` · `WEBHOOK_SECRET` · `ERP_TOKEN_KEY` · `ANTHROPIC_API_KEY` · `AI_MODEL` · `AI_PRECO_ENTRADA` · `AI_PRECO_SAIDA` · `MP_ACCESS_TOKEN` · `MP_WEBHOOK_SECRET` · `MP_MODO` · `EMAIL_PROVEDOR` · `EMAIL_REMETENTE` · `COMERCIAL_WHATSAPP` · `COMERCIAL_CONTATO_LGPD` · `HEAD_CANAIS_WHATSAPP` · `VIGIA_ENVIO_LIGADO` · `FRIO_DIR` · `BACKUP_DIR`

Copie o `.env` por canal seguro (nunca por chat ou e-mail). **`MELI_TOKEN_KEY` e `ERP_TOKEN_KEY` precisam ser exatamente as mesmas**: sem elas os tokens guardados no banco não abrem e todos os clientes teriam de reconectar.

## 5. Dados que migram

| O quê | Onde | Cuidado |
|---|---|---|
| Banco | `data/db.sqlite` | parar o servidor antes de copiar (ou usar o backup cifrado do dia) |
| Evidências e anexos | `data/evidencias/` e o que já está no frio | o banco aponta `frio:<sha256>` para arquivos no Drive: manter acesso ou trazer de volta |
| Relatórios e dossiês | `data/relatorios/`, `data/dossies/` | |
| Backups de conexões | `data/backups/` | |
| Chave do backup | `~/.place-sprints/backup.key` | sem ela os backups cifrados não abrem |

## 6. Endereços e webhooks que apontam para este Mac

- `meli.place2u.com.br` (callback do Mercado Livre e webhook `/webhook/meli`), `diagnosticomeli.place2u.com.br`, `sprint90.place2u.com.br`: trocar o destino do túnel/DNS para o servidor.
- App do Mercado Livre (DevCenter): o redirect e a URL de notificação continuam iguais se o domínio continuar o mesmo.
- n8n: os recibos voltam para `https://meli.place2u.com.br/webhook/gatilhos/*` — sem mudança se o domínio for mantido.

## 7. Ordem de ligação

1. Resolver os ⚠ da § 2 (Chrome, frio, backup).
2. Instalar Node 22, Chromium, compilar dependências, `TZ`.
3. Copiar `.env` e a chave de backup.
4. Parar o servidor no Mac, copiar `data/` e subir no servidor.
5. Rodar a suíte (`for f in scripts/teste-*.mjs; do node $f || echo FALHOU $f; done`).
6. Apontar o túnel/DNS para o servidor.
7. Conferir `/estrutura` (todas as linhas como antes) e `/api/saude`.
8. Só então desligar os launchd do Mac.
