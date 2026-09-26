// api.auth.meta.select-account.ts — Saves selected ad account
import type { ActionFunctionArgs } from '@remix-run/node';
import { redirect, json } from '@remix-run/node';
import { requireUserContext } from '~/lib/auth/requireAuth.server';
import { db } from '~/lib/db.server';

export async function action({ request }: ActionFunctionArgs) {
  const ctx = await requireUserContext(request);
  const form = await request.formData();
  const storeId = String(form.get('storeId'));
  const adAccountId = String(form.get('adAccountId'));

  if (!storeId || !adAccountId) {
    return json({ error: 'Missing parameters' }, { status: 400 });
  }

  const store = await db.storeConnection.findFirst({
    where: { id: storeId, userId: ctx.effectiveOwnerId },
  });
  if (!store) return json({ error: 'Store not found' }, { status: 404 });

  await db.storeSettings.update({
    where: { storeConnectionId: storeId },
    data: { metaAdAccountId: adAccountId },
  });

  console.log(`[meta] Selected ad account ${adAccountId} for store ${storeId}`);
  return redirect(`/ads?meta_success=1&store=${storeId}`);
}
