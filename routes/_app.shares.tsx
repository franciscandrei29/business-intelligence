import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { Form, useActionData, useLoaderData, useNavigation } from '@remix-run/react';
import { requireUser } from '~/lib/auth/requireAuth.server';
import { db } from '~/lib/db.server';
import { createShareLink, deleteShareLink, listShareLinks } from '~/lib/share';
import { Share2, Trash2, Copy, ExternalLink } from 'lucide-react';
import { useState } from 'react';

export const meta: MetaFunction = () => [{ title: 'Rapoarte partajate — Kimono BI' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const stores = await db.storeConnection.findMany({
    where: { userId: user.id },
    select: { id: true, name: true },
  });
  const shares = listShareLinks(user.id);
  const url = new URL(request.url);
  const selectedStoreId = url.searchParams.get('store') || stores[0]?.id;
  return json({ stores, shares, selectedStoreId });
}

async function generateReportData(storeId: string, reportType: string) {
  const { db } = await import('~/lib/db.server');

  if (reportType === 'dashboard') {
    const [productCount, orderCount, customerCount, revenue] = await Promise.all([
      db.product.count({ where: { storeConnectionId: storeId } }),
      db.order.count({ where: { storeConnectionId: storeId } }),
      db.customer.count({ where: { storeConnectionId: storeId } }),
      db.order.aggregate({ where: { storeConnectionId: storeId }, _sum: { total: true } }),
    ]);
    return { type: 'Dashboard Summary', productCount, orderCount, customerCount, totalRevenue: Number(revenue._sum.total || 0) };
  }

  if (reportType === 'rfm') {
    const segments = await db.rfmSegment.findMany({
      where: { storeConnectionId: storeId },
      select: { segment: true, customerId: true },
    });
    const segmentCounts: Record<string, number> = {};
    segments.forEach((s: any) => { segmentCounts[s.segment] = (segmentCounts[s.segment] || 0) + 1; });
    return { type: 'RFM Analysis', totalCustomers: segments.length, segments: segmentCounts };
  }

  if (reportType === 'forecast') {
    const orders = await db.order.findMany({
      where: { storeConnectionId: storeId },
      select: { total: true, placedAt: true },
      orderBy: { placedAt: 'desc' },
      take: 90,
    });
    const last30 = orders.filter((o: any) => new Date(o.placedAt) > new Date(Date.now() - 30 * 86400000));
    const rev30 = last30.reduce((s: number, o: any) => s + Number(o.total), 0);
    return { type: 'Revenue Forecast', last30DaysRevenue: rev30, last30DaysOrders: last30.length, avgOrderValue: last30.length ? rev30 / last30.length : 0 };
  }

  if (reportType === 'audit') {
    const [products, orders, customers] = await Promise.all([
      db.product.count({ where: { storeConnectionId: storeId } }),
      db.order.count({ where: { storeConnectionId: storeId } }),
      db.customer.count({ where: { storeConnectionId: storeId } }),
    ]);
    return { type: 'BI Audit', products, orders, customers, dataQuality: products > 0 && orders > 0 ? 'Good' : 'Needs attention' };
  }

  return { type: reportType, note: 'Snapshot generated' };
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  const intent = String(form.get('intent'));

  if (intent === 'create') {
    const storeId = String(form.get('storeId'));
    const reportType = String(form.get('reportType')) as any;
    const expiresInDays = parseInt(String(form.get('expiresInDays') || '30'), 10);

    const store = await db.storeConnection.findFirst({ where: { id: storeId, userId: user.id } });
    if (!store) return json({ error: 'Magazin negasit.' }, { status: 404 });

    const reportData = await generateReportData(storeId, reportType);
    const share = createShareLink(user.id, reportType, reportData, store.name, expiresInDays);
    return json({ success: 'Link creat cu succes!', shareId: share.shareId });
  }

  if (intent === 'delete') {
    const shareId = String(form.get('shareId'));
    deleteShareLink(user.id, shareId);
    return json({ success: 'Link sters.' });
  }

  return json({ error: 'Unknown intent' }, { status: 400 });
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-secondary"
      style={{ padding: '4px 8px', fontSize: '0.75rem' }}
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
    >
      <Copy size={14} /> {copied ? 'Copiat!' : 'Copiaza'}
    </button>
  );
}

const REPORT_LABELS: Record<string, string> = {
  dashboard: 'Dashboard Summary',
  rfm: 'RFM Analysis',
  forecast: 'Revenue Forecast',
  audit: 'BI Audit',
};

