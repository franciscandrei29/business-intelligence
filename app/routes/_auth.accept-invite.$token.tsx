import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json, redirect } from '@remix-run/node';
import { Form, Link, useActionData, useLoaderData, useNavigation } from '@remix-run/react';
import { getInviteByToken, markInviteAccepted } from '~/lib/team';
import { hashPassword } from '~/lib/auth/password.server';
import { createUserSession, getUserFromRequest } from '~/lib/auth/session.server';
import { db } from '~/lib/db.server';

export const meta: MetaFunction = () => [{ title: 'Acceptă invitația — Kimono BI' }];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const token = params.token || '';
  const invite = await getInviteByToken(token);

  if (!invite) {
    return json({ status: 'invalid' as const, error: 'Invitație invalidă sau expirată.' }, { status: 404 });
  }
  if (invite.acceptedAt) {
    return json({ status: 'used' as const, error: 'Invitația a fost deja folosită. Conectează-te direct.' });
  }

  const inviter = await db.user.findUnique({
    where: { id: invite.ownerId },
    select: { fullName: true, company: true, email: true },
  });

  const existingUser = await db.user.findUnique({ where: { email: invite.email } });
  const currentUser = await getUserFromRequest(request);

  return json({
    status: 'ok' as const,
    email: invite.email,
    role: invite.role,
    inviterName: inviter?.fullName || inviter?.email || 'Echipa',
    inviterCompany: inviter?.company || null,
    hasAccount: Boolean(existingUser),
    isLoggedIn: Boolean(currentUser && currentUser.email === invite.email),
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const token = params.token || '';
  const invite = await getInviteByToken(token);

  if (!invite) return json({ error: 'Invitație invalidă sau expirată.' }, { status: 404 });
  if (invite.acceptedAt) return json({ error: 'Invitația a fost deja folosită.' }, { status: 400 });

  const form = await request.formData();
  const firstName = String(form.get('firstName') || '').trim();
  const lastName = String(form.get('lastName') || '').trim();
  const password = String(form.get('password') || '');
  const confirmPassword = String(form.get('confirmPassword') || '');

  if (!firstName || !lastName) {
    return json({ error: 'Numele și prenumele sunt obligatorii.' }, { status: 400 });
  }
  if (password.length < 8) {
    return json({ error: 'Parola trebuie să aibă minim 8 caractere.' }, { status: 400 });
  }
  if (password !== confirmPassword) {
    return json({ error: 'Parolele nu coincid.' }, { status: 400 });
  }

  const existing = await db.user.findUnique({ where: { email: invite.email } });
  if (existing) {
    await markInviteAccepted(token, existing.id);
    return json({ error: 'Există deja un cont cu acest email. Conectează-te cu parola ta existentă — accesul la datele echipei se aplică automat.' }, { status: 400 });
  }

  const inviter = await db.user.findUnique({
    where: { id: invite.ownerId },
    select: { company: true },
  });

  const passwordHash = await hashPassword(password);
  const fullName = `${firstName} ${lastName}`.trim();

  const newUser = await db.user.create({
    data: {
      email: invite.email,
      fullName,
      firstName,
      lastName,
      phone: '',
      company: inviter?.company || null,
      passwordHash,
      emailVerified: true,
      verifyToken: null,
    },
  });

  await markInviteAccepted(token, newUser.id);

  try {
    const { logActivity } = await import('~/lib/activity.server');
    await logActivity({
      type: 'member_joined',
      description: `${newUser.fullName} (${newUser.email}) s-a alăturat echipei ca ${invite.role}`,
      actorUserId: newUser.id,
      targetUserId: invite.ownerId,
      metadata: { role: invite.role, ownerId: invite.ownerId },
    });
  } catch {}

  const cookie = await createUserSession(newUser.id, request);
  return redirect('/dashboard', { headers: { 'Set-Cookie': cookie } });
}

const ROLE_INFO: Record<string, { label: string; bg: string; color: string; desc: string }> = {
  admin:   { label: 'Admin',   bg: 'rgba(216,90,48,0.1)', color: '#A33D14', desc: 'Acces complet la setări și date' },
  analyst: { label: 'Analyst', bg: 'rgba(3,105,161,0.1)', color: '#0A4F76', desc: 'Vizualizare completă și rapoarte' },
  viewer:  { label: 'Viewer',  bg: 'rgba(95,94,90,0.1)',  color: '#525252', desc: 'Acces de citire la dashboard' },
};

export default function AcceptInvitePage() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';

  if (data.status === 'invalid' || data.status === 'used') {
    return (
      <Wrapper subtitle={data.status === 'used' ? 'Invitație folosită' : 'Invitație invalidă'}>
        <div className="card" style={{ padding: '32px 28px', textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>{data.status === 'used' ? '✓' : '⚠️'}</div>
          <h2 style={{ fontSize: 17, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 10 }}>
            {data.status === 'used' ? 'Deja acceptată' : 'Invitație invalidă'}
          </h2>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 20 }}>
            {data.error}
          </p>
          <Link to="/login" className="btn btn-primary" style={{ width: '100%', display: 'block', textAlign: 'center', justifyContent: 'center' }}>
            Mergi la login
          </Link>
        </div>
      </Wrapper>
    );
  }

  const roleInfo = ROLE_INFO[data.role] || ROLE_INFO.viewer;

  return (
    <Wrapper subtitle="Invitație în echipă">
      <div className="card" style={{ padding: '28px 28px' }}>

        {/* Invite preview */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(216,90,48,0.05) 0%, transparent 100%)',
          border: '0.5px solid rgba(216,90,48,0.25)',
          borderRadius: 10,
          padding: '14px 16px',
          marginBottom: 20,
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--kimono-orange)', marginBottom: 8 }}>
            ✉ Invitație
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.55, marginBottom: 10 }}>
            <strong>{data.inviterName}</strong>{data.inviterCompany ? <> de la <strong>{data.inviterCompany}</strong></> : null} te-a invitat să te alături echipei lor în Kimono BI.
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{
              display: 'inline-block',
              padding: '3px 10px',
              background: roleInfo.bg,
              color: roleInfo.color,
              borderRadius: 99,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.4px',
              textTransform: 'uppercase',
            }}>{roleInfo.label}</span>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{roleInfo.desc}</span>
          </div>
        </div>

        <Form method="post">
          {actionData && 'error' in actionData && actionData.error && (
            <div className="alert alert-error" style={{ marginBottom: 16 }}>{actionData.error}</div>
          )}

          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', display: 'block', marginBottom: 6 }}>Email</label>
            <input
              type="email"
              className="form-input"
              value={data.email}
              disabled
              style={{ width: '100%', background: 'var(--bg-page)', color: 'var(--text-secondary)' }}
            />
          </div>

          <div className="kbi-form-row" style={{ marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', display: 'block', marginBottom: 6 }}>Prenume *</label>
              <input name="firstName" type="text" className="form-input" placeholder="Ion" required autoFocus style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', display: 'block', marginBottom: 6 }}>Nume *</label>
              <input name="lastName" type="text" className="form-input" placeholder="Popescu" required style={{ width: '100%' }} />
            </div>
          </div>

          <div className="kbi-form-row" style={{ marginBottom: 18 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', display: 'block', marginBottom: 6 }}>Parolă *</label>
              <input name="password" type="password" className="form-input" placeholder="Min. 8 caractere" required minLength={8} style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', display: 'block', marginBottom: 6 }}>Confirmare *</label>
              <input name="confirmPassword" type="password" className="form-input" placeholder="Repetă parola" required style={{ width: '100%' }} />
            </div>
          </div>

          <button type="submit" className="btn btn-primary" disabled={isSubmitting} style={{ width: '100%', height: 42, fontSize: 14, justifyContent: 'center', textAlign: 'center' }}>
            {isSubmitting ? 'Se creează contul...' : 'Acceptă și intră în echipă →'}
          </button>

          <p style={{ fontSize: 11, color: 'var(--text-secondary)', textAlign: 'center', marginTop: 14, lineHeight: 1.5 }}>
            Datele magazinului vin automat din echipa <strong style={{ color: 'var(--text-primary)' }}>{data.inviterCompany || data.inviterName}</strong>. Nu trebuie să le introduci.
          </p>
        </Form>
      </div>

      <p style={{ textAlign: 'center', marginTop: 18, fontSize: 12, color: 'var(--text-secondary)' }}>
        Ai deja cont?{' '}
        <Link to="/login" style={{ color: 'var(--kimono-orange)', fontWeight: 600 }}>Conectează-te</Link>
      </p>
    </Wrapper>
  );
}

function Wrapper({ subtitle, children }: { subtitle: string; children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: '100vh', background: 'var(--bg-page)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px',
    }}>
      <div style={{ width: '100%', maxWidth: 440 }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--kimono-orange)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 16, fontWeight: 800, color: '#fff', letterSpacing: '-0.5px' }}>K</span>
            </div>
            <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.5px' }}>
              <img src="/logo-kimono-bi.svg" alt="Kimono BI" style={{ height: 32, width: 'auto' }} />
            </span>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{subtitle}</p>
        </div>
        {children}
      </div>
    </div>
  );
}
