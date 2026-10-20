# Autogestão — o que instalar e configurar (David)

Construído em 15/10/2026 a partir das «3 primeiras ações» de `docs/plano-autogestao.md` e das decisões D-A1, D-A2, D-A3 e D-C1. Em 15/10 (noite) foram instalados no launchd o arquivamento em streaming (§2) e o backup (§3); o resto não foi instalado, ligado nem enviado: os comandos abaixo são para você rodar no Terminal, na ordem.

| Peça | Arquivo | Nasce |
|---|---|---|
| Vigia externo (5 min, fora do Node e do banco) | `scripts/vigia.sh` + `automacao/com.place2u.place-sprints.vigia.plist` | dry-run: monta o aviso e grava em `data/vigia.log` |
| Supervisor do servidor | `automacao/com.place2u.place-sprints.servidor.plist` (ThrottleInterval 30 s) + freio de disco em `scripts/dev.sh` (< 1 GB não sobe) | não instalado |
| Saúde do sistema + incidentes | `src/lib/saude-sistema.js`, `saude-sistema-real.js`, `src/rotas-saude-sistema.js` (`GET /api/saude`), painel `#secSaudeSistema` em `/integracoes`, `config/autogestao.json` | entra no próximo reinício do servidor |
| Auto-curas | nova tentativa do Notion em timeout/rede (`sync.js`), sync incremental a cada 2 h com teto de 20 min, «sem token» 3× = incidente, n8n 502/timeout/rede = `erro`, medição diária às 06h | entra no próximo reinício |
| WhatsApp do Head no crítico | `config/autogestao.json → whatsapp_critico_ligado` | **false** |
| Arquivamento para o frio | `scripts/arquivar-evidencias.mjs` (modo streaming) + `scripts/frio-evict.swift` → `scripts/bin/frio-evict` + `scripts/arquivar-loop.sh` + `automacao/com.place2u.place-sprints.arquivar.plist` (15 min) | **instalado no launchd em 15/10** (para sozinho no fim) |
| Backup cifrado | `scripts/backup-banco.mjs` + `automacao/com.place2u.place-sprints.backup.plist` (02:30) | **plist instalado em 15/10** (1º backup às 02:30) |

Prévia de hoje (15/10, só leitura): **56.024 anexos = 23,89 GB liberáveis** (mais de 30 dias e com sha256 no livro); 6.571 recentes (5,37 GB) ficam; nenhum anexo local sem hash no livro. `data/relatorios` (1 GB) é todo de outubro e não tem hash no livro: não entra. Banco + WAL: 335 MB. Disco livre: ~2,6 GB.

---

## 1. Google Drive (D-A1, D-A2)

1. Instale o **Google Drive para computador** e entre com a conta da Place2u.
2. Preferências → Google Drive → **«Fazer streaming de arquivos»** (NÃO «Espelhar»: no espelho o arquivo continua inteiro no disco do Mac e mover para lá não libera nada — o script avisa «mesmo disco» e recusa).
3. Crie duas pastas no Meu Drive: `place-sprints-frio` e `place-sprints-backup` (a de backup só com você e o Head de canais).
4. No `.env` do projeto (ajuste a conta no caminho):

```
FRIO_DIR=/Users/davidvallejr/Library/CloudStorage/GoogleDrive-david@place2u.com.br/Meu Drive/place-sprints-frio
BACKUP_DIR=/Users/davidvallejr/Library/CloudStorage/GoogleDrive-david@place2u.com.br/Meu Drive/place-sprints-backup
```

Confira: `ls "$(grep ^FRIO_DIR ~/place-sprints/.env | cut -d= -f2-)"` não pode dar erro.

## 2. Liberar o disco (arquivamento em streaming — instalado em 15/10/2026)

O Drive em «Fazer streaming» fica em `~/Library/CloudStorage/…`, que é o **mesmo volume** do Mac (File Provider): o arquivo copiado ocupa o cache local até subir e só deixa o disco quando é **despejado** (evict). Por isso o script entra sozinho no modo `--streaming` quando o `FRIO_DIR` está em `~/Library/CloudStorage/` (o aviso «mesmo disco» só vale fora do streaming).

Cada passada = 1 lote de no máximo `--max-gb` (padrão 0,4):

1. copia o lote para o Drive e confere o sha256 no destino (igual ao modo normal; só anexos > 30 dias com sha256 no livro que confere);
2. espera o Drive subir cada arquivo (`ubiquitousItemIsUploaded`), consultando a cada `--intervalo-s` (30) até o teto `--espera-min` (120);
3. despeja (evict) e confere «alocado ≈ 0» (≤ 64 KB e ≤ metade do arquivo);
4. **só então** grava `frio:<sha256>.<ext>` no banco e remove o original do Mac.

O que não subir no teto **fica**: cópia no Drive, original no Mac, banco igual — volta na próxima passada (a cópia já existente é reconferida pelo hash). Disco livre nunca abaixo de 1 GB (`--min-livre-gb`, mínimo 1): para antes de copiar. Saída: 0 = moveu, 10 = nada movível, 11 = sem progresso. Log com hora em `data/arquivar.log` (> 1 MB → últimos 512 KB).

