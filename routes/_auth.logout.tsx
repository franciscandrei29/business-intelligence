import type { ActionFunctionArgs } from '@remix-run/node';
import { redirect } from '@remix-run/node';
import { destroySession } from '~/lib/auth/session.server';

export async function action({ request }: ActionFunctionArgs) {
  const cookieHeader = await destroySession(request);
  return redirect('/login', {
    headers: { 'Set-Cookie': cookieHeader },
  });
}

export async function loader() {
  return redirect('/login');
}
