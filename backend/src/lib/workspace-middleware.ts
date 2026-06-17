import type { Context, Next } from 'hono';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

export interface WorkspaceCtx {
  id: string;
  slug: string;
  role: 'owner' | 'admin' | 'member';  // роль ВНУТРИ воркспейса
}

declare module 'hono' {
  interface ContextVariableMap {
    workspace: WorkspaceCtx;
  }
}

/**
 * Требует контекст воркспейса. Slug приходит в заголовке `X-Workspace` (фронт берёт
 * из пути /<slug>/...). Резолвит воркспейс, проверяет членство текущего юзера и кладёт
 * {id, slug, role} в c.get('workspace'). Платформенный owner (users.role='owner')
 * проходит в любой воркспейс (поддержка). Ставить ПОСЛЕ requireAuth.
 */
export async function requireWorkspace(c: Context, next: Next) {
  const u = c.get('user');
  const slug = c.req.header('X-Workspace');
  if (!slug) return c.json({ error: 'workspace_required' }, 400);

  const [ws] = await db
    .select({ id: schema.workspaces.id, slug: schema.workspaces.slug, isActive: schema.workspaces.isActive })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.slug, slug))
    .limit(1);
  if (!ws || !ws.isActive) return c.json({ error: 'workspace_not_found' }, 404);

  const [member] = await db
    .select({ role: schema.workspaceMembers.role })
    .from(schema.workspaceMembers)
    .where(and(eq(schema.workspaceMembers.workspaceId, ws.id), eq(schema.workspaceMembers.userId, u.sub)))
    .limit(1);

  let role = member?.role;
  if (!role) {
    if (u.role === 'owner') role = 'owner';        // платформенный owner — сквозной доступ
    else return c.json({ error: 'not_a_member' }, 403);
  }

  c.set('workspace', { id: ws.id, slug: ws.slug, role });
  return next();
}

/**
 * Воркспейс юзера для внеконтекстных путей (бот). Пока — первое (по дате) членство.
 * Stage 4 добавит выбор активного воркспейса для мульти-членства.
 */
export async function resolveUserWorkspaceId(userId: string): Promise<string | null> {
  const [m] = await db
    .select({ workspaceId: schema.workspaceMembers.workspaceId })
    .from(schema.workspaceMembers)
    .where(eq(schema.workspaceMembers.userId, userId))
    .orderBy(schema.workspaceMembers.createdAt)
    .limit(1);
  return m?.workspaceId ?? null;
}
