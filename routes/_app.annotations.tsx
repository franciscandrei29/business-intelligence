import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { Form, useActionData, useLoaderData, useNavigation } from '@remix-run/react';
import { requireUser } from '~/lib/auth/requireAuth.server';
import { db } from '~/lib/db.server';
import { addAnnotation, getAnnotations, deleteAnnotation } from '~/lib/annotations';
import { StickyNote, Plus, Trash2 } from 'lucide-react';

export const meta: MetaFunction = () => [{ title: 'Adnotari — Kimono BI' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const stores = await db.storeConnection.findMany({
    where: { userId: user.id },
    select: { id: true, name: true },
  });
  const url = new URL(request.url);
  const selectedStoreId = url.searchParams.get('store') || stores[0]?.id;
  const annotations = selectedStoreId ? getAnnotations(selectedStoreId) : [];
  return json({ stores, selectedStoreId, annotations });
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  const intent = String(form.get('intent'));

  if (intent === 'add') {
    const storeId = String(form.get('storeId'));
    const date = String(form.get('date'));
    const text = String(form.get('text') || '').trim();
    const category = String(form.get('category') || 'other') as any;

    if (!date || !text) return json({ error: 'Data si textul sunt obligatorii.' }, { status: 400 });

    const store = await db.storeConnection.findFirst({ where: { id: storeId, userId: user.id } });
    if (!store) return json({ error: 'Magazin negasit.' }, { status: 404 });

    addAnnotation(user.id, storeId, date, text, category);
    return json({ success: 'Adnotare adaugata.' });
  }

  if (intent === 'delete') {
    const annotationId = String(form.get('annotationId'));
    deleteAnnotation(user.id, annotationId);
    return json({ success: 'Adnotare stearsa.' });
  }

  return json({ error: 'Unknown intent' }, { status: 400 });
}

const CATEGORY_LABELS: Record<string, string> = {
  campaign: 'Campanie',
  promotion: 'Promotie',
  product_launch: 'Lansare produs',
  issue: 'Problema tehnica',
  other: 'Altele',
};

const CATEGORY_COLORS: Record<string, string> = {
  campaign: '#3498db',
  promotion: '#2ecc71',
  product_launch: '#9b59b6',
  issue: '#e74c3c',
  other: '#95a5a6',
};

export default function AnnotationsPage() {
  const { stores, selectedStoreId, annotations } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Adnotari</h1>
      </div>

      <div className="info-box">
        <p>
          Adauga adnotari pe timeline-ul magazinului pentru a marca evenimentele importante: lansari de campanii, promotii, probleme tehnice. Adnotarile apar pe graficele din Dashboard si Revenue Forecast pentru a corela evenimentele cu performanta.
        </p>
      </div>

      {actionData?.success && <div className="alert alert-success">{actionData.success}</div>}
      {actionData?.error && <div className="alert alert-error">{actionData.error}</div>}

      {stores.length > 0 && (
        <div className="card" style={{ maxWidth: 700, marginBottom: 'var(--space-md)' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-md)' }}>Adauga adnotare</h3>
          <Form method="post">
            <input type="hidden" name="intent" value="add" />
            <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div className="form-group" style={{ flex: 1, minWidth: 140, marginBottom: 0 }}>
                <label className="form-label">Magazin</label>
                <select name="storeId" className="form-input" defaultValue={selectedStoreId}>
                  {stores.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ flex: 1, minWidth: 140, marginBottom: 0 }}>
                <label className="form-label">Data</label>
                <input name="date" type="date" className="form-input" required />
              </div>
              <div className="form-group" style={{ flex: 1, minWidth: 140, marginBottom: 0 }}>
                <label className="form-label">Categorie</label>
                <select name="category" className="form-input">
                  <option value="campaign">Campanie</option>
                  <option value="promotion">Promotie</option>
                  <option value="product_launch">Lansare produs</option>
                  <option value="issue">Problema tehnica</option>
                  <option value="other">Altele</option>
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-sm)', alignItems: 'flex-end' }}>
              <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                <label className="form-label">Descriere</label>
                <input name="text" type="text" className="form-input" placeholder="ex: Black Friday - 30% discount" required />
              </div>
              <button type="submit" className="btn btn-primary" disabled={isSubmitting} style={{ height: 40 }}>
                <Plus size={16} /> Adauga
              </button>
            </div>
          </Form>
        </div>
      )}

      <div className="card">
        <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-md)' }}>
          <StickyNote size={18} style={{ verticalAlign: 'middle', marginRight: 8 }} />
          Adnotari ({annotations.length})
        </h3>

        {annotations.length === 0 ? (
          <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
            Nicio adnotare inca.
          </div>
        ) : (
          annotations.map((a: any) => (
            <div key={a.id} style={{
              display: 'flex', alignItems: 'center', gap: 'var(--space-sm)',
              padding: '12px 0', borderBottom: '1px solid var(--color-border)',
            }}>
              <div style={{ width: 100, fontSize: '0.8125rem', color: 'var(--color-text-muted)', flexShrink: 0 }}>
                {new Date(a.date).toLocaleDateString('ro-RO')}
              </div>
              <span style={{
                fontSize: '0.7rem', fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                background: (CATEGORY_COLORS[a.category] || '#95a5a6') + '22',
                color: CATEGORY_COLORS[a.category] || '#95a5a6',
                flexShrink: 0,
              }}>
                {CATEGORY_LABELS[a.category] || a.category}
              </span>
              <div style={{ flex: 1, fontSize: '0.875rem', color: 'var(--color-text)' }}>{a.text}</div>
              <Form method="post" style={{ flexShrink: 0 }}>
                <input type="hidden" name="intent" value="delete" />
                <input type="hidden" name="annotationId" value={a.id} />
                <button type="submit" className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.75rem' }} title="Sterge">
                  <Trash2 size={14} />
                </button>
              </Form>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
