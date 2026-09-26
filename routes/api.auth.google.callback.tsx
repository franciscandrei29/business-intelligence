import type { LoaderFunctionArgs } from '@remix-run/node';
import { redirect } from '@remix-run/node';
import { requireUser } from '~/lib/auth/requireAuth.server';
import { exchangeCode, saveTokens } from '~/lib/ga/index';

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  
  if (error || !code) {
    return redirect('/analytics?error=auth_failed');
  }
  
  try {
    const tokens = await exchangeCode(code);
    saveTokens(user.id, tokens);
    return redirect('/analytics?connected=true');
  } catch (e) {
    console.error('Google OAuth error:', e);
    return redirect('/analytics?error=token_exchange');
  }
}
