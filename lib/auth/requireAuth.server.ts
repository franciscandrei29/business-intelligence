import { redirect } from '@remix-run/node';
import { getSessionFromCookie } from './session.server';
import { db } from '~/lib/db.server';

export async function requireUser(request: Request) {
  const session = await getSessionFromCookie(request);
  if (!session) throw redirect('/login');
  if (session.expiresAt < new Date()) throw redirect('/login');
  return session.user;
}

export async function requireUserAndStore(
  request: Request,
  storeId: string
) {
  const user = await requireUser(request);
  const store = await db.storeConnection.findFirst({
    where: { id: storeId, userId: user.id },
  });
  if (!store) throw new Response('Not found', { status: 404 });
  return { user, store };
}
