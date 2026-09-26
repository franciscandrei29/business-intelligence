import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json, redirect } from '@remix-run/node';
import { Form, Link, useActionData, useNavigation } from '@remix-run/react';
import { getUserFromRequest, createUserSession } from '~/lib/auth/session.server';
import { verifyPassword } from '~/lib/auth/password.server';
import { db } from '~/lib/db.server';

export const meta: MetaFunction = () => [{ title: 'Login — Kimono BI' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (user) return redirect('/dashboard');
  return json({});
}

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  const email = String(form.get('email') || '').trim().toLowerCase();
  const password = String(form.get('password') || '');

  if (!email || !password) {
    return json({ error: 'Email si parola sunt obligatorii.' }, { status: 400 });
  }

  const user = await db.user.findUnique({ where: { email } });
  if (!user) {
    return json({ error: 'Email sau parola incorecta.' }, { status: 400 });
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return json({ error: 'Email sau parola incorecta.' }, { status: 400 });
  }

  if (!user.emailVerified) {
    return json(
      { error: 'Contul nu este verificat. Verifica email-ul pentru link-ul de activare.' },
      { status: 400 }
    );
  }

  const cookieHeader = await createUserSession(user.id, request);
  return redirect('/dashboard', {
    headers: { 'Set-Cookie': cookieHeader },
  });
}

export default function LoginPage() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <h1>Kimono <span>BI</span></h1>
          <p>Business Intelligence Platform</p>
        </div>

        <div className="card">
          <Form method="post">
            {actionData?.error && (
              <div className="alert alert-error">{actionData.error}</div>
            )}

            <div className="form-group">
              <label className="form-label" htmlFor="email">Email</label>
              <input
                id="email"
                name="email"
                type="email"
                className="form-input"
                placeholder="tu@exemplu.com"
                required
                autoFocus
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="password">Parola</label>
              <input
                id="password"
                name="password"
                type="password"
                className="form-input"
                placeholder="Introdu parola"
                required
              />
            </div>

            <div style={{ textAlign: 'right', marginBottom: 'var(--space-md)' }}>
              <Link to="/reset" style={{ fontSize: '0.8125rem' }}>Ai uitat parola?</Link>
            </div>

            <button type="submit" className="btn btn-primary btn-full" disabled={isSubmitting}>
              {isSubmitting ? 'Se conecteaza...' : 'Conecteaza-te'}
            </button>
          </Form>
        </div>

        <div className="auth-footer">
          Nu ai cont? <Link to="/register">Creeaza cont gratuit</Link>
        </div>
      </div>
    </div>
  );
}
