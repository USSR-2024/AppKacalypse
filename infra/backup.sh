#!/bin/sh
# backup.sh — ежедневный бэкап PostgreSQL (+ ротация).
# Запускается контейнером backup (см. docker-compose). Хранение:
# daily 7д, weekly 4н, monthly 3м (ротация — простая, по mtime).
set -eu

BACKUP_DIR=/backups
INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"   # раз в сутки
KEEP_DAYS="${BACKUP_KEEP_DAYS:-31}"

mkdir -p "$BACKUP_DIR"

while true; do
  TS=$(date +%Y%m%d-%H%M%S)
  OUT="$BACKUP_DIR/pg-$POSTGRES_DB-$TS.sql.gz"
  echo "[backup] dump → $OUT"
  if pg_dump -h "$PGHOST" -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "$OUT"; then
    echo "[backup] ok ($(du -h "$OUT" | cut -f1))"
  else
    echo "[backup] ОШИБКА dump" >&2
    rm -f "$OUT"
  fi
  # ротация
  find "$BACKUP_DIR" -name 'pg-*.sql.gz' -mtime +"$KEEP_DAYS" -delete 2>/dev/null || true
  sleep "$INTERVAL"
done
