#!/usr/bin/env bash
# restore.sh — восстановление PostgreSQL из бэкапа.
# Использование: infra/restore.sh backups/pg-task_dispatcher-YYYYMMDD-HHMMSS.sql.gz
# Запускать на сервере, где поднят docker compose. ВНИМАНИЕ: перезаписывает БД.
set -euo pipefail

FILE="${1:?Укажи файл бэкапа: infra/restore.sh <file.sql.gz>}"
[ -f "$FILE" ] || { echo "Нет файла: $FILE"; exit 1; }

# shellcheck disable=SC1091
[ -f .env ] && set -a && . ./.env && set +a

echo "ВНИМАНИЕ: БД '$POSTGRES_DB' будет перезаписана из $FILE."
read -r -p "Продолжить? (yes/no) " ans
[ "$ans" = "yes" ] || { echo "Отмена."; exit 1; }

echo "=== drop+recreate schema, restore ==="
gunzip -c "$FILE" | docker compose exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"

echo "=== перезапуск сервисов ==="
docker compose restart vikunja n8n
echo "=== восстановление завершено ==="
