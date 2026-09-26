import { createCookie } from '@remix-run/node';
import crypto from 'crypto';
import { db } from '~/lib/db.server';

const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

const sessionCookie = createCookie('__kimono_session', {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  maxAge: SESSION_MAX_AGE,
  secrets: [process.env.SESSION_SECRET!],
  path: '/',
});

export async function createUserSession(
  userId: string,
  request: Request
): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  const userAgent = request.headers.get('user-agent') || undefined;
  const forwarded = request.headers.get('x-forwarded-for');
  const ipAddress = forwarded?.split(',')[0]?.trim() || undefined;

  await db.userSession.create({
    data: {
      userId,
      token,
      userAgent,
      ipAddress,
      expiresAt: new Date(Date.now() + SESSION_MAX_AGE * 1000),
    },
  });

  // Update lastLoginAt
  await db.user.update({
    where: { id: userId },
    data: { lastLoginAt: new Date() },
  });

  return sessionCookie.serialize(token);
}

export async function getSessionFromCookie(request: Request) {
  const cookieHeader = request.headers.get('Cookie');
  const token = await sessionCookie.parse(cookieHeader);
  if (!token) return null;

  const session = await db.userSession.findUnique({
    where: { token },
    include: { user: true },
  });

  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await db.userSession.delete({ where: { id: session.id } });
    return null;
  }

  return session;
}

export async function destroySession(request: Request): Promise<string> {
  const cookieHeader = request.headers.get('Cookie');
  const token = await sessionCookie.parse(cookieHeader);

  if (token) {
    await db.userSession.deleteMany({ where: { token } });
  }

  return sessionCookie.serialize('', { maxAge: 0 });
}

export async function getUserFromRequest(request: Request) {
  const session = await getSessionFromCookie(request);
  return session?.user || null;
}