Ajudante nativo (já compilado; recompile se trocar de Mac ou de macOS):

```
cd ~/place-sprints && swiftc -O scripts/frio-evict.swift -o scripts/bin/frio-evict
scripts/bin/frio-evict status "<arquivo no Drive>"     # JSON: uploaded, uploading, download, alocado
```

Sem o binário, o script usa `swift scripts/frio-evict.swift` (interpretado, lento).

Runner contínuo (instalado): `scripts/arquivar-loop.sh` pelo launchd a cada 15 min, uma passada por vez (trava `data/arquivar.lock` com o PID). Roda lotes seguidos enquanto houver progresso; sem progresso sai e tenta no próximo disparo; em «movíveis: 0» faz `bootout` de si mesmo (no próximo login ele volta, roda, e se não houver nada sai de novo). Para passar argumentos: variável `ARQUIVAR_ARGS` no plist (ex.: `--max-gb 0.8`).

```
tail -n 20 ~/place-sprints/data/arquivar.log                                     # acompanhar
launchctl print gui/$(id -u)/com.place2u.place-sprints.arquivar | grep -E "state|runs|last exit"
launchctl kickstart gui/$(id -u)/com.place2u.place-sprints.arquivar              # rodar agora
launchctl bootout gui/$(id -u)/com.place2u.place-sprints.arquivar                # desligar
cp ~/place-sprints/automacao/com.place2u.place-sprints.arquivar.plist ~/Library/LaunchAgents/ && launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.place2u.place-sprints.arquivar.plist   # religar
```

Manual (prévia sempre segura): `node scripts/arquivar-evidencias.mjs` · uma passada: `node scripts/arquivar-evidencias.mjs --confirmar --max-gb 0.3`.

Velocidade: quem manda é a fila do Drive. Com o Drive também fazendo o backup de Mesa/Documentos/Downloads do Mac, a fila anda devagar — pause esse backup do Mac nas Preferências do Drive (ou deixe-o terminar) para o frio andar mais rápido.

Lições de 15/10: (1) o núcleo do Drive tinha caído às 11h05 por **disco cheio** (`SQLITE_FULL` em `~/Library/Application Support/Google/DriveFS/Logs/drive_fs.txt`) e nada subia — os arquivos ficavam «uploading» para sempre; foi preciso reabrir o Google Drive, que recriou o domínio e deixou as pastas antigas, nunca enviadas, em `~/Library/CloudStorage/GoogleDrive-… (data hora)` (as cópias verificadas foram devolvidas para o `place-sprints-frio` novo e as duas pastas recriadas). Se o log ficar parado em «0/N prontos», olhe esse log e reabra o Drive; nada é removido do Mac enquanto isso. (2) Anexos com o mesmo conteúdo dividem o mesmo `<sha256>.<ext>`: o script nunca regrava por cima de um item despejado (o `rename` trava no File Provider); se o blob já está referenciado por `frio:` no banco, é reaproveitado sem baixar, senão é relido (baixado) e conferido.

Garantias: o dossiê e os relatórios leem o frio pelo `src/lib/frio.js` (um arquivo despejado é baixado na hora em que é aberto); com o Drive fora do ar, o print aparece como anexo indisponível, nunca quebra. Rodar de novo é seguro (idempotente).

## 3. Backup cifrado do banco

```
node scripts/backup-banco.mjs                # prévia: tamanho, espaço (exige 2× o banco + 1 GB livres), BACKUP_DIR, chave
node scripts/backup-banco.mjs --confirmar    # 1º backup: cria ~/.place-sprints/backup.key (0600)
```

**Guarde a chave fora do Drive** (o arquivo `~/.place-sprints/backup.key` — copie para um pendrive seu ou anexe no cofre de senhas; não mande por WhatsApp/e-mail). Sem ela o backup não abre; ela nunca é impressa.

Teste de restauração (mensal, nunca sobre `data/db.sqlite`):

```
node scripts/backup-banco.mjs --decifrar "$BACKUP_DIR/place-sprints-AAAA-MM-DDTHHMM.db.enc" --para /tmp/restaurado.sqlite
sqlite3 -readonly /tmp/restaurado.sqlite "select count(*) from tarefas; pragma quick_check;" && rm /tmp/restaurado.sqlite
```

Agendar 1×/dia (02:30, retenção 14):

```
cp ~/place-sprints/automacao/com.place2u.place-sprints.backup.plist ~/Library/LaunchAgents/
plutil -lint ~/Library/LaunchAgents/com.place2u.place-sprints.backup.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.place2u.place-sprints.backup.plist
launchctl kickstart gui/$(id -u)/com.place2u.place-sprints.backup && sleep 60 && tail -n 5 ~/place-sprints/data/backup.log
```

