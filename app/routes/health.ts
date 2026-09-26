import { json } from '@remix-run/node';
import { db } from '~/lib/db.server';

export async function loader() {
  try {
    // Check DB connection
    await db.$queryRaw`SELECT 1`;
    return json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  } catch (err) {
    return json({ status: 'error', error: 'Database connection failed' }, { status: 503 });
  }
}
