import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json, redirect } from '@remix-run/node';
import { Form, Link, useActionData, useLoaderData, useNavigation } from '@remix-run/react';
import { hashPassword } from '~/lib/auth/password.server';
import { db } from '~/lib/db.server';

export const meta: MetaFunction = () => [{ title: 'Resetare parola — Kimono BI' }];

export async function loader({ params }: LoaderFunctionArgs) {
  const { token } = params;
  if (!token) {
    return json({ valid: false });
  }

  const user = await db.user.findFirst({
    where: {
      resetToken: token,
      resetExpires: { gt: new Date() },
    },
  });

  return json({ valid: !!user });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { token } = params;
  const form = await request.formData();
  const password = String(form.get('password') || '');
  const confirmPassword = String(form.get('confirmPassword') || '');

  if (!token) {
    return json({ error: 'Token lipsa.' }, { status: 400 });
  }

  if (password.length < 8) {
    return json({ error: 'Parola trebuie sa aiba minim 8 caractere.' }, { status: 400 });
  }

  if (password !== confirmPassword) {
    return json({ error: 'Parolele nu coincid.' }, { status: 400 });
  }

  const user = await db.user.findFirst({
    where: {
      resetToken: token,
      resetExpires: { gt: new Date() },
    },
  });

  if (!user) {
    return json({ error: 'Token invalid sau expirat.' }, { status: 400 });
  }

  const passwordHash = await hashPassword(password);
  await db.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      resetToken: null,
      resetExpires: null,
    },
  });

  return redirect('/login?reset=success');
}

export default function ResetTokenPage() {
  const { valid } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';

  if (!valid) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-logo">
            <h1>Kimono <span>BI</span></h1>
          </div>
          <div className="card" style={{ textAlign: 'center' }}>
            <div className="alert alert-error">Link-ul de resetare este invalid sau a expirat.</div>
            <Link to="/reset" className="btn btn-primary" style={{ marginTop: 'var(--space-md)' }}>
              Solicita un nou link
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <h1>Kimono <span>BI</span></h1>
          <p>Seteaza o parola noua</p>
        </div>

        <div className="card">
          <Form method="post">
            {actionData?.error && (
              <div className="alert alert-error">{actionData.error}</div>
            )}

            <div className="form-group">
              <label className="form-label" htmlFor="password">Parola noua</label>
              <input
                id="password"
                name="password"
                type="password"
                className="form-input"
                placeholder="Minim 8 caractere"
                required
                minLength={8}
                autoFocus
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="confirmPassword">Confirma parola</label>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                className="form-input"
                placeholder="Repeta parola"
                required
              />
            </div>

            <button type="submit" className="btn btn-primary btn-full" disabled={isSubmitting}>
              {isSubmitting ? 'Se salveaza...' : 'Salveaza parola noua'}
            </button>
          </Form>
        </div>
      </div>
    </div>
  );
}
