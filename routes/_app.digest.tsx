import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { Form, useActionData, useLoaderData, useNavigation } from '@remix-run/react';
import { requireUser } from '~/lib/auth/requireAuth.server';
import { db } from '~/lib/db.server';
import { generateDigestData, buildDigestHtml, sendDigest } from '~/lib/digest/index';
import { Mail, Send, Eye } from 'lucide-react';

export const meta: MetaFunction = () => [{ title: 'Email Digest — Kimono BI' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const stores = await db.storeConnection.findMany({
    where: { userId: user.id },
    select: { id: true, name: true },
  });
  const url = new URL(request.url);
  const selectedStoreId = url.searchParams.get('store') || stores[0]?.id;
  return json({ stores, selectedStoreId, userEmail: user.email });
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  const intent = String(form.get('intent'));
  const storeId = String(form.get('storeId'));
  const period = parseInt(String(form.get('period') || '7'), 10);

  const store = await db.storeConnection.findFirst({ where: { id: storeId, userId: user.id } });
  if (!store) return json({ error: 'Store not found' }, { status: 404 });

  if (intent === 'preview') {
    const data = await generateDigestData(storeId, period);
    const html = buildDigestHtml(data);
    return json({ preview: html, data });
  }

  if (intent === 'send') {
    try {
      await sendDigest(user.id, storeId, period);
      return json({ success: `Raport trimis la ${user.email}` });
    } catch (err: any) {
      return json({ error: `Eroare la trimitere: ${err.message}` }, { status: 500 });
    }
  }

  return json({ error: 'Unknown intent' }, { status: 400 });
}

export default function DigestPage() {
  const { stores, selectedStoreId, userEmail } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Email Digest</h1>
        <p className="page-subtitle">Rapoarte periodice trimise pe email — {userEmail}</p>
      </div>


      <div className="info-box">
        <p>
          Email Digest trimite rapoarte periodice pe email cu KPI-urile magazinului: venit, comenzi, clienti noi, comparatie cu perioada anterioara. Selecteaza perioada (zilnic/saptamanal/lunar), preview raportul si trimite-l.
        </p>
      </div>

      {actionData?.success && <div className="alert alert-success">{actionData.success}</div>}
      {actionData?.error && <div className="alert alert-error">{actionData.error}</div>}

      {/* Controls */}
      <div className="card" style={{ marginBottom: 'var(--space-md)' }}>
        <div style={{ display: 'flex', gap: 'var(--space-md)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Form method="post" style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'flex-end' }}>
            <input type="hidden" name="storeId" value={selectedStoreId || ''} />
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Perioada</label>
              <select name="period" className="form-input" style={{ width: 160 }}>
                <option value="1">Zilnic</option>
                <option value="7" selected>Saptamanal</option>
                <option value="30">Lunar</option>
              </select>
            </div>
            <button type="submit" name="intent" value="preview" className="btn btn-secondary" disabled={isSubmitting}>
              <Eye size={14} />
              Preview
            </button>
            <button type="submit" name="intent" value="send" className="btn btn-primary" disabled={isSubmitting}>
              <Send size={14} />
              {isSubmitting ? 'Se trimite...' : 'Trimite acum'}
            </button>
          </Form>
        </div>
        <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 'var(--space-sm)' }}>
          Raportul saptamanal se trimite automat in fiecare luni la 08:00. Configureaza din Setari.
        </p>
      </div>

      {/* Summary from preview */}
      {actionData?.data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
          <div className="card">
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Venit</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--color-text-heading)' }}>
              {actionData.data.revenue.toLocaleString('ro-RO')} RON
            </div>
            <div style={{ fontSize: '0.6875rem', color: actionData.data.revenueDelta >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
              {actionData.data.revenueDelta >= 0 ? '+' : ''}{actionData.data.revenueDelta}% vs perioada anterioara
            </div>
          </div>
          <div className="card">
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Comenzi</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--color-text-heading)' }}>{actionData.data.orders}</div>
          </div>
          <div className="card">
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Clienti noi</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--color-text-heading)' }}>{actionData.data.customers}</div>
          </div>
          <div className="card">
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Churn risk</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: actionData.data.churnAtRisk > 0 ? 'var(--color-danger)' : 'var(--color-success)' }}>
              {actionData.data.churnAtRisk}
            </div>
          </div>
        </div>
      )}

      {/* Email preview */}
      {actionData?.preview && (
        <div className="card">
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-md)' }}>
            Preview email
          </h3>
          <div style={{ background: '#0f0f23', borderRadius: 'var(--radius-md)', overflow: 'hidden', maxHeight: 600, overflowY: 'auto' }}>
            <iframe
              srcDoc={actionData.preview}
              style={{ width: '100%', height: 500, border: 'none' }}
              title="Email preview"
            />
          </div>
        </div>
      )}

      {!actionData?.preview && !actionData?.data && (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}>
          <Mail size={48} style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-md)' }} />
          <p style={{ color: 'var(--color-text-muted)' }}>
            Selecteaza o perioada si apasa "Preview" pentru a vedea raportul, sau "Trimite acum" pentru a-l primi pe email.
          </p>
        </div>
      )}
    </div>
  );
}
