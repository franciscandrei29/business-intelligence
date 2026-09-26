import type { LoaderFunctionArgs } from '@remix-run/node';
import { redirect } from '@remix-run/node';
import { requireRole } from '~/lib/auth/requireAuth.server';
import { exchangeCode, saveTokens } from '~/lib/ga/index';

export async function loader({ request }: LoaderFunctionArgs) {
  const ctx = await requireRole(request, ['owner', 'admin']);
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error || !code) {
    return redirect('/analytics?error=auth_failed');
  }

  try {
    const tokens = await exchangeCode(code);
    saveTokens(ctx.effectiveOwnerId, tokens);
    return redirect('/analytics?connected=true');
  } catch (e) {
    console.error('Google OAuth error:', e);
    return redirect('/analytics?error=token_exchange');
  }
}
