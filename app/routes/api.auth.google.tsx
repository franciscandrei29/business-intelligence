import type { LoaderFunctionArgs } from '@remix-run/node';
import { redirect } from '@remix-run/node';
import { requireRole } from '~/lib/auth/requireAuth.server';
import { getAuthUrl } from '~/lib/ga/index';

export async function loader({ request }: LoaderFunctionArgs) {
  // Only owner+admin can connect GA — tokens are shared per team
  const ctx = await requireRole(request, ['owner', 'admin']);
  const url = getAuthUrl(ctx.effectiveOwnerId);
  return redirect(url);
}
