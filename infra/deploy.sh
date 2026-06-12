#!/usr/bin/env bash
# deploy.sh — деплой на GPU-сервер 158 с control-сервера.
# Вариант через rsync (не требует GitHub-доступа на 158). Запускать на control
# из корня репозитория.
set -euo pipefail

SSH_KEY="${SSH_KEY:-$HOME/.ssh/hermes_key2}"
SSH_PORT="${SSH_PORT:-19949}"
HOST="${HOST:-root@158.255.0.82}"
REMOTE_DIR="${REMOTE_DIR:-/root/appkacalypse}"
SSH="ssh -i $SSH_KEY -p $SSH_PORT -o StrictHostKeyChecking=no"

echo "=== rsync кода на $HOST:$REMOTE_DIR (без .env, .git, данных) ==="
rsync -az --delete \
  --exclude '.git' --exclude '.env' --exclude 'backups' \
  --exclude '*-data' --exclude '__pycache__' \
  -e "$SSH" ./ "$HOST:$REMOTE_DIR/"

echo "=== build + up на сервере ==="
$SSH "$HOST" "cd $REMOTE_DIR && \
  test -f .env || { echo 'НЕТ .env на сервере — создай из .env.example'; exit 1; } && \
  docker compose up -d --build && \
  bash infra/healthcheck.sh"

echo "=== деплой завершён ==="
