import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().default(8081),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(16),
  JWT_TTL: z.string().default('30d'),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_AUTH_MAX_AGE: z.coerce.number().default(86400),
  GATEWAY_URL: z.string().url().default('http://llm-gateway:8000'),
  VAPID_PUBLIC_KEY: z.string().default(''),
  VAPID_PRIVATE_KEY: z.string().default(''),
  VAPID_SUBJECT: z.string().default('mailto:owner@baassist.ru'),
});

export const env = schema.parse(process.env);
