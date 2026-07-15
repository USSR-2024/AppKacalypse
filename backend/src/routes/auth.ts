import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { db, schema } from '../db/index.js';
import { signSession } from '../lib/jwt.js';
import { verifyTelegramLogin } from '../lib/telegram.js';
import { findOrCreateUser } from '../lib/users.js';
import { sendLoginCode, sendNoAccess } from '../lib/mail.js';
import {
  CODE_TTL_MIN, normEmail, nameFromEmail, tooManyCodes, issueCode, consumeCode,
  findInvite, acceptInvite,
} from '../lib/email-auth.js';
import { env } from '../lib/env.js';

export const authRoutes = new Hono();

const telegramSchema = z.object({
  id: z.number(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  photo_url: z.string().optional(),
  auth_date: z.number(),
  hash: z.string(),
});

/** POST /api/auth/telegram — приём payload от Telegram Login Widget. */
authRoutes.post('/telegram', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = telegramSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'bad_request' }, 400);

  if (!verifyTelegramLogin(parsed.data)) {
    return c.json({ error: 'invalid_signature' }, 401);
  }

  const tg = parsed.data;
  const displayName = [tg.first_name, tg.last_name].filter(Boolean).join(' ') || tg.username || 'User';

  const user = await findOrCreateUser('telegram', String(tg.id), displayName, tg.photo_url, {
    username: tg.username ?? null,
    photo_url: tg.photo_url ?? null,
  });

  const token = await signSession({ sub: user.id, role: user.role });
  return c.json({ token });
});

/** POST /api/auth/dev — вход без подписи для локального теста UI. Только при ALLOW_DEV_AUTH=1. */
authRoutes.post('/dev', async (c) => {
  if (env.ALLOW_DEV_AUTH !== '1') return c.json({ error: 'not_found' }, 404);
  const body = await c.req.json().catch(() => ({}));
  const name = z.string().min(1).max(100).safeParse(body?.name);
  const displayName = name.success ? name.data : 'Dev User';
  const externalId = `dev:${displayName.toLowerCase()}`;
  const user = await findOrCreateUser('telegram', externalId, displayName);
  const token = await signSession({ sub: user.id, role: user.role });
  return c.json({ token, dev: true });
});

// ── Вход по почте (беспарольный, код из письма) ───────────────────────────────
// Регистрация ТОЛЬКО по приглашению: аккаунт заводится, если есть живой инвайт.
// Существующий адрес → обычный вход.
//
// Форма отвечает одинаково всегда — {ok:true}, есть аккаунт или нет. Иначе по
// ответу API перебором вычисляется, кто зарегистрирован. Адресу без аккаунта и
// без приглашения уходит письмо-объяснение: человек понимает, что произошло, а
// посторонний не узнаёт ничего, потому что письмо приходит не ему.

const emailSchema = z.string().trim().toLowerCase().email().max(200);

/** POST /api/auth/email/request — прислать код на почту. */
authRoutes.post('/email/request', async (c) => {
  const p = z.object({
    email: emailSchema,
    invite: z.string().min(1).max(128).optional(),
  }).safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: 'bad_request' }, 400);

  const email = normEmail(p.data.email);
  const ok = { ok: true, ttlMinutes: CODE_TTL_MIN };
  if (await tooManyCodes(email)) return c.json(ok);   // молча: не подсказываем, что адрес живой

  const [identity] = await db
    .select({ userId: schema.authIdentities.userId })
    .from(schema.authIdentities)
    .where(and(eq(schema.authIdentities.provider, 'email'), eq(schema.authIdentities.externalId, email)))
    .limit(1);

  const invite = p.data.invite ? await findInvite(p.data.invite) : null;

  if (!identity && !invite) {
    await sendNoAccess(email);
    return c.json(ok);
  }

  const code = await issueCode(email, { inviteCode: invite ? p.data.invite : undefined });
  await sendLoginCode(email, code, CODE_TTL_MIN);
  return c.json(ok);
});

/** POST /api/auth/email/verify — обменять код на сессию. */
authRoutes.post('/email/verify', async (c) => {
  const p = z.object({
    email: emailSchema,
    code: z.string().trim().min(4).max(10),
  }).safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: 'bad_request' }, 400);

  const email = normEmail(p.data.email);
  const res = await consumeCode(email, p.data.code);
  if (!res.ok) return c.json({ error: res.reason }, res.reason === 'expired' ? 410 : 401);

  // Приглашение перепроверяем в момент обмена: пока шло письмо, оно могло
  // истечь или быть исчерпанным одноразовым.
  const invite = res.row.inviteCode ? await findInvite(res.row.inviteCode) : null;

  const [identity] = await db
    .select({ userId: schema.authIdentities.userId })
    .from(schema.authIdentities)
    .where(and(eq(schema.authIdentities.provider, 'email'), eq(schema.authIdentities.externalId, email)))
    .limit(1);

  if (!identity && !invite) return c.json({ error: 'no_access' }, 403);

  const user = await findOrCreateUser('email', email, nameFromEmail(email));
  if (!identity) await db.update(schema.users).set({ email }).where(eq(schema.users.id, user.id));
  if (invite) await acceptInvite(user.id, res.row.inviteCode!, invite);

  const token = await signSession({ sub: user.id, role: user.role });
  return c.json({ token, workspace: invite ? { slug: invite.wsSlug, pending: !invite.autoApprove } : undefined });
});

/** GET /api/auth/invite/:code — что это за приглашение (для экрана /invite/<code>). */
authRoutes.get('/invite/:code', async (c) => {
  const inv = await findInvite(c.req.param('code')!);
  if (!inv) return c.json({ error: 'invalid' }, 404);
  return c.json({ workspaceName: inv.wsName, role: inv.role });
});

// ── Вход через бота (обход блокировки веб-виджета в РФ) ────────────────────────
const CODE_TTL_MS = 5 * 60_000;

/** POST /api/auth/bot/start — веб запрашивает одноразовый код. Открывает t.me/<bot>?start=login_<code>. */
authRoutes.post('/bot/start', async (c) => {
  const code = randomBytes(18).toString('base64url');
  await db.insert(schema.botLoginCodes).values({ code, expiresAt: new Date(Date.now() + CODE_TTL_MS) });
  return c.json({ code });
});

/** POST /api/auth/bot/exchange — веб меняет код на JWT (поллит, пока бот не подтвердит). */
authRoutes.post('/bot/exchange', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = z.object({ code: z.string().min(1).max(128) }).safeParse(body);
  if (!parsed.success) return c.json({ error: 'bad_request' }, 400);

  const [row] = await db.select().from(schema.botLoginCodes).where(eq(schema.botLoginCodes.code, parsed.data.code)).limit(1);
  if (!row || row.expiresAt.getTime() < Date.now()) {
    if (row) await db.delete(schema.botLoginCodes).where(eq(schema.botLoginCodes.code, row.code));
    return c.json({ error: 'expired' }, 410);
  }
  if (row.status === 'consumed') return c.json({ error: 'expired' }, 410);
  if (row.status !== 'claimed' || !row.userId) return c.json({ status: 'pending' });

  const [user] = await db.select({ id: schema.users.id, role: schema.users.role }).from(schema.users).where(eq(schema.users.id, row.userId)).limit(1);
  if (!user) return c.json({ error: 'expired' }, 410);
  await db.delete(schema.botLoginCodes).where(eq(schema.botLoginCodes.code, row.code));
  const token = await signSession({ sub: user.id, role: user.role });
  return c.json({ token });
});
