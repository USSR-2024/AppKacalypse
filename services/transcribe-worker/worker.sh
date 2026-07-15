#!/usr/bin/env bash
# Хостовый воркер ПРОТОКОЛОВ (akc-transcribe-worker).
# Поллит бэкенд, гоняет protocol.py (qwen в ollama) + PDF, шлёт результат.
# Живёт на 158 в /root/transcribe. Бэкенду docker.sock не даём — поэтому пайплайн тут, на хосте.
#
# Транскрибация сюда БОЛЬШЕ НЕ ХОДИТ: она переехала в GPU-агент (caption-agent),
# где large-v3 уже висит резидентно ради субтитров — второй копии в VRAM не держим.
# Приоритет (субтитры > расшифровка > протокол) обеспечивает бэкенд: /claim не
# отдаёт задач, пока идёт встреча с включёнными субтитрами.
#
# Файлы задачи (общий том с бэком): /root/transcribe/data/<id>/
#   audio.*        — загруженное аудио (пишет бэкенд)
#   transcript.txt — читаемый транскрипт (пишет GPU-агент) → бэкенд отдаёт на скачивание
#   protocol.md    — протокол встречи (пишет воркер)
set -uo pipefail

DIR=/root/transcribe
DATA="$DIR/data"
API="${BACKEND_URL:-http://127.0.0.1:8081}/api/transcribe-worker"
TOKEN="$(cat "$DIR/worker_token")"
POLL="${POLL_INTERVAL:-10}"

log() { echo "[worker $(date -u +%H:%M:%S)] $*"; }

claim() { curl -s -m 20 -X POST "$API/claim?kind=protocol" -H "X-Worker-Token: $TOKEN"; }

# report <id> <kind> <true|false> [error]
report() {
  curl -s -m 20 -o /dev/null -X POST "$API/$1/result" \
    -H "X-Worker-Token: $TOKEN" -H 'content-type: application/json' \
    -d "$(jq -nc --arg k "$2" --argjson ok "$3" --arg e "${4:-}" \
      '{kind:$k, ok:$ok} + (if $e=="" then {} else {error:$e} end)')"
}

# Протокол: transcript.txt → qwen3:14b (Ollama) → protocol.md
protocol_job() {
  local id="$1" d="$DATA/$id"
  # Пустой транскрипт до модели не доводим. Иначе она сочиняет встречу целиком:
  # выдуманные участники, темы и решения — и это выглядит как настоящий протокол.
  if [ ! -s "$d/transcript.txt" ]; then
    report "$id" protocol false "пустой транскрипт — протокол не из чего составлять"
    return
  fi
  local oip; oip="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' appkacalypse-ollama-1 2>/dev/null)"
  if [ -z "$oip" ]; then report "$id" protocol false "ollama-контейнер не найден"; return; fi
  if OLLAMA_URL="http://${oip}:11434" python3 "$DIR/protocol.py" "$d/transcript.txt" "$d/protocol.md"; then
    # PDF рядом с .md (не критично: если не собрался — протокол всё равно готов)
    "$DIR/venv/bin/python3" "$DIR/md2pdf.py" "$d/protocol.md" "$d/protocol.pdf" || log "PDF не собрался (id=$id)"
    report "$id" protocol true
  else
    report "$id" protocol false "ошибка составления протокола"
  fi
}

log "старт, API=$API, poll=${POLL}s"
while true; do
  job="$(claim)"
  kind="$(echo "$job" | jq -r '.kind // empty' 2>/dev/null)"
  id="$(echo "$job" | jq -r '.id // empty' 2>/dev/null)"
  if [ -z "$kind" ] || [ -z "$id" ]; then sleep "$POLL"; continue; fi
  lang="$(echo "$job" | jq -r '.lang // "auto"' 2>/dev/null)"
  log "взял задачу: $kind id=$id lang=$lang"
  case "$kind" in
    protocol) protocol_job "$id" ;;
    *)        log "неожиданный тип задачи '$kind' — пропускаю" ;;
  esac
  log "завершил: $kind id=$id"
done
