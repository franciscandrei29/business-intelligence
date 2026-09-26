import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json, redirect } from '@remix-run/node';
import { Form, useActionData, useNavigation, useSearchParams } from '@remix-run/react';
import { db } from '~/lib/db.server';
import { verifyPassword } from '~/lib/auth/password.server';
import { createUserSession, getUserFromRequest } from '~/lib/auth/session.server';
import { Crown, AlertCircle, Lock } from 'lucide-react';

export const meta: MetaFunction = () => [{ title: 'Webadmin Login · Kimono BI' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (user && (user as any).isSuperAdmin) throw redirect('/webadmin');
  return json({});
}

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  const email = String(form.get('email') || '').trim().toLowerCase();
  const password = String(form.get('password') || '');

  if (!email || !password) return json({ error: 'Email si parola obligatorii.' }, { status: 400 });

  const user = await db.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return json({ error: 'Credentiale invalide sau cont fara drepturi de admin.' }, { status: 401 });
  }
  if (!(user as any).isSuperAdmin) {
    return json({ error: 'Credentiale invalide sau cont fara drepturi de admin.' }, { status: 401 });
  }

  const cookie = await createUserSession(user.id, request);
  return redirect('/webadmin', { headers: { 'Set-Cookie': cookie } });
}

export default function WebadminLoginPage() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const isSubmitting = navigation.state === 'submitting';
  const errorParam = searchParams.get('error');

  return (
    <div style={{
      minHeight: '100vh', background: '#0B0E14',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      {/* Subtle grid background */}
      <div style={{
        position: 'fixed', inset: 0, opacity: 0.03,
        backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
        backgroundSize: '40px 40px',
        pointerEvents: 'none',
      }} />

      <div style={{ width: '100%', maxWidth: 400, position: 'relative', zIndex: 1 }}>
        {/* Logo + Crown */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16,
            background: 'linear-gradient(135deg, #FF5A1F, #FF8A50)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 16, boxShadow: '0 8px 32px rgba(255,90,31,0.25)',
          }}>
            <Crown size={24} color="#fff" />
          </div>
          <div style={{ marginBottom: 6 }}>
            <img src="/logo-kimono-bi.svg" alt="Kimono BI" style={{ height: 36, width: 'auto' }} />
          </div>
          <p style={{ fontSize: 12, color: '#555', margin: 0, letterSpacing: '0.5px' }}>
            Super-Admin Console
          </p>
        </div>

        {/* Login card */}
        <div style={{
          background: '#111318', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16,
          padding: 28, boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}>
          {errorParam === 'not_authorized' && (
            <div style={{
              marginBottom: 16, padding: '10px 12px',
              background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)',
              borderRadius: 8, fontSize: 12, color: '#fca5a5',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <AlertCircle size={14} /> Contul tau nu are drepturi de super-admin.
            </div>
          )}
          {actionData && 'error' in actionData && actionData.error && (
            <div style={{
              marginBottom: 16, padding: '10px 12px',
              background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)',
              borderRadius: 8, fontSize: 12, color: '#fca5a5',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <AlertCircle size={14} /> {actionData.error}
            </div>
          )}

          <Form method="post">
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 6 }}>Email</label>
              <input name="email" type="email" required autoFocus autoComplete="email"
                style={{
                  width: '100%', padding: '11px 14px',
                  background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8,
                  color: '#fff', fontSize: 13, outline: 'none', fontFamily: 'inherit',
                  transition: 'border-color 0.15s',
                }}
                onFocus={(e) => e.currentTarget.style.borderColor = 'rgba(255,90,31,0.4)'}
                onBlur={(e) => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'}
              />
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 6 }}>Parola</label>
              <input name="password" type="password" required autoComplete="current-password"
                style={{
                  width: '100%', padding: '11px 14px',
                  background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8,
                  color: '#fff', fontSize: 13, outline: 'none', fontFamily: 'inherit',
                  transition: 'border-color 0.15s',
                }}
                onFocus={(e) => e.currentTarget.style.borderColor = 'rgba(255,90,31,0.4)'}
                onBlur={(e) => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'}
              />
            </div>

            <button type="submit" disabled={isSubmitting}
              style={{
                width: '100%', padding: '12px 0', borderRadius: 8,
                background: isSubmitting ? '#8B4513' : 'linear-gradient(135deg, #FF5A1F, #FF8A50)',
                border: 'none', color: '#fff', fontSize: 14, fontWeight: 600, cursor: isSubmitting ? 'wait' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                boxShadow: isSubmitting ? 'none' : '0 4px 16px rgba(255,90,31,0.3)',
                transition: 'all 0.15s',
              }}
            >
              {isSubmitting ? (
                <><div style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} /> Se autentifica...</>
              ) : (
                <><Lock size={14} /> Autentifica-te</>
              )}
            </button>
          </Form>
        </div>

        <p style={{ textAlign: 'center', marginTop: 24, fontSize: 11, color: '#444' }}>
          Doar pentru personalul Kimono Group
        </p>
      </div>
    </div>
  );
}
