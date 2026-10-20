#!/bin/zsh
export PATH="$HOME/.local/node/bin:$PATH"
cd "${PS_DIR:-$HOME/place-sprints}"
# freio de disco (autogestão A1, 15/10/2026): com menos de 1 GB livre o servidor NÃO sobe — o banco não abre e cada reinício do launchd escreveria o erro
# em data/server.log, enchendo mais o disco. O motivo é escrito UMA vez (marcador data/.freio-disco); espera 60 s antes de sair para o laço do launchd ser lento.
livre_kb=$(df -k data 2>/dev/null | awk 'NR==2{print $4}')
if [ -n "$livre_kb" ] && [ "$livre_kb" -lt "${PS_FREIO_KB:-1048576}" ]; then
  if [ ! -f data/.freio-disco ]; then
    : > data/.freio-disco 2>/dev/null
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [erro] freio de disco: $((livre_kb / 1024)) MB livres (< 1 GB) — servidor NAO iniciado; libere espaco (docs/autogestao-instalar.md)" 2>/dev/null
  fi
  sleep "${PS_FREIO_ESPERA:-60}"
  exit 75
fi
rm -f data/.freio-disco
exec node src/server.js
