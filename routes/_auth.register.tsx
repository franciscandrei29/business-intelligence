import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json, redirect } from '@remix-run/node';
import { Form, Link, useActionData, useNavigation } from '@remix-run/react';
import crypto from 'crypto';
import { getUserFromRequest } from '~/lib/auth/session.server';
import { hashPassword } from '~/lib/auth/password.server';
import { sendVerifyEmail } from '~/lib/auth/email.server';
import { db } from '~/lib/db.server';

export const meta: MetaFunction = () => [{ title: 'Creeaza cont — Kimono BI' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (user) return redirect('/dashboard');
  return json({});
}

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData();

  const firstName = String(form.get('firstName') || '').trim();
  const lastName  = String(form.get('lastName')  || '').trim();
  const email     = String(form.get('email')     || '').trim().toLowerCase();
  const phone     = String(form.get('phone')     || '').trim() || null;
  const company   = String(form.get('company')   || '').trim();
  const website   = String(form.get('website')   || '').trim() || null;
  const employeeCount = String(form.get('employeeCount') || '').trim() || null;
  const industry  = String(form.get('industry')  || '').trim() || null;
  const referralSource = String(form.get('referralSource') || '').trim() || null;
  const password        = String(form.get('password')        || '');
  const confirmPassword = String(form.get('confirmPassword') || '');
  const gdprConsent     = form.get('gdprConsent') === 'on';
  const newsletterConsent = form.get('newsletterConsent') === 'on';

  // Validari
  if (!firstName || !lastName || !email || !company || !password) {
    return json({ error: 'Campurile marcate cu * sunt obligatorii.' }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'Adresa de email nu este valida.' }, { status: 400 });
  }
  if (password.length < 8) {
    return json({ error: 'Parola trebuie sa aiba minim 8 caractere.' }, { status: 400 });
  }
  if (password !== confirmPassword) {
    return json({ error: 'Parolele nu coincid.' }, { status: 400 });
  }
  if (!gdprConsent) {
    return json({ error: 'Trebuie sa accepti Politica de Confidentialitate si GDPR pentru a crea un cont.' }, { status: 400 });
  }

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return json({ error: 'Exista deja un cont cu acest email.' }, { status: 400 });
  }

  const passwordHash = await hashPassword(password);
  const verifyToken  = crypto.randomBytes(32).toString('hex');
  const fullName     = `${firstName} ${lastName}`;

  // Normalizeaza website (adauga https:// daca lipseste)
  let websiteNorm: string | null = null;
  if (website) {
    websiteNorm = website.startsWith('http') ? website : `https://${website}`;
  }

  await db.user.create({
    data: {
      email,
      fullName,
      firstName,
      lastName,
      company,
      website: websiteNorm,
      phone,
      employeeCount,
      industry,
      referralSource,
      gdprConsent,
      newsletterConsent,
      passwordHash,
      verifyToken,
      subscription: {
        create: { plan: 'FREE', status: 'ACTIVE' },
      },
    },
  });

  try {
    await sendVerifyEmail(email, verifyToken);
  } catch (e) {
    console.error('Failed to send verify email:', e);
  }

  return json({
    success: 'Cont creat cu succes! Verifica email-ul pentru a activa contul.',
  });
}

