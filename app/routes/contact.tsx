import type { ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { Form, Link, useActionData, useNavigation } from '@remix-run/react';
import { PublicNav, PublicFooter } from '~/components/PublicLayout';
import { sendContactMessage } from '~/lib/auth/email.server';

export const meta: MetaFunction = () => [
  { title: 'Contact — Kimono BI' },
  { name: 'description', content: 'Contactează echipa Kimono BI. Suport, parteneriate, oferte personalizate.' },
];

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  const name = String(form.get('name') || '').trim();
  const email = String(form.get('email') || '').trim();
  const phone = String(form.get('phone') || '').trim();
  const subject = String(form.get('subject') || '').trim();
  const message = String(form.get('message') || '').trim();

  if (!name || !email || !phone || !message) {
    return json({ error: 'Completează toate câmpurile obligatorii (nume, email, telefon, mesaj).' }, { status: 400 });
  }
  const phoneDigits = phone.replace(/\D/g, '');
  if (phoneDigits.length < 9 || phoneDigits.length > 15) {
    return json({ error: 'Numărul de telefon nu pare valid. Folosește formatul +40 7XX XXX XXX.' }, { status: 400 });
  }

  try {
    await sendContactMessage({ name, email, phone, subject, message });
  } catch (e) {
    console.error('[Contact] send failed:', e);
    return json({ error: 'Nu am putut trimite mesajul. Scrie-ne direct la office@kimonogroup.ro.' }, { status: 500 });
  }

  return json({ success: true });
}

const CONTACT_OPTIONS = [
  {
    icon: '📧',
    title: 'Email general',
    value: 'office@kimonogroup.ro',
    desc: 'Răspundem în maxim 24h în zilele lucrătoare',
  },
  {
    icon: '🛟',
    title: 'Suport tehnic',
    value: 'support@kimonobi.ro',
    desc: 'Probleme cu platforma, bug-uri, integrări',
  },
  {
    icon: '💼',
    title: 'Parteneriate & Agenții',
    value: 'partners@kimonogroup.ro',
    desc: 'White-label, afiliați, integrări custom',
  },
];

export default function ContactPage() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-page)', fontFamily: 'Inter, sans-serif' }}>
      <PublicNav />

      <div style={{ padding: 'clamp(48px, 7vw, 72px) clamp(20px, 5vw, 32px) clamp(36px, 6vw, 48px)', textAlign: 'center' }}>
        <h1 style={{ fontSize: 'clamp(28px,4vw,40px)', fontWeight: 500, letterSpacing: '-1px', color: 'var(--text-primary)', margin: '0 auto 14px' }}>
          Hai să <span style={{ color: 'var(--kimono-orange)' }}>vorbim</span>
        </h1>
        <p style={{ fontSize: 16, color: 'var(--text-secondary)', margin: '0 auto', maxWidth: 480, lineHeight: 1.6 }}>
          Suntem o echipă mică și răspundem personal la fiecare mesaj.
        </p>
      </div>

      <div className="kbi-contact-grid" style={{ maxWidth: 860, margin: '0 auto', padding: '0 clamp(20px, 5vw, 32px) clamp(48px, 8vw, 80px)' }}>

        {/* Form */}
        <div style={{ background: 'white', border: '0.5px solid var(--border-default)', borderRadius: 12, padding: '28px' }}>
          {actionData && 'success' in actionData && actionData.success ? (
            <div style={{ textAlign: 'center', padding: '40px 20px' }}>
              <div style={{ fontSize: 40, marginBottom: 16 }}>✅</div>
              <h2 style={{ fontSize: 17, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 10 }}>Mesaj trimis!</h2>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                Îți vom răspunde în maxim 24 de ore la adresa de email furnizată.
              </p>
            </div>
          ) : (
            <Form method="post">
              {actionData && 'error' in actionData && (
                <div style={{ background: 'var(--danger-bg)', border: '0.5px solid var(--danger-bg-strong)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--danger-text)', marginBottom: 18 }}>
                  {actionData.error}
                </div>
              )}

              <div className="kbi-form-row" style={{ marginBottom: 14 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', display: 'block', marginBottom: 6 }}>Nume *</label>
                  <input name="name" type="text" className="form-input" placeholder="Ion Popescu" required style={{ width: '100%' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', display: 'block', marginBottom: 6 }}>Email *</label>
                  <input name="email" type="email" className="form-input" placeholder="tu@exemplu.com" required style={{ width: '100%' }} />
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', display: 'block', marginBottom: 6 }}>Telefon *</label>
                <input name="phone" type="tel" className="form-input" placeholder="+40 7XX XXX XXX" required minLength={9} autoComplete="tel" style={{ width: '100%' }} />
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', display: 'block', marginBottom: 6 }}>Subiect</label>
                <select name="subject" className="form-input" style={{ width: '100%' }}>
                  <option value="">Selectează subiectul...</option>
                  <option value="suport">Suport tehnic</option>
                  <option value="vanzari">Întrebare despre prețuri / planuri</option>
                  <option value="demo">Vreau o demonstrație</option>
                  <option value="parteneriat">Parteneriat / Agenție</option>
                  <option value="alt">Altceva</option>
                </select>
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', display: 'block', marginBottom: 6 }}>Mesaj *</label>
                <textarea name="message" className="form-input" placeholder="Scrie mesajul tău..." required rows={5} style={{ width: '100%', resize: 'vertical', minHeight: 120 }} />
              </div>

              <button type="submit" className="btn btn-primary" disabled={isSubmitting} style={{ width: '100%', height: 42, fontSize: 14, justifyContent: 'center', textAlign: 'center' }}>
                {isSubmitting ? 'Se trimite...' : 'Trimite mesajul →'}
              </button>
            </Form>
          )}
        </div>

        {/* Sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {CONTACT_OPTIONS.map((opt) => (
            <div key={opt.title} style={{ background: 'white', border: '0.5px solid var(--border-default)', borderRadius: 10, padding: '16px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <span style={{ fontSize: 20 }}>{opt.icon}</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 3 }}>{opt.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--kimono-orange)', fontWeight: 500, marginBottom: 4 }}>{opt.value}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{opt.desc}</div>
                </div>
              </div>
            </div>
          ))}

          <div style={{ background: 'rgba(216,90,48,0.06)', border: '0.5px solid rgba(216,90,48,0.2)', borderRadius: 10, padding: '16px 18px' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>Program suport</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              Luni – Vineri: <strong style={{ color: 'var(--text-primary)' }}>09:00 – 18:00</strong><br />
              Weekenduri: Email doar<br />
              Timp răspuns: &lt; 24h
            </div>
          </div>
        </div>
      </div>

      <PublicFooter />
    </div>
  );
}