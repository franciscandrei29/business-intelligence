import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { Form, useLoaderData, useNavigation } from '@remix-run/react';
import { requireUser } from '~/lib/auth/requireAuth.server';
import { db } from '~/lib/db.server';
import { calculateStockAlerts } from '~/lib/stock/index';
import { RefreshCw, AlertTriangle } from 'lucide-react';

export const meta: MetaFunction = () => [{ title: 'Smart Alerts — Kimono BI' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const url = new URL(request.url);
  const storeId = url.searchParams.get('store');

  const stores = await db.storeConnection.findMany({
    where: { userId: user.id },
    select: { id: true, name: true },
  });

  const selectedStoreId = storeId || stores[0]?.id;
  if (!selectedStoreId) return json({ stores, alerts: [] });

  const alerts = await db.stockAlert.findMany({
    where: { storeConnectionId: selectedStoreId },
    orderBy: [{ severity: 'asc' }, { daysRemaining: 'asc' }],
  });

  return json({ stores, alerts, selectedStoreId });
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  const storeId = String(form.get('storeId'));

  const store = await db.storeConnection.findFirst({ where: { id: storeId, userId: user.id } });
  if (!store) return json({ error: 'Store not found' }, { status: 404 });

  await calculateStockAlerts(storeId);
  return json({ success: true });
}

const SEVERITY_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  critical: { bg: 'rgba(231, 76, 60, 0.15)', color: '#e74c3c', label: 'Critic' },
  high: { bg: 'rgba(243, 156, 18, 0.15)', color: '#f39c12', label: 'Ridicat' },
  medium: { bg: 'rgba(52, 152, 219, 0.15)', color: '#3498db', label: 'Mediu' },
};

export default function StockPage() {
  const { stores, alerts, selectedStoreId } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isCalculating = navigation.state === 'submitting';

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
        <div>
          <h1 className="page-title">Smart Alerts</h1>
          <p className="page-subtitle">{alerts.length} alerte active</p>
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
          Smart Alerts identifica produsele care se vand activ si risca sa ramana fara stoc. Severitate Critic = stoc epuizat sau sub 7 zile. Ridicat = 7-14 zile. Mediu = 14-30 zile. Doar produsele cu vanzari in ultimele 60 de zile sunt monitorizate — produsele inactive nu genereaza alerte.
        </p>
      </div>

      {alerts.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}>
          <p style={{ color: 'var(--color-text-muted)' }}>Nu exista alerte de stoc. Toate produsele au stoc suficient.</p>
        </div>
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                <th style={{ textAlign: 'left', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Severitate</th>
                <th style={{ textAlign: 'left', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Produs</th>
                <th style={{ textAlign: 'right', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Stoc actual</th>
                <th style={{ textAlign: 'right', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Vanzari/zi</th>
                <th style={{ textAlign: 'right', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Zile ramase</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a, i) => {
                const style = SEVERITY_STYLES[a.severity] || SEVERITY_STYLES.medium;
                return (
                  <tr key={i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: 'var(--space-sm) var(--space-md)' }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '2px 8px', borderRadius: 'var(--radius-full)',
                        background: style.bg, color: style.color,
                        fontSize: '0.6875rem', fontWeight: 600,
                      }}>
                        <AlertTriangle size={12} />
                        {style.label}
                      </span>
                    </td>
                    <td style={{ padding: 'var(--space-sm) var(--space-md)', fontSize: '0.875rem' }}>
                      {a.productTitle}
                    </td>
                    <td style={{ padding: 'var(--space-sm) var(--space-md)', fontSize: '0.875rem', textAlign: 'right', fontWeight: 600 }}>
                      {a.currentStock}
                    </td>
                    <td style={{ padding: 'var(--space-sm) var(--space-md)', fontSize: '0.875rem', textAlign: 'right', color: 'var(--color-text-muted)' }}>
                      {a.velocityPerDay}
                    </td>
                    <td style={{ padding: 'var(--space-sm) var(--space-md)', fontSize: '0.875rem', textAlign: 'right', fontWeight: 600, color: style.color }}>
                      {a.daysRemaining}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
