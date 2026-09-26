import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json, redirect } from '@remix-run/node';
import { Form, Link, useActionData, useNavigation } from '@remix-run/react';
import crypto from 'crypto';
import { getUserFromRequest } from '~/lib/auth/session.server';
import { hashPassword } from '~/lib/auth/password.server';
import { sendVerifyEmail } from '~/lib/auth/email.server';
import { db } from '~/lib/db.server';
import { checkRateLimit, getClientIp } from '~/lib/auth/rate-limit.server';

export const meta: MetaFunction = () => [{ title: 'Cont nou — Kimono BI' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (user) return redirect('/dashboard');
  return json({});
}

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData();

  // ── Honeypot: hidden field that bots auto-fill ──
  const honeypot = String(form.get('fax_number') || '').trim();
  if (honeypot) {
    console.log(`[REGISTER] Honeypot triggered (fax_number="${honeypot}"), IP: ${getClientIp(request)}`);
    return json({ success: 'Cont creat. Am trimis un link de confirmare.', registeredEmail: 'verifică email', emailSent: true });
  }

  // ── Rate limiting: max 5 registrations per IP / 15 min ──
  const clientIp = getClientIp(request);
  const rateCheck = checkRateLimit(clientIp, 'register');
  if (rateCheck.limited) {
    console.log(`[REGISTER] Rate limited IP: ${clientIp}`);
    return json(
      { error: `Prea multe încercări. Reîncearcă în ${Math.ceil((rateCheck.retryAfterSec || 60) / 60)} minute.` },
      { status: 429 }
    );
  }

  const fullName = String(form.get('fullName') || '').trim();
  const email = String(form.get('email') || '').trim().toLowerCase();
  const phone = String(form.get('phone') || '').trim();
  const company = String(form.get('company') || '').trim();
  const website = String(form.get('website') || '').trim();
  const password = String(form.get('password') || '');
  const confirmPassword = String(form.get('confirmPassword') || '');

  if (!fullName || !email || !phone || !company || !website || !password) {
    return json({ error: 'Toate câmpurile obligatorii trebuie completate.' }, { status: 400 });
  }
  const phoneDigits = phone.replace(/\D/g, '');
  if (phoneDigits.length < 9 || phoneDigits.length > 15) {
    return json({ error: 'Numărul de telefon nu pare valid. Folosește formatul +40 7XX XXX XXX.' }, { status: 400 });
  }
  if (password.length < 8) {
    return json({ error: 'Parola trebuie să aibă minim 8 caractere.' }, { status: 400 });
  }
  if (password !== confirmPassword) {
    return json({ error: 'Parolele nu coincid.' }, { status: 400 });
  }

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return json({ error: 'Există deja un cont cu acest email.' }, { status: 400 });
  }

  const passwordHash = await hashPassword(password);
  const verifyToken = crypto.randomBytes(32).toString('hex');

  const newUser = await db.user.create({
    data: {
      email,
      fullName,
      phone,
      company: `${company} | ${website}`,
      passwordHash,
      verifyToken,
      // New users start on FREE. Trial pe Growth se activează cu cod în /pricing-analysis (KIMONO14 + Stripe Checkout cu card).
      subscription: { create: { plan: 'FREE', status: 'ACTIVE' } },
    },
  });

  // Log activity (best-effort, doesn't block flow)
  try {
    const { logActivity } = await import('~/lib/activity.server');
    await logActivity({
      type: 'signup',
      description: `${fullName} (${email}) și-a creat cont — ${company}`,
      actorUserId: newUser.id,
      targetUserId: newUser.id,
      metadata: { website, phone },
    });
  } catch {}

  const verifyUrl = `${process.env.APP_URL || 'https://bi.kimonogroup.ro'}/verify/${verifyToken}`;
  console.log(`[REGISTER] New account: ${email} | Verify URL: ${verifyUrl}`);

  // Auto-verify if SMTP not configured or env flag set
  const skipVerify = process.env.SKIP_EMAIL_VERIFICATION === 'true' || (!process.env.SMTP_USER && !process.env.SMTP_PASS);
  if (skipVerify) {
    await db.user.update({ where: { email }, data: { emailVerified: true, verifyToken: null } });
    return json({ success: `Cont creat și activat. Te poți conecta acum.`, registeredEmail: email, autoVerified: true });
  }

  let emailSent = false;
  try {
    await sendVerifyEmail(email, verifyToken);
    emailSent = true;
  } catch (e) {
    console.error(`[REGISTER] Email send failed for ${email}:`, e);
  }

  return json({
    success: emailSent
      ? `Cont creat. Am trimis un link de confirmare la ${email}.`
      : `Cont creat. Nu am putut trimite email-ul de confirmare. Contactează suportul la office@kimonogroup.ro pentru activarea contului.`,
    registeredEmail: email,
    emailSent,
  });
}

