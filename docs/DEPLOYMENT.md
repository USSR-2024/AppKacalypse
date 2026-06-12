# DEPLOYMENT — AppKacalypse

Развёртывание на GPU-сервере `158.255.0.82` (Ubuntu 24.04, RTX A4000 16GB).

## 0. Предусловия
- SSH: `ssh -i ~/.ssh/hermes_key2 -p 19949 root@158.255.0.82`
- cloud-init отключён (`/etc/cloud/cloud-init.disabled`) — ребут безопасен.
- Порты 80/443 свободны, диск ~216GB свободно.

## 1. Bootstrap (один раз)
`infra/bootstrap.sh` ставит на чистый сервер:
1. **NVIDIA-драйвер** для A4000 (`ubuntu-drivers install`) — **требует 1 ребут**.
2. **Docker + Compose plugin**.
3. **nvidia-container-toolkit** (проброс GPU в контейнеры).
4. Проверка: `nvidia-smi` и `docker run --rm --gpus all nvidia/cuda:12.4.0-base-ubuntu24.04 nvidia-smi`.

```bash
scp -P 19949 -i ~/.ssh/hermes_key2 infra/bootstrap.sh root@158.255.0.82:/root/
ssh -i ~/.ssh/hermes_key2 -p 19949 root@158.255.0.82 'bash /root/bootstrap.sh'
# после ребута — повторный заход
```

## 2. Код на сервер
```bash
ssh ... root@158.255.0.82
cd /root && git clone git@github.com:USSR-2024/AppKacalypse.git appkacalypse
cd appkacalypse && cp .env.example .env && nano .env   # заполнить секреты
```
> На 158 порт 22 к GitHub закрыт — настроить SSH-over-443 (как на control,
> `~/.ssh/config`) либо клонировать по HTTPS с токеном. Альтернатива — `infra/deploy.sh`
> с control-сервера через rsync (без GitHub-доступа на 158).

## 3. Модель
```bash
docker compose up -d ollama
docker compose exec ollama ollama pull qwen3:14b
docker compose exec ollama ollama list
```

## 4. Запуск стека
```bash
docker compose up -d --build
docker compose ps
infra/healthcheck.sh
```

## 5. Домен и HTTPS
- A-записи `tasks.* и n8n.*` → `158.255.0.82`.
- Caddy сам возьмёт сертификаты Let's Encrypt (нужен `ACME_EMAIL` в `.env`).
- Пока домена нет — Caddy работает на self-signed / internal.

## 6. Деплой обновлений
```bash
infra/deploy.sh        # с control: rsync/pull + build + up + smoke
# или на 158:
cd /root/appkacalypse && git pull && docker compose up -d --build && infra/healthcheck.sh
```

## 7. Откат
```bash
git checkout <предыдущий-тег> && docker compose up -d --build
# данные: infra/restore.sh <backup-файл>
```

См. также `docs/LLM_LOCAL.md` (Ollama/Qwen) и `docs/SECURITY.md`.
