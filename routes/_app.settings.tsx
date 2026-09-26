import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { Form, useActionData, useLoaderData, useNavigation } from '@remix-run/react';
import { requireUser } from '~/lib/auth/requireAuth.server';
import { db } from '~/lib/db.server';
import { Save } from 'lucide-react';

export const meta: MetaFunction = () => [{ title: 'Setari — Kimono BI' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);

  const stores = await db.storeConnection.findMany({
    where: { userId: user.id },
    select: { id: true, name: true, platform: true, settings: true },
  });

  const sub = await db.subscription.findUnique({ where: { userId: user.id } });

  return json({ user: { fullName: user.fullName, email: user.email, company: user.company }, stores, plan: sub?.plan || 'FREE' });
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  const intent = String(form.get('intent'));

  if (intent === 'updateProfile') {
    const fullName = String(form.get('fullName') || '').trim();
    const company = String(form.get('company') || '').trim() || null;
    if (!fullName) return json({ error: 'Numele este obligatoriu.' }, { status: 400 });

    await db.user.update({ where: { id: user.id }, data: { fullName, company } });
    return json({ success: 'Profil actualizat.' });
  }

  if (intent === 'updateStoreSettings') {
    const storeId = String(form.get('storeId'));
    const store = await db.storeConnection.findFirst({ where: { id: storeId, userId: user.id } });
    if (!store) return json({ error: 'Magazin negasit.' }, { status: 404 });

    const aiLanguage = String(form.get('aiLanguage') || 'ro');
    const aiTone = String(form.get('aiTone') || 'professional');
    const stockThreshold = parseInt(String(form.get('stockThreshold') || '5'), 10);
    const stockEmailTo = String(form.get('stockEmailTo') || '').trim() || null;
    const rfmRecencyDays = parseInt(String(form.get('rfmRecencyDays') || '365'), 10);

    await db.storeSettings.upsert({
      where: { storeConnectionId: storeId },
      create: { storeConnectionId: storeId, aiLanguage, aiTone, stockThreshold, stockEmailTo, rfmRecencyDays },
      update: { aiLanguage, aiTone, stockThreshold, stockEmailTo, rfmRecencyDays },
    });

    return json({ success: 'Setarile magazinului au fost actualizate.' });
  }

  return json({ error: 'Unknown intent' }, { status: 400 });
}

export default function SettingsPage() {
  const { user, stores, plan } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Setari</h1>
      </div>

      {actionData?.success && <div className="alert alert-success">{actionData.success}</div>}
      {actionData?.error && <div className="alert alert-error">{actionData.error}</div>}

      {/* Profile */}
      <div className="card" style={{ maxWidth: 560, marginBottom: 'var(--space-md)' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-md)' }}>Profil</h3>
        <Form method="post">
          <input type="hidden" name="intent" value="updateProfile" />
          <div className="form-group">
            <label className="form-label">Nume complet</label>
            <input name="fullName" type="text" className="form-input" defaultValue={user.fullName} required />
          </div>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input type="email" className="form-input" value={user.email} disabled style={{ opacity: 0.6 }} />
          </div>
          <div className="form-group">
            <label className="form-label">Companie</label>
            <input name="company" type="text" className="form-input" defaultValue={user.company || ''} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
            <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
              <Save size={16} /> Salveaza
            </button>
            <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>Plan: <strong>{plan}</strong></span>
          </div>
        </Form>
      </div>

      {/* Store settings */}
      {stores.map((store: any) => (
        <div key={store.id} className="card" style={{ maxWidth: 560, marginBottom: 'var(--space-md)' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-md)' }}>
            {store.name} ({store.platform})
          </h3>
          <Form method="post">
            <input type="hidden" name="intent" value="updateStoreSettings" />
            <input type="hidden" name="storeId" value={store.id} />

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 'var(--space-md)' }}>
              <div className="form-group">
                <label className="form-label">Limba AI</label>
                <select name="aiLanguage" className="form-input" defaultValue={store.settings?.aiLanguage || 'ro'}>
                  <option value="ro">Romana</option>
                  <option value="en">English</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Ton AI</label>
                <select name="aiTone" className="form-input" defaultValue={store.settings?.aiTone || 'professional'}>
                  <option value="professional">Profesional</option>
                  <option value="friendly">Prietenos</option>
                  <option value="concise">Concis</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Threshold stoc (zile)</label>
                <input name="stockThreshold" type="number" className="form-input" defaultValue={store.settings?.stockThreshold || 5} min={1} max={90} />
              </div>
              <div className="form-group">
                <label className="form-label">Fereastra RFM (zile)</label>
                <input name="rfmRecencyDays" type="number" className="form-input" defaultValue={store.settings?.rfmRecencyDays || 365} min={30} max={730} />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Email alerte stoc</label>
              <input name="stockEmailTo" type="email" className="form-input" defaultValue={store.settings?.stockEmailTo || ''} placeholder="alerte@exemplu.com" />
            </div>

            <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
              <Save size={16} /> Salveaza setarile
            </button>
          </Form>
        </div>
      ))}
    </div>
  );
}
