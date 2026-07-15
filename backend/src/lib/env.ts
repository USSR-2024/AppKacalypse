import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().default(8081),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(16),
  JWT_TTL: z.string().default('30d'),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TG_BOT_USERNAME: z.string().default('appKACAlypse_bot'),  // для ссылок-приглашений из бота
  TELEGRAM_AUTH_MAX_AGE: z.coerce.number().default(86400),
  TELEGRAM_WEBHOOK_SECRET: z.string().default(''),
  GATEWAY_URL: z.string().url().default('http://llm-gateway:8000'),
  // Публичный URL приложения (для ссылок из бота/уведомлений). Путь к задаче:
  // ${PUBLIC_APP_URL}/<workspace-slug>/tasks/<id>.
  PUBLIC_APP_URL: z.string().url().default('https://appka.space'),
  VAPID_PUBLIC_KEY: z.string().default(''),
  VAPID_PRIVATE_KEY: z.string().default(''),
  VAPID_SUBJECT: z.string().default('mailto:owner@baassist.ru'),
  // Dev-only: вход без подписи Telegram для локального теста UI. НИКОГДА не ставить в проде.
  ALLOW_DEV_AUTH: z.string().default('0'),
  // Расшифровки встреч: общий том с хостовым воркером + токен воркера.
  TRANSCRIBE_DATA_DIR: z.string().default('/data'),
  WORKER_TOKEN: z.string().default(''),
});

export const env = schema.parse(process.env);
