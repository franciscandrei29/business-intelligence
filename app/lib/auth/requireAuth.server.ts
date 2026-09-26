import { redirect } from '@remix-run/node';
import { getSessionFromCookie } from './session.server';
import { db } from '~/lib/db.server';
import { getMembershipByUserId, type Role } from '~/lib/team';

export async function requireUser(request: Request) {
  const session = await getSessionFromCookie(request);
  if (!session) throw redirect('/login');
  if (session.expiresAt < new Date()) throw redirect('/login');
  return session.user;
}

export interface UserContext {
  user: Awaited<ReturnType<typeof requireUser>>;
  effectiveOwnerId: string;
  role: Role;
  isOwner: boolean;
  membershipId: string | null;
}

export async function requireUserContext(request: Request): Promise<UserContext> {
  const user = await requireUser(request);
  const membership = await getMembershipByUserId(user.id);
  if (membership) {
    return {
      user,
      effectiveOwnerId: membership.ownerId,
      role: membership.role,
      isOwner: false,
      membershipId: membership.id,
    };
  }
  return {
    user,
    effectiveOwnerId: user.id,
    role: 'owner',
    isOwner: true,
    membershipId: null,
  };
}

const ROLE_ORDER: Record<Role, number> = { owner: 4, admin: 3, analyst: 2, viewer: 1 };

export async function requireRole(request: Request, allowed: Role[]): Promise<UserContext> {
  const ctx = await requireUserContext(request);
  if (!allowed.includes(ctx.role)) {
    throw new Response('Forbidden', { status: 403 });
  }
  return ctx;
}

export async function requireMinRole(request: Request, minRole: Role): Promise<UserContext> {
  const ctx = await requireUserContext(request);
  if (ROLE_ORDER[ctx.role] < ROLE_ORDER[minRole]) {
    throw new Response('Forbidden', { status: 403 });
  }
  return ctx;
}

/**
 * Super-admin = platform owner (you, not team owners). 404 for anyone else
 * so the route doesn't even reveal it exists.
 */
export async function requireSuperAdmin(request: Request) {
  const user = await requireUser(request);
  if (!(user as any).isSuperAdmin) {
    throw new Response('Not Found', { status: 404 });
  }
  return user;
}

export async function requireUserAndStore(
  request: Request,
  storeId: string
) {
  const ctx = await requireUserContext(request);
  const store = await db.storeConnection.findFirst({
    where: { id: storeId, userId: ctx.effectiveOwnerId },
  });
  if (!store) throw new Response('Not found', { status: 404 });
  return { user: ctx.user, store, ctx };
}