export default function SharesPage() {
  const { stores, shares, selectedStoreId } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Rapoarte partajate</h1>
      </div>

      <div className="info-box">
        <p>
          Genereaza link-uri publice pentru rapoartele tale. Trimite link-ul investitorilor, partenerilor sau echipei fara ca ei sa aiba nevoie de cont. Link-urile expira automat.
        </p>
      </div>

      {actionData?.success && <div className="alert alert-success">{actionData.success}</div>}
      {actionData?.error && <div className="alert alert-error">{actionData.error}</div>}

      {stores.length > 0 && (
        <div className="card" style={{ maxWidth: 700, marginBottom: 'var(--space-md)' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-md)' }}>Creeaza link partajabil</h3>
          <Form method="post">
            <input type="hidden" name="intent" value="create" />
            <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div className="form-group" style={{ flex: 1, minWidth: 150, marginBottom: 0 }}>
                <label className="form-label">Magazin</label>
                <select name="storeId" className="form-input" defaultValue={selectedStoreId}>
                  {stores.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ flex: 1, minWidth: 150, marginBottom: 0 }}>
                <label className="form-label">Tip raport</label>
                <select name="reportType" className="form-input">
                  <option value="dashboard">Dashboard Summary</option>
                  <option value="rfm">RFM Analysis</option>
                  <option value="forecast">Revenue Forecast</option>
                  <option value="audit">BI Audit</option>
                </select>
              </div>
              <div className="form-group" style={{ flex: 1, minWidth: 120, marginBottom: 0 }}>
                <label className="form-label">Expira in</label>
                <select name="expiresInDays" className="form-input">
                  <option value="7">7 zile</option>
                  <option value="30">30 zile</option>
                  <option value="90">90 zile</option>
                </select>
              </div>
              <button type="submit" className="btn btn-primary" disabled={isSubmitting} style={{ height: 40 }}>
                <Share2 size={16} /> Genereaza
              </button>
            </div>
          </Form>
        </div>
      )}

      <div className="card">
        <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-md)' }}>Link-uri active</h3>

        {shares.length === 0 ? (
          <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
            Niciun link partajat inca.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem', minWidth: 600 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <th style={{ textAlign: 'left', padding: '8px 4px', color: 'var(--color-text-muted)', fontWeight: 600, fontSize: '0.8125rem' }}>TIP</th>
                  <th style={{ textAlign: 'left', padding: '8px 4px', color: 'var(--color-text-muted)', fontWeight: 600, fontSize: '0.8125rem' }}>MAGAZIN</th>
                  <th style={{ textAlign: 'left', padding: '8px 4px', color: 'var(--color-text-muted)', fontWeight: 600, fontSize: '0.8125rem' }}>CREAT</th>
                  <th style={{ textAlign: 'left', padding: '8px 4px', color: 'var(--color-text-muted)', fontWeight: 600, fontSize: '0.8125rem' }}>EXPIRA</th>
                  <th style={{ textAlign: 'right', padding: '8px 4px', color: 'var(--color-text-muted)', fontWeight: 600, fontSize: '0.8125rem' }}>ACTIUNI</th>
                </tr>
              </thead>
              <tbody>
                {shares.map((s: any) => {
                  const isExpired = new Date(s.expiresAt) < new Date();
                  const link = '/share/' + s.shareId;
                  return (
                    <tr key={s.id} style={{ borderBottom: '1px solid var(--color-border)', opacity: isExpired ? 0.5 : 1 }}>
                      <td style={{ padding: '10px 4px', color: 'var(--color-text)' }}>{REPORT_LABELS[s.reportType] || s.reportType}</td>
                      <td style={{ padding: '10px 4px', color: 'var(--color-text)' }}>{s.storeName}</td>
                      <td style={{ padding: '10px 4px', color: 'var(--color-text-muted)' }}>{new Date(s.createdAt).toLocaleDateString('ro-RO')}</td>
                      <td style={{ padding: '10px 4px', color: isExpired ? '#e74c3c' : 'var(--color-text-muted)' }}>
                        {isExpired ? 'Expirat' : new Date(s.expiresAt).toLocaleDateString('ro-RO')}
                      </td>
                      <td style={{ padding: '10px 4px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                          {!isExpired && <CopyButton text={link} />}
                          {!isExpired && (
                            <a href={'/share/' + s.shareId} target="_blank" rel="noopener noreferrer" className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.75rem', textDecoration: 'none' }}>
                              <ExternalLink size={14} />
                            </a>
                          )}
                          <Form method="post" style={{ display: 'inline' }}>
                            <input type="hidden" name="intent" value="delete" />
                            <input type="hidden" name="shareId" value={s.id} />
                            <button type="submit" className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.75rem' }} title="Sterge">
                              <Trash2 size={14} />
                            </button>
                          </Form>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
