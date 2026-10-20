#!/bin/bash
# Vigia EXTERNO do Place Sprints (docs/plano-autogestao.md A1; instalação em docs/autogestao-instalar.md).
# Roda pelo launchd a cada 5 min, FORA do Node e sem abrir o banco: o alarme não pode morrer junto com o que vigia (15/10: disco cheio derrubou banco,
# servidor e o próprio sino). Só ferramentas do macOS: curl, df, stat, tail, sed.
#
# Sinais (todos CRÍTICO; atenção fica para o painel do servidor, /integracoes › Saúde do sistema):
#   servidor   GET /api/saude não responde 200 em 10 s
#   disco      livre < VIGIA_DISCO_CRITICO_GB (5)
#   batimento  data/batimento.json (o servidor reescreve a cada minuto) mais velho que VIGIA_BATIMENTO_MAX_MIN (15) — processo travado/caído
#   coleta     última coleta do ML (campo coleta_ml_s do batimento) mais velha que VIGIA_COLETA_MAX_H (30)
#   log        data/server.log sem escrita há mais de VIGIA_LOG_MAX_H (6)
# Aviso: na MUDANÇA para crítico (e «normalizado» na volta, se tinha avisado), no máximo 1 por sinal por hora (data/vigia.estado; envio que falhou tenta de novo
#   no ciclo seguinte enquanto continuar crítico), pelo webhook do n8n que já
#   existe (PLACE_GATILHOS_URL + /webhook/place-gatilhos, cabeçalho x-place-key) com tipo «incidente», interno: Discord do time (VIGIA_DISCORD_WEBHOOK) e WhatsApp do
#   Head de canais (HEAD_CANAIS_WHATSAPP) — D-A3: crítico toca a qualquer hora. SEM VIGIA_ENVIO_LIGADO=1 é DRY-RUN: monta, registra no log e não envia.
# Também: rotação de data/server.log (> 20 MB → últimos 5 MB em server.log.1 e trunca no lugar; o servidor segue escrevendo) e de data/vigia.log (≤ 1 MB).
# Segredo nunca vai para a linha de comando (cabeçalho por substituição de processo) nem para o log; destinos também não.
set -u
PS_DIR="${PS_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
DADOS="$PS_DIR/data"
ENV_ARQ="${VIGIA_ENV_ARQUIVO:-$PS_DIR/.env}"
# lê do .env só as chaves usadas (sem `source`: o .env nunca é executado); variável de ambiente já definida vence
lerenv() { local v; eval "v=\${$1:-}"; if [ -z "$v" ] && [ -r "$ENV_ARQ" ]; then v=$(sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$ENV_ARQ" | tail -n 1 | sed -e 's/^["'"'"']//' -e 's/["'"'"'][[:space:]]*$//'); fi; printf '%s' "$v"; }

URL="${VIGIA_URL:-http://127.0.0.1:3012/api/saude}"
DISCO_CRIT_GB="${VIGIA_DISCO_CRITICO_GB:-5}"
BAT_MAX_MIN="${VIGIA_BATIMENTO_MAX_MIN:-15}"
COLETA_MAX_H="${VIGIA_COLETA_MAX_H:-30}"
LOG_MAX_H="${VIGIA_LOG_MAX_H:-6}"
INTERVALO_AVISO="${VIGIA_AVISO_INTERVALO_S:-3600}"
AGORA="${VIGIA_AGORA:-$(date +%s)}"
ESTADO="$DADOS/vigia.estado"; VLOG="$DADOS/vigia.log"; SLOG="$DADOS/server.log"
mkdir -p "$DADOS"

vlog() { printf '%s %s\n' "$(date -u -r "$AGORA" +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$VLOG" 2>/dev/null; }
mtime() { stat -f %m "$1" 2>/dev/null || echo 0; }
tamanho() { stat -f %z "$1" 2>/dev/null || echo 0; }

# ── rotação (antes de tudo: num disco cheio, o log é o primeiro a ceder; nunca dado) ──
if [ "$(tamanho "$SLOG")" -gt 20971520 ]; then tail -c 5242880 "$SLOG" > "$SLOG.1" 2>/dev/null; : > "$SLOG"; vlog "rotacao server.log (>20 MB): ultimos 5 MB em server.log.1"; fi
if [ "$(tamanho "$VLOG")" -gt 1048576 ]; then tail -c 524288 "$VLOG" > "$VLOG.tmp" 2>/dev/null && mv "$VLOG.tmp" "$VLOG" || : > "$VLOG"; fi

# ── sinais: "sinal nivel valor" ──
SINAIS=""
add() { SINAIS="$SINAIS$1 $2 $3
"; }
cod=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$URL" 2>/dev/null); [ "$cod" = "200" ] && add servidor ok "$cod" || add servidor critico "http_${cod:-000}"
livre_kb=$(df -k "$DADOS" 2>/dev/null | awk 'NR==2{print $4}'); livre_kb=${livre_kb:-0}
livre_gb=$(awk -v k="$livre_kb" 'BEGIN{printf "%.1f", k/1048576}')
awk -v k="$livre_kb" -v c="$DISCO_CRIT_GB" 'BEGIN{exit !(k < c*1048576)}' && add disco critico "${livre_gb}GB" || add disco ok "${livre_gb}GB"
BAT="$DADOS/batimento.json"
if [ -f "$BAT" ]; then
  idade=$(( (AGORA - $(mtime "$BAT")) / 60 )); [ "$idade" -gt "$BAT_MAX_MIN" ] && add batimento critico "${idade}min" || add batimento ok "${idade}min"
  col=$(sed -n 's/.*"coleta_ml_s":\([0-9]*\).*/\1/p' "$BAT")
  if [ -n "$col" ] && [ "$col" -gt 0 ]; then ih=$(( (AGORA - col) / 3600 )); [ "$ih" -gt "$COLETA_MAX_H" ] && add coleta critico "${ih}h" || add coleta ok "${ih}h"; fi
else add batimento critico "sem_arquivo"; fi
if [ -f "$SLOG" ]; then lh=$(( (AGORA - $(mtime "$SLOG")) / 3600 )); [ "$lh" -gt "$LOG_MAX_H" ] && add log critico "${lh}h" || add log ok "${lh}h"; fi

rotulo() { case "$1" in servidor) echo "Servidor fora do ar (porta 3012 sem resposta)";; disco) echo "Disco quase cheio";; batimento) echo "Servidor travado (sem batimento)";;
  coleta) echo "Coleta do Mercado Livre parada";; log) echo "Servidor sem escrever log";; *) echo "$1";; esac; }
