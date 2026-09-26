import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { requireUser } from '~/lib/auth/requireAuth.server';
import { db } from '~/lib/db.server';
import { calculateLtv } from '~/lib/ltv/index';
import { Heart } from 'lucide-react';

export const meta: MetaFunction = () => [{ title: 'LTV Analytics — Kimono BI' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const url = new URL(request.url);
  const storeId = url.searchParams.get('store');

  const stores = await db.storeConnection.findMany({
    where: { userId: user.id },
    select: { id: true, name: true },
  });

  const selectedStoreId = storeId || stores[0]?.id;
  if (!selectedStoreId) return json({ stores, ltv: null });

  const ltv = await calculateLtv(selectedStoreId);
  return json({ stores, ltv, selectedStoreId });
}

export default function LtvPage() {
  const { stores, ltv } = useLoaderData<typeof loader>();

  if (!ltv) {
    return (
      <div>
        <div className="page-header"><h1 className="page-title">LTV Analytics</h1></div>
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}>
          <p style={{ color: 'var(--color-text-muted)' }}>Conecteaza un magazin pentru a vedea analiza LTV.</p>
        </div>
      </div>
    );
  }

  const maxBucket = Math.max(...ltv.ltvDistribution.map((b) => b.count), 1);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">LTV Analytics</h1>
        <p className="page-subtitle">Lifetime Value per client, canal si produs</p>
      </div>


      <div className="info-box">
        <p>
          LTV (Lifetime Value) arata cat cheltuie un client pe toata durata relatiei cu magazinul. Analiza pe canal arata de unde vin cei mai valorosi clienti. Analiza pe produs arata care produse atrag clienti care revin si cheltuie mai mult.
        </p>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-md)', marginBottom: 'var(--space-xl)' }}>
        <div className="card">
          <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: 'var(--space-xs)' }}>LTV Mediu</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-text-heading)' }}>
            {ltv.overallAvgLtv.toLocaleString('ro-RO')} RON
          </div>
        </div>
        <div className="card">
          <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: 'var(--space-xs)' }}>LTV Median</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-text-heading)' }}>
            {ltv.overallMedianLtv.toLocaleString('ro-RO')} RON
          </div>
        </div>
      </div>

      {/* LTV Distribution bar chart */}
      {ltv.ltvDistribution.length > 0 && (
        <div className="card" style={{ marginBottom: 'var(--space-md)' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-md)' }}>
            Distributie LTV
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            {ltv.ltvDistribution.map((b) => (
              <div key={b.bucket} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                <span style={{ width: 120, fontSize: '0.75rem', color: 'var(--color-text-muted)', flexShrink: 0 }}>
                  {b.bucket}
                </span>
                <div style={{ flex: 1, height: 24, background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                  <div style={{
                    width: `${(b.count / maxBucket) * 100}%`,
                    height: '100%',
                    background: 'linear-gradient(90deg, var(--color-primary), rgba(233, 69, 96, 0.6))',
                    borderRadius: 'var(--radius-sm)',
                  }} />
                </div>
                <span style={{ width: 50, fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text)', textAlign: 'right', flexShrink: 0 }}>
                  {b.count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* By Channel table */}
      {ltv.byChannel.length > 0 && (
        <div className="card" style={{ overflowX: 'auto', marginBottom: 'var(--space-md)' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-md)' }}>
            LTV per Canal
          </h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <th style={{ textAlign: 'left', padding: 'var(--space-sm)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Canal</th>
                  <th style={{ textAlign: 'right', padding: 'var(--space-sm)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Clienti</th>
                  <th style={{ textAlign: 'right', padding: 'var(--space-sm)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>LTV Mediu</th>
                  <th style={{ textAlign: 'right', padding: 'var(--space-sm)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Comenzi Medii</th>
                  <th style={{ textAlign: 'right', padding: 'var(--space-sm)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>AOV</th>
                  <th style={{ textAlign: 'right', padding: 'var(--space-sm)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Payback (zile)</th>
                </tr>
              </thead>
              <tbody>
                {ltv.byChannel.map((ch) => (
                  <tr key={ch.channel} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: 'var(--space-sm)', fontSize: '0.875rem', fontWeight: 500 }}>{ch.channel}</td>
                    <td style={{ padding: 'var(--space-sm)', fontSize: '0.875rem', textAlign: 'right' }}>{ch.customers}</td>
                    <td style={{ padding: 'var(--space-sm)', fontSize: '0.875rem', textAlign: 'right', fontWeight: 600, color: 'var(--color-success)' }}>
                      {ch.avgLtv.toLocaleString('ro-RO')} RON
                    </td>
                    <td style={{ padding: 'var(--space-sm)', fontSize: '0.875rem', textAlign: 'right' }}>{ch.avgOrders.toFixed(1)}</td>
                    <td style={{ padding: 'var(--space-sm)', fontSize: '0.875rem', textAlign: 'right' }}>{ch.avgAov.toLocaleString('ro-RO')} RON</td>
                    <td style={{ padding: 'var(--space-sm)', fontSize: '0.875rem', textAlign: 'right', color: 'var(--color-text-muted)' }}>{ch.paybackDays}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* By Product table */}
      {ltv.byProduct.length > 0 && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-md)' }}>
            LTV per Produs
          </h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <th style={{ textAlign: 'left', padding: 'var(--space-sm)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Produs</th>
                  <th style={{ textAlign: 'right', padding: 'var(--space-sm)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Cumparatori</th>
                  <th style={{ textAlign: 'right', padding: 'var(--space-sm)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Repeat Rate %</th>
                  <th style={{ textAlign: 'right', padding: 'var(--space-sm)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>LTV Mediu</th>
                </tr>
              </thead>
              <tbody>
                {ltv.byProduct.map((p) => (
                  <tr key={p.productId} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: 'var(--space-sm)', fontSize: '0.875rem' }}>{p.productTitle}</td>
                    <td style={{ padding: 'var(--space-sm)', fontSize: '0.875rem', textAlign: 'right' }}>{p.totalCustomers}</td>
                    <td style={{ padding: 'var(--space-sm)', fontSize: '0.875rem', textAlign: 'right', fontWeight: 600, color: p.repeatRate >= 20 ? 'var(--color-success)' : 'var(--color-warning)' }}>
                      {p.repeatRate.toFixed(1)}%
                    </td>
                    <td style={{ padding: 'var(--space-sm)', fontSize: '0.875rem', textAlign: 'right', fontWeight: 600, color: 'var(--color-text-heading)' }}>
                      {p.avgLtvOfBuyers.toLocaleString('ro-RO')} RON
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
