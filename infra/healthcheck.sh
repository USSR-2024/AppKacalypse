#!/usr/bin/env bash
# healthcheck.sh — проверка живости стека. Код выхода != 0 при любой ошибке.
# Запускать на сервере из корня репозитория.
set -uo pipefail

# shellcheck disable=SC1091
[ -f .env ] && set -a && . ./.env && set +a

FAIL=0
check() {
  printf "%-22s " "$1"
  if eval "$2" >/dev/null 2>&1; then echo "OK"; else echo "FAIL"; FAIL=1; fi
}

echo "=== AppKacalypse healthcheck ==="
check "postgres"      "docker compose exec -T postgres pg_isready -U ${POSTGRES_USER:-task_dispatcher}"
check "valkey"        "docker compose exec -T valkey valkey-cli ping"
check "vikunja http"  "docker compose exec -T vikunja wget -qO- http://localhost:3456/api/v1/info"
check "n8n http"      "docker compose exec -T n8n wget -qO- http://localhost:5678/healthz"
check "llm-gateway"   "docker compose exec -T llm-gateway python -c \"import urllib.request; urllib.request.urlopen('http://localhost:8000/health')\""
check "ollama"        "docker compose exec -T ollama ollama list"
check "ollama model"  "docker compose exec -T ollama ollama list | grep -q '${OLLAMA_MODEL:-qwen3:14b%%:*}'"

if [ "${CALENDAR_PROVIDER:-disabled}" != "disabled" ]; then
  check "calendar"    "docker compose exec -T llm-gateway python -c \"import urllib.request; urllib.request.urlopen('http://localhost:8000/health/calendar')\""
fi

echo "================================"
[ "$FAIL" -eq 0 ] && echo "ВСЁ ОК" || echo "ЕСТЬ ПРОБЛЕМЫ"
exit "$FAIL"