sistema() { case "$1" in coleta|disco) echo "Trinity";; *) echo "Morpheus";; esac; }

# ── envio pelo n8n (tipo incidente, interno). Nunca imprime segredo nem destino. ──
enviar() { # $1 sinal $2 texto
  local base secret dw wa canais corpo cod2
  base=$(lerenv PLACE_GATILHOS_URL); base="${base%/}"; secret=$(lerenv PLACE_GATILHOS_SECRET)
  dw=$(lerenv VIGIA_DISCORD_WEBHOOK); wa=$(lerenv HEAD_CANAIS_WHATSAPP | tr -cd '0-9')
  canais=""
  printf '%s' "$dw" | grep -Eq '^https://(discord\.com|discordapp\.com)/api/webhooks/[0-9]+/[A-Za-z0-9_-]+$' && canais="\"discord\":{\"ligado\":true,\"destino\":\"$dw\"}"
  [ -n "$wa" ] && canais="${canais:+$canais,}\"whatsapp\":{\"ligado\":true,\"destino\":\"$wa\"}"
  corpo="{\"lote_id\":\"incidente-$1-$AGORA\",\"tipo\":\"incidente\",\"interno\":true,\"assunto\":\"Incidente do Place Sprints\",\"texto\":\"$2\",\"texto_html\":\"\",\"link\":\"\",\"canais\":{$canais},\"discord_partes\":[\"$2\"],\"whatsapp_partes\":[\"$2\"],\"discord_mencionar\":[],\"discord_mencionar_cargos\":[\"1517119651522547774\"]}"
  if [ "$(lerenv VIGIA_ENVIO_LIGADO)" != "1" ]; then vlog "[dry-run] aviso $1 montado e NAO enviado (VIGIA_ENVIO_LIGADO!=1): $2"; return 0; fi
  if [ -z "$base" ] || [ "${#secret}" -lt 32 ]; then vlog "aviso $1 NAO enviado: n8n nao configurado (PLACE_GATILHOS_URL/SECRET)"; return 1; fi
  if [ -z "$canais" ]; then vlog "aviso $1 NAO enviado: sem destino (VIGIA_DISCORD_WEBHOOK / HEAD_CANAIS_WHATSAPP)"; return 1; fi
  cod2=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -X POST -H 'content-type: application/json' -H @<(printf 'x-place-key: %s\n' "$secret") --data-binary "$corpo" "$base/webhook/place-gatilhos" 2>/dev/null)
  case "$cod2" in 2*) vlog "aviso $1 enviado (n8n $cod2)"; return 0;; *) vlog "aviso $1 FALHOU (n8n ${cod2:-000})"; return 1;; esac
}