export default function RegisterPage() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';

  return (
    <div className="auth-page auth-page--wide">
      <div className="auth-card auth-card--wide">
        <div className="auth-logo">
          <h1>Kimono <span>BI</span></h1>
          <p className="auth-subtitle">Creeaza-ti contul gratuit — 14 zile trial fara card</p>
        </div>

        <Form method="post" noValidate>
          {actionData && 'error' in actionData && (
            <div className="alert alert-error">{actionData.error}</div>
          )}
          {actionData && 'success' in actionData && (
            <div className="alert alert-success">{actionData.success}</div>
          )}

          {/* ── Sectiunea 1: Date personale ── */}
          <div className="form-section">
            <div className="form-section-title">Date personale</div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label" htmlFor="firstName">Prenume *</label>
                <input
                  id="firstName"
                  name="firstName"
                  type="text"
                  className="form-input"
                  placeholder="Ion"
                  required
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="lastName">Nume *</label>
                <input
                  id="lastName"
                  name="lastName"
                  type="text"
                  className="form-input"
                  placeholder="Popescu"
                  required
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label" htmlFor="email">Email *</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  className="form-input"
                  placeholder="ion@companie.ro"
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="phone">Telefon</label>
                <input
                  id="phone"
                  name="phone"
                  type="tel"
                  className="form-input"
                  placeholder="+40 7xx xxx xxx"
                />
              </div>
            </div>
          </div>

          {/* ── Sectiunea 2: Date despre business ── */}
          <div className="form-section">
            <div className="form-section-title">Date despre business</div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label" htmlFor="company">Denumire firma *</label>
                <input
                  id="company"
                  name="company"
                  type="text"
                  className="form-input"
                  placeholder="Exemplu SRL"
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="website">Website</label>
                <input
                  id="website"
                  name="website"
                  type="text"
                  className="form-input"
                  placeholder="www.magazinul-tau.ro"
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label" htmlFor="employeeCount">Nr. angajati</label>
                <select id="employeeCount" name="employeeCount" className="form-input form-select">
                  <option value="">Selecteaza</option>
                  <option value="1">Sunt singur (freelancer / solo founder)</option>
                  <option value="2-10">2 - 10 angajati</option>
                  <option value="11-50">11 - 50 angajati</option>
                  <option value="51-200">51 - 200 angajati</option>
                  <option value="200+">Peste 200 angajati</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="industry">Domeniu de activitate</label>
                <select id="industry" name="industry" className="form-input form-select">
                  <option value="">Selecteaza</option>
                  <option value="fashion">Moda si imbracaminte</option>
                  <option value="electronics">Electronice si IT</option>
                  <option value="home-garden">Casa si gradina</option>
                  <option value="beauty">Frumusete si sanatate</option>
                  <option value="food-beverage">Alimente si bauturi</option>
                  <option value="sports">Sport si fitness</option>
                  <option value="kids">Copii si jucarii</option>
                  <option value="auto">Auto si moto</option>
                  <option value="b2b">B2B / Servicii profesionale</option>
                  <option value="marketplace">Marketplace / Multi-categorie</option>
                  <option value="other">Alt domeniu</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="referralSource">Cum ai aflat de Kimono BI?</label>
              <select id="referralSource" name="referralSource" className="form-input form-select">
                <option value="">Selecteaza (optional)</option>
                <option value="google">Cautare Google</option>
                <option value="facebook">Facebook / Instagram</option>
                <option value="linkedin">LinkedIn</option>
                <option value="recommendation">Recomandare de la cineva</option>
                <option value="event">Eveniment / Conferinta</option>
                <option value="blog">Blog / Articol</option>
                <option value="other">Alt canal</option>
              </select>
            </div>
          </div>

          {/* ── Sectiunea 3: Securitate ── */}
          <div className="form-section">
            <div className="form-section-title">Securitate</div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label" htmlFor="password">Parola *</label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  className="form-input"
                  placeholder="Minim 8 caractere"
                  required
                  minLength={8}
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="confirmPassword">Confirma parola *</label>
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  className="form-input"
                  placeholder="Repeta parola"
                  required
                />
              </div>
            </div>
          </div>

          {/* ── Consimtaminte GDPR ── */}
          <div className="form-section form-section--consents">
            <div className="form-checkbox-group">
              <input
                id="gdprConsent"
                name="gdprConsent"
                type="checkbox"
                className="form-checkbox"
                required
              />
              <label htmlFor="gdprConsent" className="form-checkbox-label">
                Am citit si accept{' '}
                <Link to="/politica-confidentialitate" target="_blank" rel="noopener noreferrer">
                  Politica de Confidentialitate
                </Link>
                {' '}si{' '}
                <Link to="/gdpr" target="_blank" rel="noopener noreferrer">
                  Politica GDPR
                </Link>
                . Sunt de acord cu prelucrarea datelor personale in scopul furnizarii serviciului. *
              </label>
            </div>

            <div className="form-checkbox-group">
              <input
                id="newsletterConsent"
                name="newsletterConsent"
                type="checkbox"
                className="form-checkbox"
              />
              <label htmlFor="newsletterConsent" className="form-checkbox-label">
                Vreau sa primesc sfaturi despre eCommerce, noutati despre platforma si rapoarte saptamanale. (Optional)
              </label>
            </div>
          </div>

          <button type="submit" className="btn btn-primary btn-full" disabled={isSubmitting}>
            {isSubmitting ? 'Se creeaza contul...' : 'Incepe trial gratuit 14 zile'}
          </button>

          <p className="auth-terms-note">
            Prin crearea contului esti de acord cu{' '}
            <Link to="/termeni" target="_blank" rel="noopener noreferrer">Termenii si Conditiile</Link>.
            {' '}Nu este necesar un card de credit pentru trial.
          </p>
        </Form>

        <div className="auth-footer">
          Ai deja cont? <Link to="/login">Conecteaza-te</Link>
        </div>
      </div>
    </div>
  );
}