export default function RegisterPage() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';

  if (actionData && 'success' in actionData && actionData.success) {
    return (
      <div style={{
        minHeight: '100vh', background: 'var(--bg-page)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px',
      }}>
        <div style={{ width: '100%', maxWidth: 400 }}>
          <Logo subtitle="Cont creat cu succes" />
          <div className="card" style={{ padding: '32px 28px', textAlign: 'center' }}>
            <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--success-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <span style={{ fontSize: 24 }}>📩</span>
            </div>
            <h2 style={{ fontSize: 17, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 10 }}>Verifică inbox-ul</h2>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 20 }}>
              Am trimis un email la <strong style={{ color: 'var(--text-primary)' }}>{(actionData as any).registeredEmail}</strong>.
              Apasă butonul din email pentru activarea contului.
            </p>
            <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 20 }}>
              Nu l-ai primit?{' '}
              <Link to="/resend" style={{ color: 'var(--kimono-orange)', fontWeight: 600 }}>Retrimite link-ul</Link>
            </p>
            <Link to="/login" className="btn btn-secondary" style={{ width: '100%', display: 'block', textAlign: 'center' }}>
              Înapoi la login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--bg-page)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px',
    }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <Logo subtitle="Creează cont gratuit" />

        <div className="card" style={{ padding: '28px 28px' }}>
          <Form method="post">
            {actionData && 'error' in actionData && actionData.error && (
              <div className="alert alert-error" style={{ marginBottom: 20 }}>{actionData.error}</div>
            )}

            {/* Honeypot — invisible to real users, bots auto-fill it */}
            <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', top: '-9999px', opacity: 0, height: 0, overflow: 'hidden' }}>
              <label htmlFor="fax_number">Fax</label>
              <input type="text" id="fax_number" name="fax_number" tabIndex={-1} autoComplete="off" />
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', display: 'block', marginBottom: 6 }}>Nume complet *</label>
              <input name="fullName" type="text" className="form-input" placeholder="Ion Popescu" required autoFocus style={{ width: '100%' }} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', display: 'block', marginBottom: 6 }}>Companie *</label>
                <input name="company" type="text" className="form-input" placeholder="Numele companiei" required style={{ width: '100%' }} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', display: 'block', marginBottom: 6 }}>Website *</label>
                <input name="website" type="url" className="form-input" placeholder="https://magazin.ro" required style={{ width: '100%' }} />
              </div>
            </div>

            <div className="kbi-form-row" style={{ marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', display: 'block', marginBottom: 6 }}>Email *</label>
                <input name="email" type="email" className="form-input" placeholder="tu@exemplu.com" required style={{ width: '100%' }} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', display: 'block', marginBottom: 6 }}>Telefon *</label>
                <input name="phone" type="tel" className="form-input" placeholder="+40 7XX XXX XXX" required minLength={9} autoComplete="tel" style={{ width: '100%' }} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', display: 'block', marginBottom: 6 }}>Parolă *</label>
                <input name="password" type="password" className="form-input" placeholder="Min. 8 caractere" required minLength={8} style={{ width: '100%' }} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', display: 'block', marginBottom: 6 }}>Confirmare *</label>
                <input name="confirmPassword" type="password" className="form-input" placeholder="Repetă parola" required style={{ width: '100%' }} />
              </div>
            </div>

            <button type="submit" className="btn btn-primary" disabled={isSubmitting} style={{ width: '100%', height: 42, fontSize: 14, textAlign: 'center', justifyContent: 'center' }}>
              {isSubmitting ? 'Se creează contul...' : 'Creează cont gratuit'}
            </button>

            <p style={{ fontSize: 11, color: 'var(--text-secondary)', textAlign: 'center', marginTop: 14, lineHeight: 1.5 }}>
              Prin creare cont, ești de acord cu{' '}
              <Link to="/termeni" style={{ color: 'var(--text-secondary)' }}>Termenii</Link>
              {' '}și{' '}
              <Link to="/politica-confidentialitate" style={{ color: 'var(--text-secondary)' }}>Politica de confidențialitate</Link>.
            </p>
          </Form>
        </div>

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: 'var(--text-secondary)' }}>
          Ai deja cont?{' '}
          <Link to="/login" style={{ color: 'var(--kimono-orange)', fontWeight: 600 }}>Conectează-te</Link>
        </p>
      </div>
    </div>
  );
}

function Logo({ subtitle }: { subtitle: string }) {
  return (
    <div style={{ textAlign: 'center', marginBottom: 32 }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.5px' }}>
          <img src="/logo-kimono-bi.svg" alt="Kimono BI" style={{ height: 32, width: 'auto' }} />
        </span>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{subtitle}</p>
    </div>
  );
}
