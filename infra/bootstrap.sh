#!/usr/bin/env bash
# bootstrap.sh — подготовка чистого GPU-сервера (Ubuntu 24.04) под AppKacalypse.
# Ставит: NVIDIA-драйвер (1 ребут), Docker+Compose, nvidia-container-toolkit.
# Запускать на 158.255.0.82 под root. Идемпотентно.
set -euo pipefail

log() { echo -e "\n=== $* ==="; }

log "1/4 NVIDIA-драйвер"
if ! command -v nvidia-smi >/dev/null 2>&1; then
  apt-get update
  apt-get install -y ubuntu-drivers-common
  ubuntu-drivers install
  echo ">>> Драйвер установлен. НУЖЕН РЕБУТ: reboot, затем запусти bootstrap.sh снова."
  echo ">>> cloud-init отключён, ключи не слетят."
  exit 0
else
  nvidia-smi --query-gpu=name,driver_version --format=csv,noheader
fi

log "2/4 Docker + Compose"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
docker --version
docker compose version

log "3/4 nvidia-container-toolkit"
if ! dpkg -l | grep -q nvidia-container-toolkit; then
  curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
    | gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
  curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
    | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
    > /etc/apt/sources.list.d/nvidia-container-toolkit.list
  apt-get update
  apt-get install -y nvidia-container-toolkit
  nvidia-ctk runtime configure --runtime=docker
  systemctl restart docker
fi

log "4/4 Проверка проброса GPU в контейнер"
# nvidia-container-toolkit пробрасывает nvidia-smi в любой образ — спец. CUDA-образ не нужен.
docker run --rm --gpus all ubuntu:24.04 nvidia-smi \
  && echo ">>> GPU доступен в контейнерах. Готово к deploy."
