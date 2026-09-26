import type { LoaderFunctionArgs } from '@remix-run/node';
import { redirect } from '@remix-run/node';
import { requireUser } from '~/lib/auth/requireAuth.server';
import { getAuthUrl } from '~/lib/ga/index';

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const url = getAuthUrl(user.id);
  return redirect(url);
}
