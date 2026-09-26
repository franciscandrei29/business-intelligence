import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { db } from '~/lib/db.server';
import { encrypt } from '~/lib/auth/crypto.server';

// WooCommerce sends POST with: user_id, consumer_key, consumer_secret, key_permissions
export async function action({ request }: ActionFunctionArgs) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { user_id, consumer_key, consumer_secret, key_permissions } = body;

  if (!user_id || !consumer_key || !consumer_secret) {
    return json({ error: 'Missing data' }, { status: 400 });
  }

  // user_id is our internal userId that we passed in the auth URL
  // Find the pending store connection for this user
  const pendingStore = await db.storeConnection.findFirst({
    where: {
      userId: user_id,
      platform: 'WOOCOMMERCE',
      syncStatus: 'PENDING',
      wooConsumerKey: null,
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!pendingStore) {
    return json({ error: 'No pending store found' }, { status: 404 });
  }

  // Encrypt and save keys
  await db.storeConnection.update({
    where: { id: pendingStore.id },
    data: {
      wooConsumerKey: encrypt(consumer_key),
      wooConsumerSecret: encrypt(consumer_secret),
    },
  });

  return json({ success: true });
}

export async function loader() {
  return json({ error: 'Method not allowed' }, { status: 405 });
}
