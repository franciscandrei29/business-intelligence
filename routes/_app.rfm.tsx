import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { Form, useLoaderData, useNavigation } from '@remix-run/react';
import { requireUser } from '~/lib/auth/requireAuth.server';
import { db } from '~/lib/db.server';
import { calculateRfm, SEGMENT_COLORS } from '~/lib/rfm/index';
import { RefreshCw } from 'lucide-react';

export const meta: MetaFunction = () => [{ title: 'RFM Segments — Kimono BI' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const url = new URL(request.url);
  const storeId = url.searchParams.get('store');

  const stores = await db.storeConnection.findMany({
    where: { userId: user.id },
    select: { id: true, name: true },
  });

  const selectedStoreId = storeId || stores[0]?.id;
  if (!selectedStoreId) return json({ stores, segments: [], total: 0 });

  const segments = await db.rfmSegment.groupBy({
    by: ['segment'],
    where: { storeConnectionId: selectedStoreId },
    _count: { segment: true },
  });

  const total = segments.reduce((sum, s) => sum + s._count.segment, 0);
  const segmentData = segments.map((s) => ({
    name: s.segment,
    count: s._count.segment,
    percentage: total > 0 ? Math.round((s._count.segment / total) * 1000) / 10 : 0,
    color: SEGMENT_COLORS[s.segment] || '#666',
  })).sort((a, b) => b.count - a.count);

  return json({ stores, segments: segmentData, total, selectedStoreId });
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  const storeId = String(form.get('storeId'));

  const store = await db.storeConnection.findFirst({
    where: { id: storeId, userId: user.id },
  });
  if (!store) return json({ error: 'Store not found' }, { status: 404 });

  const result = await calculateRfm(storeId);
  return json({ success: true, ...result });
}

export default function RfmPage() {
  const { stores, segments, total, selectedStoreId } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isCalculating = navigation.state === 'submitting';

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
        <div>
          <h1 className="page-title">RFM Segments</h1>
          <p className="page-subtitle">Recency / Frequency / Monetary — {total} clienti analizati</p>
        </div>
        {selectedStoreId && (
          <Form method="post">
            <input type="hidden" name="storeId" value={selectedStoreId} />
            <button type="submit" className="btn btn-primary" disabled={isCalculating}>
              <RefreshCw size={16} className={isCalculating ? 'spinning' : ''} />
              {isCalculating ? 'Se calculeaza...' : 'Recalculeaza'}
            </button>
          </Form>
        )}
      </div>


      <div className="info-box">
        <p>
          RFM segmenteaza clientii in 8 categorii bazat pe cat de recent au cumparat (Recency), cat de des (Frequency), si cat au cheltuit (Monetary). Champions sunt cei mai buni clienti. Lost sunt cei care nu au mai cumparat de mult. Foloseste aceste segmente pentru campanii targetate: trimite discount clientilor At Risk, recompenseaza Champions.
        </p>
      </div>

      {segments.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}>
          <p style={{ color: 'var(--color-text-muted)' }}>
            Nu exista date RFM. Sincronizeaza un magazin si apasa "Recalculeaza".
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--space-md)' }}>
          {/* Doughnut-like visual */}
          <div className="card">
            <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-md)' }}>
              Distributie segmente
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
              {segments.map((s) => (
                <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                  <span style={{ width: 12, height: 12, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: '0.8125rem', color: 'var(--color-text)' }}>{s.name}</span>
                  <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text-heading)' }}>{s.percentage}%</span>
                </div>
              ))}
            </div>
          </div>

          {/* Segment table */}
          <div className="card" style={{ overflowX: 'auto' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-md)' }}>
              Detalii segmente
            </h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <th style={{ textAlign: 'left', padding: 'var(--space-sm)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Segment</th>
                  <th style={{ textAlign: 'right', padding: 'var(--space-sm)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Clienti</th>
                  <th style={{ textAlign: 'right', padding: 'var(--space-sm)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>%</th>
                  <th style={{ textAlign: 'left', padding: 'var(--space-sm)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Distributie</th>
                </tr>
              </thead>
              <tbody>
                {segments.map((s) => (
                  <tr key={s.name} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: 'var(--space-sm)', fontSize: '0.875rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color }} />
                        {s.name}
                      </div>
                    </td>
                    <td style={{ padding: 'var(--space-sm)', fontSize: '0.875rem', textAlign: 'right', fontWeight: 600 }}>{s.count}</td>
                    <td style={{ padding: 'var(--space-sm)', fontSize: '0.875rem', textAlign: 'right', color: 'var(--color-text-muted)' }}>{s.percentage}%</td>
                    <td style={{ padding: 'var(--space-sm)' }}>
                      <div style={{ height: 8, background: 'var(--color-bg)', borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{ width: `${s.percentage}%`, height: '100%', background: s.color, borderRadius: 4 }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
