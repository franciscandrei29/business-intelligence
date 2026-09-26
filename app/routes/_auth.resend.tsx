import type { ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { Form, Link, useActionData, useNavigation } from '@remix-run/react';
import crypto from 'crypto';
import { sendVerifyEmail } from '~/lib/auth/email.server';
import { db } from '~/lib/db.server';

export const meta: MetaFunction = () => [{ title: 'Retrimite link verificare — Kimono BI' }];

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  const email = String(form.get('email') || '').trim().toLowerCase();

  if (!email) {
    return json({ error: 'Emailul este obligatoriu.' }, { status: 400 });
  }

  const user = await db.user.findUnique({ where: { email } });
  // Don't reveal whether user exists — always show the same success message
  const okMessage = 'Dacă există un cont cu acest email și nu e verificat, vei primi un link nou în 1-2 minute.';

  if (!user || user.emailVerified) {
    return json({ success: okMessage });
  }

  const token = crypto.randomBytes(32).toString('hex');
  await db.user.update({ where: { id: user.id }, data: { verifyToken: token } });

  try {
    await sendVerifyEmail(email, token);
  } catch (e) {
    console.error('Resend verify email failed:', e);
  }

  return json({ success: okMessage });
}

export default function ResendPage() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <h1><img src="/logo-kimono-bi.svg" alt="Kimono BI" style={{ height: 32, width: 'auto' }} /></h1>
          <p>Retrimite link de verificare</p>
        </div>

        <div className="card">
          <Form method="post">
            {actionData && 'error' in actionData && actionData.error && (
              <div className="alert alert-error">{actionData.error}</div>
            )}
            {actionData && 'success' in actionData && actionData.success && (
              <div className="alert alert-success">{actionData.success}</div>
            )}

            <p style={{ fontSize: 13, color: '#525252', marginBottom: 16, lineHeight: 1.6 }}>
              Introdu emailul folosit la înregistrare. Dacă există un cont care nu a fost încă verificat, îți vom trimite un link nou.
            </p>

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
              {isSubmitting ? 'Se trimite...' : 'Trimite link de verificare'}
            </button>
          </Form>
        </div>

        <div className="auth-footer">
          <Link to="/login">Înapoi la login</Link>
        </div>
      </div>
    </div>
  );
}
