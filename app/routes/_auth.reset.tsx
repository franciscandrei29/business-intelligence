import type { ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { Form, Link, useActionData, useNavigation } from '@remix-run/react';
import crypto from 'crypto';
import { sendResetEmail } from '~/lib/auth/email.server';
import { db } from '~/lib/db.server';

export const meta: MetaFunction = () => [{ title: 'Resetare parola — Kimono BI' }];

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  const email = String(form.get('email') || '').trim().toLowerCase();

  if (!email) {
    return json({ error: 'Introdu adresa de email.' }, { status: 400 });
  }

  // Always show success to prevent email enumeration
  const user = await db.user.findUnique({ where: { email } });
  if (user) {
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await db.user.update({
      where: { id: user.id },
      data: { resetToken, resetExpires },
    });

    try {
      await sendResetEmail(email, resetToken);
    } catch (e) {
      console.error('Failed to send reset email:', e);
    }
  }

  return json({
    success: 'Daca exista un cont cu acest email, vei primi un link de resetare.',
  });
}

export default function ResetPage() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <h1><img src="/logo-kimono-bi.svg" alt="Kimono BI" style={{ height: 32, width: 'auto' }} /></h1>
          <p>Resetare parola</p>
        </div>

        <div className="card">
          <Form method="post">
            {actionData?.error && (
              <div className="alert alert-error">{actionData.error}</div>
            )}
            {actionData?.success && (
              <div className="alert alert-success">{actionData.success}</div>
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

            <button type="submit" className="btn btn-primary btn-full" disabled={isSubmitting}>
              {isSubmitting ? 'Se trimite...' : 'Trimite link de resetare'}
            </button>
          </Form>
        </div>

        <div className="auth-footer">
          <Link to="/login">Inapoi la login</Link>
        </div>
      </div>
    </div>
  );
}
