import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { Form, useActionData, useLoaderData, useNavigation } from '@remix-run/react';
import { requireUser, requireUserContext, requireRole } from '~/lib/auth/requireAuth.server';
import { db } from '~/lib/db.server';
import { Save, User, Store, CreditCard } from 'lucide-react';

export const meta: MetaFunction = () => [{ title: 'Setări — Kimono BI' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const ctx = await requireUserContext(request);
  const user = ctx.user;
  const stores = await db.storeConnection.findMany({
    where: { userId: ctx.effectiveOwnerId },
    select: { id: true, name: true, platform: true, settings: true },
  });
  const sub = await db.subscription.findUnique({ where: { userId: ctx.effectiveOwnerId } });
  const canManageStore = ctx.role === 'owner' || ctx.role === 'admin';
  return json({
    user: { fullName: user.fullName, email: user.email, company: user.company },
    stores,
    plan: sub?.plan || 'FREE',
    role: ctx.role,
    canManageStore,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  const intent = String(form.get('intent'));

  if (intent === 'updateProfile') {
    // Profile is per-user — anyone can update their own
    const ctx = await requireUserContext(request);
    const fullName = String(form.get('fullName') || '').trim();
    const company = String(form.get('company') || '').trim() || null;
    if (!fullName) return json({ error: 'Numele este obligatoriu.' }, { status: 400 });
    await db.user.update({ where: { id: ctx.user.id }, data: { fullName, company } });
    return json({ success: 'Profil actualizat.' });
  }

  if (intent === 'updateStoreSettings') {
    // Store settings are team-level — admin only
    const ctx = await requireRole(request, ['owner', 'admin']);
    const storeId = String(form.get('storeId'));
    const store = await db.storeConnection.findFirst({ where: { id: storeId, userId: ctx.effectiveOwnerId } });
    if (!store) return json({ error: 'Magazin negăsit.' }, { status: 404 });
    const aiLanguage = String(form.get('aiLanguage') || 'ro');
    const aiTone = String(form.get('aiTone') || 'professional');
    const stockThreshold = parseInt(String(form.get('stockThreshold') || '5'), 10);
    const stockEmailTo = String(form.get('stockEmailTo') || '').trim() || null;
    const rfmRecencyDays = parseInt(String(form.get('rfmRecencyDays') || '365'), 10);
    const shippingCostPerOrder = form.get('shippingCostPerOrder') ? parseFloat(String(form.get('shippingCostPerOrder'))) : null;
    const returnCost = form.get('returnCost') ? parseFloat(String(form.get('returnCost'))) : null;
    const cardFeePercent = form.get('cardFeePercent') ? parseFloat(String(form.get('cardFeePercent'))) : null;
    const cardFeeFixed = form.get('cardFeeFixed') ? parseFloat(String(form.get('cardFeeFixed'))) : null;
    const crossBorderFeePercent = form.get('crossBorderFeePercent') ? parseFloat(String(form.get('crossBorderFeePercent'))) : null;
    const shippingCostIntl = form.get('shippingCostIntl') ? parseFloat(String(form.get('shippingCostIntl'))) : null;
    await db.storeSettings.upsert({
      where: { storeConnectionId: storeId },
      create: { storeConnectionId: storeId, aiLanguage, aiTone, stockThreshold, stockEmailTo, rfmRecencyDays, shippingCostPerOrder, returnCost, cardFeePercent, cardFeeFixed, crossBorderFeePercent, shippingCostIntl },
      update: { aiLanguage, aiTone, stockThreshold, stockEmailTo, rfmRecencyDays, shippingCostPerOrder, returnCost, cardFeePercent, cardFeeFixed, crossBorderFeePercent, shippingCostIntl },
    });
    return json({ success: 'Setările magazinului au fost actualizate.' });
  }

  return json({ error: 'Unknown intent' }, { status: 400 });
}

const PLAN_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  FREE:    { label: 'Free',    color: '#5F5E5A', bg: 'var(--bg-tertiary)' },
  STARTER: { label: 'Starter', color: '#0369a1', bg: 'rgba(3,105,161,0.1)' },
  GROWTH:  { label: 'Growth',  color: '#7c3aed', bg: 'rgba(124,58,237,0.1)' },
  SCALE:   { label: 'Scale',   color: '#D85A30', bg: 'rgba(216,90,48,0.1)' },
};

export default function SettingsPage() {
  const { user, stores, plan, role, canManageStore } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';
  const planCfg = PLAN_CONFIG[plan] || PLAN_CONFIG.FREE;

  return (
    <div style={{ maxWidth: 640 }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Setări</h1>
          <p className="page-subtitle">Profil, magazine și preferințe</p>
        </div>
      </div>

      {actionData?.success && <div className="alert alert-success" style={{ marginBottom: 20 }}>{actionData.success}</div>}
      {actionData?.error && <div className="alert alert-error" style={{ marginBottom: 20 }}>{actionData.error}</div>}

      {/* Plan badge */}
      <div className="card" style={{ padding: '14px 20px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 36, height: 36, borderRadius: 8, background: planCfg.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <CreditCard size={16} color={planCfg.color} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Plan curent</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: planCfg.color }}>{planCfg.label}</div>
        </div>
        {plan !== 'SCALE' && (
          <a href="/scale" className="btn btn-secondary" style={{ fontSize: 12 }}>Upgrade →</a>
        )}
      </div>

      {/* Profile */}
      <SectionCard icon={<User size={15} />} title="Profil">
        <Form method="post">
          <input type="hidden" name="intent" value="updateProfile" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <FieldGroup label="Nume complet">
              <input name="fullName" type="text" className="form-input" defaultValue={user.fullName} required style={{ width: '100%' }} />
            </FieldGroup>
            <FieldGroup label="Companie">
              <input name="company" type="text" className="form-input" defaultValue={user.company || ''} style={{ width: '100%' }} />
            </FieldGroup>
          </div>
          <FieldGroup label="Email (nu poate fi modificat)">
            <input type="email" className="form-input" value={user.email} disabled style={{ width: '100%', opacity: 0.6 }} />
          </FieldGroup>
          <div style={{ marginTop: 16 }}>
            <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
              <Save size={13} /> Salvează profilul
            </button>
          </div>
        </Form>
      </SectionCard>

      {/* Store settings — admin only */}
      {canManageStore ? (
        stores.map((store: any) => (
          <SectionCard key={store.id} icon={<Store size={15} />} title={`${store.name} · ${store.platform}`}>
            <Form method="post">
              <input type="hidden" name="intent" value="updateStoreSettings" />
              <input type="hidden" name="storeId" value={store.id} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <FieldGroup label="Limba AI">
                  <select name="aiLanguage" className="form-input" defaultValue={store.settings?.aiLanguage || 'ro'} style={{ width: '100%' }}>
                    <option value="ro">Română</option>
                    <option value="en">English</option>
                  </select>
                </FieldGroup>
                <FieldGroup label="Ton AI">
                  <select name="aiTone" className="form-input" defaultValue={store.settings?.aiTone || 'professional'} style={{ width: '100%' }}>
                    <option value="professional">Profesional</option>
                    <option value="friendly">Prietenos</option>
                    <option value="concise">Concis</option>
                  </select>
                </FieldGroup>
                <FieldGroup label="Threshold stoc (zile)">
                  <input name="stockThreshold" type="number" className="form-input" defaultValue={store.settings?.stockThreshold || 5} min={1} max={90} style={{ width: '100%' }} />
                </FieldGroup>
                <FieldGroup label="Fereastră RFM (zile)">
                  <input name="rfmRecencyDays" type="number" className="form-input" defaultValue={store.settings?.rfmRecencyDays || 365} min={30} max={730} style={{ width: '100%' }} />
                </FieldGroup>
              </div>
              <FieldGroup label="Email alerte stoc">
                <input name="stockEmailTo" type="email" className="form-input" defaultValue={store.settings?.stockEmailTo || ''} placeholder="alerte@exemplu.com" style={{ width: '100%' }} />
              </FieldGroup>



              <div style={{ marginTop: 16 }}>
                <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
                  <Save size={13} /> Salvează setările
                </button>
              </div>
            </Form>
          </SectionCard>
        ))
      ) : (
        stores.length > 0 && (
          <SectionCard icon={<Store size={15} />} title="Setări magazine">
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
              Setările magazinului (limba AI, ton, threshold stoc, RFM, email alerte) pot fi modificate doar de Owner sau Admin. Tu ai rolul <strong style={{ color: 'var(--text-primary)' }}>{role}</strong>.
            </p>
          </SectionCard>
        )
      )}
    </div>
  );
}

function SectionCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, paddingBottom: 14, borderBottom: '0.5px solid var(--border-default)' }}>
        <div style={{ color: 'var(--text-secondary)' }}>{icon}</div>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
        {label}
      </label>
      {children}
    </div>
  );
}
