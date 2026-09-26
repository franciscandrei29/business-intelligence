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
    return json({ error: 'Email și parola sunt obligatorii.' }, { status: 400 });
  }

  const user = await db.user.findUnique({ where: { email } });
  if (!user) {
    return json({ error: 'Email sau parolă incorecte.' }, { status: 400 });
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return json({ error: 'Email sau parolă incorecte.' }, { status: 400 });
  }

  if (!user.emailVerified) {
    return json({ error: 'Contul nu este încă verificat.', notVerified: true }, { status: 400 });
  }

  const cookieHeader = await createUserSession(user.id, request);

  // ── Handle pending Shopify OAuth (user installed app before logging in) ──
  const cookies = request.headers.get('cookie') || '';
  const pendingMatch = cookies.match(/shopify_pending=([A-Za-z0-9+/=]+)/);

  if (pendingMatch) {
    try {
      const { encrypt } = await import('~/lib/auth/crypto.server');
      const pending = JSON.parse(Buffer.from(pendingMatch[1], 'base64').toString());
      const { shop, shopName, token } = pending;

      if (shop && token) {
        const encryptedToken = encrypt(token);

        const existing = await db.storeConnection.findFirst({
          where: { userId: user.id, domain: shop, platform: 'SHOPIFY' },
        });

        if (existing) {
          await db.storeConnection.update({
            where: { id: existing.id },
            data: { shopifyAccessToken: encryptedToken, isActive: true, name: shopName || shop, syncStatus: 'PENDING' },
          });
        } else {
          const newStore = await db.storeConnection.create({
            data: {
              userId: user.id,
              platform: 'SHOPIFY',
              name: shopName || shop,
              domain: shop,
              shopifyAccessToken: encryptedToken,
              syncStatus: 'PENDING',
            },
          });

          // Trigger initial sync
          try {
            const { spawn } = await import('child_process');
            spawn('node', ['scripts/cron-sync.mjs', '--force', `--store=${newStore.id}`], {
              cwd: process.cwd(), detached: true, stdio: 'ignore',
            }).unref();
          } catch {}
        }

        const headers = new Headers();
        headers.append('Set-Cookie', cookieHeader);
        headers.append('Set-Cookie', 'shopify_pending=; Path=/; HttpOnly; Secure; Max-Age=0');
        return redirect('/stores?oauth=success&shop=' + encodeURIComponent(shopName || shop), { headers });
      }
    } catch (e) {
      console.error('[login] pending OAuth link failed:', e);
    }
  }

  return redirect('/dashboard', { headers: { 'Set-Cookie': cookieHeader } });
}

export default function LoginPage() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-page)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px 16px',
    }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.5px' }}>
              <img src="/logo-kimono-bi.svg" alt="Kimono BI" style={{ height: 32, width: 'auto' }} />
            </span>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Intră în contul tău</p>
        </div>

        <div className="card" style={{ padding: '28px 28px' }}>
          <Form method="post">
            {actionData?.error && (
              <div className="alert alert-error" style={{ marginBottom: 20 }}>
                {actionData.error}
                {(actionData as any).notVerified && (
                  <div style={{ marginTop: 8, fontSize: 12 }}>
                    <Link to="/resend" style={{ color: 'var(--danger-text)', fontWeight: 600 }}>
                      Retrimite link-ul de verificare →
                    </Link>
                  </div>
                )}
              </div>
            )}

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', display: 'block', marginBottom: 6 }}>
                Email
              </label>
              <input
                name="email"
                type="email"
                className="form-input"
                placeholder="tu@exemplu.com"
                required
                autoFocus
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', display: 'block', marginBottom: 6 }}>
                Parolă
              </label>
              <input
                name="password"
                type="password"
                className="form-input"
                placeholder="Introdu parola"
                required
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ textAlign: 'right', marginBottom: 20 }}>
              <Link to="/reset" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                Ai uitat parola?
              </Link>
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={isSubmitting}
              style={{ width: '100%', height: 40, fontSize: 14 }}
            >
              {isSubmitting ? 'Se conectează...' : 'Conectează-te'}
            </button>
          </Form>
        </div>

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: 'var(--text-secondary)' }}>
          Nu ai cont?{' '}
          <Link to="/register" style={{ color: 'var(--kimono-orange)', fontWeight: 600 }}>
            Creează cont gratuit
          </Link>
        </p>
      </div>
    </div>
  );
}
