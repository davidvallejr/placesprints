#!/bin/zsh
# Runner contínuo do arquivamento em streaming (docs/autogestao-instalar.md §2). Chamado pelo launchd a cada 15 min
# (automacao/com.place2u.place-sprints.arquivar.plist). Uma passada por vez (trava em data/arquivar.lock com o PID).
# Roda lotes seguidos enquanto houver progresso; sem progresso (Drive lento, disco < 1 GB, falhas) sai e tenta no próximo disparo.
# «movíveis: 0» → para sozinho (bootout do próprio job; reinstalar = launchctl bootstrap de novo). Log: data/arquivar.log (o .mjs grava e rotaciona).
export PATH="$HOME/.local/node/bin:$PATH"
RAIZ="${0:A:h:h}"; cd "$RAIZ" || exit 1
LOG="$RAIZ/data/arquivar.log"; TRAVA="$RAIZ/data/arquivar.lock"; LABEL="com.place2u.place-sprints.arquivar"
log() { print -r -- "$(date -u +%Y-%m-%dT%H:%M:%SZ) [loop] $*" >> "$LOG"; }
if [ -f "$TRAVA" ] && kill -0 "$(cat "$TRAVA" 2>/dev/null)" 2>/dev/null; then exit 0; fi   # outra passada rodando
echo $$ > "$TRAVA"; trap 'rm -f "$TRAVA"' EXIT
for i in {1..200}; do                                   # ponytail: teto de lotes por disparo só como trava de segurança
  node scripts/arquivar-evidencias.mjs --confirmar ${=ARQUIVAR_ARGS:-} > /dev/null 2>> "$LOG"; rc=$?
  case $rc in
    0) continue ;;
    10) log "movíveis: 0 — arquivamento concluído; parando o agendamento"; rm -f "$TRAVA"
        [ -z "${ARQUIVAR_SEM_BOOTOUT:-}" ] && launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null; exit 0 ;;
    11) log "sem progresso neste lote — nova tentativa no próximo disparo"; exit 0 ;;
    *) log "saída inesperada ($rc) — nova tentativa no próximo disparo"; exit 0 ;;
  esac
done
