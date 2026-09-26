import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData, useSearchParams } from '@remix-run/react';
import { requireUser } from '~/lib/auth/requireAuth.server';
import { db } from '~/lib/db.server';
import { Percent } from 'lucide-react';

export const meta: MetaFunction = () => [{ title: 'Discount Impact — Kimono BI' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const url = new URL(request.url);
  const storeId = url.searchParams.get('store');

  const stores = await db.storeConnection.findMany({
    where: { userId: user.id },
    select: { id: true, name: true },
  });

  const selectedStoreId = storeId || stores[0]?.id;
  if (!selectedStoreId) return json({ stores, data: null });

  const orders = await db.order.findMany({
    where: { storeConnectionId: selectedStoreId },
    select: { id: true, orderNumber: true, total: true, subtotal: true, discountTotal: true, placedAt: true, currency: true },
    orderBy: { placedAt: 'desc' },
  });

  const withDiscount = orders.filter((o) => Number(o.discountTotal || 0) > 0);
  const withoutDiscount = orders.filter((o) => Number(o.discountTotal || 0) === 0);

  const totalWithDiscount = withDiscount.reduce((s, o) => s + Number(o.total), 0);
  const totalWithoutDiscount = withoutDiscount.reduce((s, o) => s + Number(o.total), 0);
  const totalDiscountGiven = withDiscount.reduce((s, o) => s + Number(o.discountTotal || 0), 0);

  const aovWith = withDiscount.length > 0 ? totalWithDiscount / withDiscount.length : 0;
  const aovWithout = withoutDiscount.length > 0 ? totalWithoutDiscount / withoutDiscount.length : 0;
  const discountRate = orders.length > 0 ? (withDiscount.length / orders.length) * 100 : 0;
  const avgDiscountAmount = withDiscount.length > 0 ? totalDiscountGiven / withDiscount.length : 0;

  // Top discounted orders
  const topDiscounted = withDiscount
    .sort((a, b) => Number(b.discountTotal || 0) - Number(a.discountTotal || 0))
    .slice(0, 20)
    .map((o) => ({
      orderNumber: o.orderNumber,
      total: Number(o.total),
      discount: Number(o.discountTotal || 0),
      placedAt: o.placedAt,
      currency: o.currency,
    }));

  return json({
    stores,
    data: {
      totalOrders: orders.length,
      withDiscountCount: withDiscount.length,
      withoutDiscountCount: withoutDiscount.length,
      totalWithDiscount: Math.round(totalWithDiscount * 100) / 100,
      totalWithoutDiscount: Math.round(totalWithoutDiscount * 100) / 100,
      aovWith: Math.round(aovWith * 100) / 100,
      aovWithout: Math.round(aovWithout * 100) / 100,
      totalDiscountGiven: Math.round(totalDiscountGiven * 100) / 100,
      avgDiscountAmount: Math.round(avgDiscountAmount * 100) / 100,
      discountRate: Math.round(discountRate * 10) / 10,
      topDiscounted,
    },
    selectedStoreId,
  });
}

export default function DiscountsPage() {
  const { stores, data, selectedStoreId } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  if (!data) {
    return (
      <div>
        <div className="page-header"><h1 className="page-title">Discount Impact</h1></div>
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}>
          <p style={{ color: 'var(--color-text-muted)' }}>Conecteaza un magazin.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
        <div>
          <h1 className="page-title">Discount Impact</h1>
          <p className="page-subtitle">{data.totalOrders} comenzi analizate</p>
        </div>
        {stores.length > 1 && (
          <select className="form-input" style={{ width: 220 }} value={selectedStoreId || ''} onChange={(e) => setSearchParams({ store: e.target.value })}>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </div>


      <div className="info-box">
        <p>
          Discount Impact analizeaza efectul discounturilor asupra vanzarilor. Compara comenzile cu discount vs fara discount: AOV, venit total, numar comenzi. Daca AOV cu discount e mult mai mic decat fara, discounturile atrag clienti cu valoare mica.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-md)', marginBottom: 'var(--space-xl)' }}>
        <div className="card">
          <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: 'var(--space-xs)' }}>Comenzi cu discount</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-warning)' }}>{data.withDiscountCount}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{data.discountRate}% din total</div>
        </div>
        <div className="card">
          <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: 'var(--space-xs)' }}>Comenzi fara discount</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-success)' }}>{data.withoutDiscountCount}</div>
        </div>
        <div className="card">
          <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: 'var(--space-xs)' }}>AOV cu discount</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-warning)' }}>{data.aovWith.toLocaleString('ro-RO')} RON</div>
        </div>
        <div className="card">
          <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: 'var(--space-xs)' }}>AOV fara discount</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-success)' }}>{data.aovWithout.toLocaleString('ro-RO')} RON</div>
        </div>
        <div className="card">
          <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: 'var(--space-xs)' }}>Total discounturi acordate</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-danger)' }}>{data.totalDiscountGiven.toLocaleString('ro-RO')} RON</div>
        </div>
        <div className="card">
          <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: 'var(--space-xs)' }}>Discount mediu / comanda</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-text-heading)' }}>{data.avgDiscountAmount.toLocaleString('ro-RO')} RON</div>
        </div>
      </div>

      {/* AOV comparison bar */}
      <div className="card" style={{ marginBottom: 'var(--space-md)' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-md)' }}>AOV Comparison</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          {[
            { label: 'Cu discount', value: data.aovWith, color: 'var(--color-warning)' },
            { label: 'Fara discount', value: data.aovWithout, color: 'var(--color-success)' },
          ].map((item) => {
            const maxVal = Math.max(data.aovWith, data.aovWithout) || 1;
            return (
              <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                <span style={{ width: 120, fontSize: '0.8125rem', color: 'var(--color-text-muted)', flexShrink: 0 }}>{item.label}</span>
                <div style={{ flex: 1, height: 24, background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                  <div style={{ width: `${(item.value / maxVal) * 100}%`, height: '100%', background: item.color, borderRadius: 'var(--radius-sm)' }} />
                </div>
                <span style={{ width: 100, fontSize: '0.8125rem', textAlign: 'right', fontWeight: 600, flexShrink: 0 }}>{item.value.toLocaleString('ro-RO')} RON</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Top discounted orders */}
      <div className="card" style={{ overflowX: 'auto' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-md)' }}>Top Comenzi cu Discount</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, borderBottom: '1px solid var(--color-border)' }}>Comanda</th>
              <th style={{ textAlign: 'right', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, borderBottom: '1px solid var(--color-border)' }}>Total</th>
              <th style={{ textAlign: 'right', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, borderBottom: '1px solid var(--color-border)' }}>Discount</th>
              <th style={{ textAlign: 'right', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, borderBottom: '1px solid var(--color-border)' }}>Data</th>
            </tr>
          </thead>
          <tbody>
            {data.topDiscounted.map((o, i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td style={{ padding: 'var(--space-sm) var(--space-md)', fontSize: '0.875rem' }}>#{o.orderNumber || '-'}</td>
                <td style={{ padding: 'var(--space-sm) var(--space-md)', fontSize: '0.875rem', textAlign: 'right', fontWeight: 600 }}>{o.total.toLocaleString('ro-RO')} {o.currency}</td>
                <td style={{ padding: 'var(--space-sm) var(--space-md)', fontSize: '0.875rem', textAlign: 'right', fontWeight: 600, color: 'var(--color-danger)' }}>-{o.discount.toLocaleString('ro-RO')} {o.currency}</td>
                <td style={{ padding: 'var(--space-sm) var(--space-md)', fontSize: '0.8125rem', textAlign: 'right', color: 'var(--color-text-muted)' }}>{new Date(o.placedAt).toLocaleDateString('ro-RO')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