# ── transições com estado em arquivo (fora do banco): "sinal nivel desde ultimo_aviso" ──
NOVO=""
while read -r s nivel valor; do
  [ -z "$s" ] && continue
  ant=$(grep "^$s " "$ESTADO" 2>/dev/null | head -n 1); antn=$(echo "$ant" | awk '{print $2}'); desde=$(echo "$ant" | awk '{print $3}'); ult=$(echo "$ant" | awk '{print $4}'); pend=$(echo "$ant" | awk '{print $5}')
  antn=${antn:-ok}; desde=${desde:-$AGORA}; ult=${ult:-0}; pend=${pend:-0}
  [ "$nivel" != "$antn" ] && desde=$AGORA
  # aviso na MUDANÇA para crítico; se o envio falhou (n8n fora), tenta de novo a cada ciclo enquanto continuar crítico (pend=1) — nada foi entregue, então não é repetição
  if [ "$nivel" = "critico" ] && { [ "$antn" != "critico" ] || [ "$pend" = "1" ]; }; then
    if [ "$pend" = "1" ] || [ $((AGORA - ult)) -ge "$INTERVALO_AVISO" ]; then
      txt=$(printf '%s · CRITICO: %s (%s). Dono: Head de canais. Painel: /integracoes' "$(sistema "$s")" "$(rotulo "$s")" "$valor" | tr -d '"\\')
      if enviar "$s" "$txt"; then ult=$AGORA; pend=0; else pend=1; fi
    else vlog "critico $s ($valor): aviso suprimido (ja avisado ha menos de 1 h)"; fi
  elif [ "$nivel" = "ok" ] && [ "$antn" = "critico" ]; then
    vlog "normalizado $s ($valor)"; pend=0
    if [ "$ult" -gt 0 ] && [ $((AGORA - ult)) -lt 86400 ]; then enviar "$s" "$(sistema "$s") · normalizado: $(rotulo "$s") ($valor)." >/dev/null; fi
  fi
  NOVO="$NOVO$s $nivel $desde $ult $pend
"
done <<EOF
$SINAIS
EOF
printf '%s' "$NOVO" > "$ESTADO.tmp" && mv "$ESTADO.tmp" "$ESTADO"
crit=$(printf '%s' "$SINAIS" | awk '$2=="critico"{printf "%s=%s ", $1, $3}')
[ -n "$crit" ] && vlog "ciclo: CRITICO $crit" || vlog "ciclo: ok"
exit 0
