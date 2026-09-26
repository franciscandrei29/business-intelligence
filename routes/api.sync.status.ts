import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { requireUser } from '~/lib/auth/requireAuth.server';
import { db } from '~/lib/db.server';

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const url = new URL(request.url);
  const storeId = url.searchParams.get('storeId');

  if (!storeId) {
    return json({ error: 'storeId required' }, { status: 400 });
  }

  const store = await db.storeConnection.findFirst({
    where: { id: storeId, userId: user.id },
    select: {
      syncStatus: true,
      lastSyncAt: true,
      _count: { select: { products: true, orders: true, customers: true } },
    },
  });

  if (!store) {
    return json({ error: 'Store not found' }, { status: 404 });
  }

  return json({
    syncStatus: store.syncStatus,
    lastSyncAt: store.lastSyncAt,
    counts: store._count,
  });
}
