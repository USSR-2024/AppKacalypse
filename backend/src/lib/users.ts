import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

/** Найти existing identity или создать пользователя + identity. Первый зарегистрировавшийся = owner. */
export async function findOrCreateUser(
  provider: 'telegram' | 'email',
  externalId: string,
  displayName: string,
  avatarUrl?: string,
  meta: Record<string, unknown> = {},
): Promise<{ id: string; role: 'owner' | 'admin' | 'member' }> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: schema.users.id, role: schema.users.role })
      .from(schema.authIdentities)
      .innerJoin(schema.users, eq(schema.users.id, schema.authIdentities.userId))
      .where(and(
        eq(schema.authIdentities.provider, provider),
        eq(schema.authIdentities.externalId, externalId),
      ))
      .limit(1);
    if (existing[0]) return existing[0];

    const anyUser = await tx.select({ id: schema.users.id }).from(schema.users).limit(1);
    const role = anyUser.length ? 'member' : 'owner';

    const [created] = await tx
      .insert(schema.users)
      .values({ displayName, role, avatarUrl })
      .returning({ id: schema.users.id, role: schema.users.role });
    await tx.insert(schema.authIdentities).values({ userId: created!.id, provider, externalId, meta });
    return created!;
  });
}
