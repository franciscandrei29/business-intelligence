import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { requireUser } from '~/lib/auth/requireAuth.server';
import { db } from '~/lib/db.server';
import { calculateRepeatPurchase } from '~/lib/repeat/index';
import { Repeat } from 'lucide-react';

export const meta: MetaFunction = () => [{ title: 'Repeat Purchase — Kimono BI' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const url = new URL(request.url);
  const storeId = url.searchParams.get('store');

  const stores = await db.storeConnection.findMany({
    where: { userId: user.id },
    select: { id: true, name: true },
  });

  const selectedStoreId = storeId || stores[0]?.id;
  if (!selectedStoreId) return json({ stores, repeat: null });

  const repeat = await calculateRepeatPurchase(selectedStoreId);
  return json({ stores, repeat, selectedStoreId });
}

export default function RepeatPurchasePage() {
  const { stores, repeat } = useLoaderData<typeof loader>();

  if (!repeat) {
    return (
      <div>
        <div className="page-header"><h1 className="page-title">Repeat Purchase</h1></div>
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}>
          <p style={{ color: 'var(--color-text-muted)' }}>Conecteaza un magazin pentru a vedea analiza repeat purchase.</p>
        </div>
      </div>
    );
  }

  const maxCohortNew = Math.max(...repeat.repeatByMonth.map((m) => m.newCustomers), 1);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Repeat Purchase</h1>
        <p className="page-subtitle">Analiza clientilor care revin si a produselor care genereaza repeat</p>
      </div>


      <div className="info-box">
        <p>
          Repeat Purchase analizeaza cati clienti revin sa cumpere din nou. O rata de repeat peste 20% e buna pentru ecommerce. Timpul mediu pana la a doua comanda iti arata cand sa trimiti email de follow-up. Produsele care genereaza repeat sunt cele mai valoroase din catalog.
        </p>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-md)', marginBottom: 'var(--space-xl)' }}>
        <div className="card">
          <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: 'var(--space-xs)' }}>Total Clienti</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-text-heading)' }}>
            {repeat.totalCustomers.toLocaleString('ro-RO')}
          </div>
        </div>
        <div className="card">
          <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: 'var(--space-xs)' }}>One-timers</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-warning)' }}>
            {repeat.oneTimers.toLocaleString('ro-RO')}
          </div>
        </div>
        <div className="card">
          <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: 'var(--space-xs)' }}>Repeaters</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-success)' }}>
            {repeat.repeaters.toLocaleString('ro-RO')}
          </div>
        </div>
        <div className="card">
          <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: 'var(--space-xs)' }}>Repeat Rate</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: repeat.repeatRate >= 20 ? 'var(--color-success)' : repeat.repeatRate >= 10 ? 'var(--color-warning)' : 'var(--color-danger)' }}>
            {repeat.repeatRate.toFixed(1)}%
          </div>
        </div>
        <div className="card">
          <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: 'var(--space-xs)' }}>Zile pana la comanda 2</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-text-heading)' }}>
            {repeat.avgDaysToSecondPurchase} zile
          </div>
        </div>
        <div className="card">
          <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: 'var(--space-xs)' }}>Venit din Repeat</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-success)' }}>
            {Math.round(repeat.revenueFromRepeat).toLocaleString('ro-RO')} RON
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 'var(--space-xs)' }}>
            {repeat.repeatRevenuePercent.toFixed(1)}% din total
          </div>
        </div>
        <div className="card">
          <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: 'var(--space-xs)' }}>Venit din One-time</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-text-heading)' }}>
            {Math.round(repeat.revenueFromOneTime).toLocaleString('ro-RO')} RON
          </div>
        </div>
      </div>

      {/* Products that drive repeat */}
      {repeat.productsDriverRepeat.length > 0 && (
        <div className="card" style={{ overflowX: 'auto', marginBottom: 'var(--space-md)' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-md)' }}>
            Produse care genereaza repeat purchase
          </h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                <th style={{ textAlign: 'left', padding: 'var(--space-sm)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Produs</th>
                <th style={{ textAlign: 'right', padding: 'var(--space-sm)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Cumparatori</th>
                <th style={{ textAlign: 'right', padding: 'var(--space-sm)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Repeat Rate %</th>
                <th style={{ textAlign: 'right', padding: 'var(--space-sm)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Zile pana la al 2-lea</th>
              </tr>
            </thead>
            <tbody>
              {repeat.productsDriverRepeat.map((p, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: 'var(--space-sm)', fontSize: '0.875rem' }}>{p.title}</td>
                  <td style={{ padding: 'var(--space-sm)', fontSize: '0.875rem', textAlign: 'right' }}>{p.totalBuyers}</td>
                  <td style={{ padding: 'var(--space-sm)', fontSize: '0.875rem', textAlign: 'right', fontWeight: 600, color: p.repeatRate >= 25 ? 'var(--color-success)' : 'var(--color-warning)' }}>
                    {p.repeatRate.toFixed(1)}%
                  </td>
                  <td style={{ padding: 'var(--space-sm)', fontSize: '0.875rem', textAlign: 'right', color: 'var(--color-text-muted)' }}>
                    {p.avgTimeTo2nd} zile
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Repeat rate by cohort month */}
      {repeat.repeatByMonth.length > 0 && (
        <div className="card">
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-md)' }}>
            Repeat Rate per Cohorta Lunara
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            {repeat.repeatByMonth.map((m) => (
              <div key={m.month} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                <span style={{ width: 70, fontSize: '0.75rem', color: 'var(--color-text-muted)', flexShrink: 0 }}>
                  {m.month}
                </span>
                <div style={{ flex: 1, height: 24, background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)', overflow: 'hidden', position: 'relative' }}>
                  <div style={{
                    width: `${(m.newCustomers / maxCohortNew) * 100}%`,
                    height: '100%',
                    background: m.rate >= 20 ? 'var(--color-success)' : m.rate >= 10 ? 'var(--color-warning)' : 'rgba(233, 69, 96, 0.5)',
                    borderRadius: 'var(--radius-sm)',
                    opacity: 0.7,
                  }} />
                </div>
                <span style={{ width: 50, fontSize: '0.75rem', color: 'var(--color-text-muted)', textAlign: 'right', flexShrink: 0 }}>
                  {m.newCustomers} noi
                </span>
                <span style={{ width: 60, fontSize: '0.8125rem', fontWeight: 600, color: m.rate >= 20 ? 'var(--color-success)' : 'var(--color-warning)', textAlign: 'right', flexShrink: 0 }}>
                  {m.rate.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