Em 15/10 o plist foi instalado (prévia: banco + WAL 360 MB, exigido ≥ 1,7 GB livres → ok); o 1º backup roda às 02:30 e cria a chave. Com o Drive em streaming, cada backup despeja do cache do Mac os backups anteriores que já subiram (o de hoje sai amanhã).

## 4. Servidor sob o launchd (na janela combinada de reinício)

Igual ao roteiro do próprio plist, agora com ThrottleInterval 30 s e o freio de disco do `dev.sh`. Este reinício também liga a Saúde do sistema, o log com hora ISO e as auto-curas.

```
lsof -nP -iTCP:3012 -sTCP:LISTEN                                   # PID do nohup atual
cp ~/place-sprints/automacao/com.place2u.place-sprints.servidor.plist ~/Library/LaunchAgents/
plutil -lint ~/Library/LaunchAgents/com.place2u.place-sprints.servidor.plist
kill <PID>; while lsof -nP -iTCP:3012 -sTCP:LISTEN >/dev/null; do sleep 1; done
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.place2u.place-sprints.servidor.plist
launchctl print gui/$(id -u)/com.place2u.place-sprints.servidor | grep -E "state|pid"
curl -s http://127.0.0.1:3012/api/saude | head -c 400; echo
tail -n 20 ~/place-sprints/data/server.log                        # linhas agora começam com a hora ISO
```

Depois disso: reiniciar = `launchctl kickstart -k gui/$(id -u)/com.place2u.place-sprints.servidor`; desligar = `launchctl bootout gui/$(id -u)/com.place2u.place-sprints.servidor`. Se um dia voltar ao nohup, use `>>` (append) no redirecionamento do log, para a rotação do vigia funcionar.

## 5. Vigia externo

```
cp ~/place-sprints/automacao/com.place2u.place-sprints.vigia.plist ~/Library/LaunchAgents/
plutil -lint ~/Library/LaunchAgents/com.place2u.place-sprints.vigia.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.place2u.place-sprints.vigia.plist
sleep 5; tail -n 5 ~/place-sprints/data/vigia.log; cat ~/place-sprints/data/vigia.estado
```

Ele nasce em **dry-run** (escreve «[dry-run] aviso … montado e NAO enviado»). Para ligar o envio, no `.env`:

```
VIGIA_DISCORD_WEBHOOK=https://discord.com/api/webhooks/<id>/<token>   # canal do time (Head de canais é marcado)
HEAD_CANAIS_WHATSAPP=55DDNNNNNNNNN                                     # WhatsApp do Head de canais (D-A3: só crítico, a qualquer hora)
VIGIA_ENVIO_LIGADO=1
```

O vigia usa o mesmo webhook do n8n dos gatilhos (`PLACE_GATILHOS_URL` + `/webhook/place-gatilhos`, cabeçalho `x-place-key`) com `tipo: "incidente"`. No n8n, reimporte `automacao/n8n/place-gatilhos-entrega.json` ou, no nó «Montar recibo», troque `if (o.tipo === 'teste') return;` por `if (o.tipo === 'teste' || o.tipo === 'incidente') return;` (incidente não tem lote no Place Sprints; sem isso o recibo volta 422 e a execução fica marcada como erro, mas a mensagem sai).

Sinais do vigia (todos crítico): servidor sem resposta em `/api/saude`, disco < 5 GB, `data/batimento.json` sem atualizar há 15 min, última coleta do ML há mais de 30 h, `data/server.log` parado há 6 h. Avisa na mudança para crítico (e «normalizado» na volta), no máximo 1 por sinal por hora; envio que falhou tenta de novo a cada ciclo. Também roda a rotação: `data/server.log` > 20 MB → últimos 5 MB em `server.log.1`; `data/vigia.log` ≤ 1 MB. Limiares por variável de ambiente no plist (`VIGIA_DISCO_CRITICO_GB`, `VIGIA_COLETA_MAX_H`, …).

Teste de fogo (com o envio ligado): `VIGIA_DISCO_CRITICO_GB=100000 VIGIA_AGORA=$(date +%s) bash ~/place-sprints/scripts/vigia.sh` → chega o aviso «Disco quase cheio»; rode de novo sem a variável → «normalizado».

## 6. WhatsApp do Head no incidente crítico vindo do servidor

`config/autogestao.json → "whatsapp_critico_ligado": true` (com `HEAD_CANAIS_WHATSAPP` no `.env`) e reiniciar o servidor. Desligada, o servidor só registra o incidente no painel e no sino. Com o vigia já enviando, servidor fora, disco e coleta parada chegam pelos dois (o servidor cobre também Notion, n8n, «sem token» e medição); se a duplicata incomodar, deixe esta chave desligada.

## Desligar tudo

```
launchctl bootout gui/$(id -u)/com.place2u.place-sprints.vigia
launchctl bootout gui/$(id -u)/com.place2u.place-sprints.backup
launchctl bootout gui/$(id -u)/com.place2u.place-sprints.servidor      # e volte ao nohup (com >>)
```
