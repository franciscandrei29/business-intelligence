import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData, useSearchParams } from '@remix-run/react';
import { requireUser } from '~/lib/auth/requireAuth.server';
import { db } from '~/lib/db.server';
import { Clock } from 'lucide-react';

export const meta: MetaFunction = () => [{ title: 'Peak Hours — Kimono BI' }];

const DAY_NAMES = ['Luni', 'Marti', 'Miercuri', 'Joi', 'Vineri', 'Sambata', 'Duminica'];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const url = new URL(request.url);
  const storeId = url.searchParams.get('store');

  const stores = await db.storeConnection.findMany({
    where: { userId: user.id },
    select: { id: true, name: true },
  });

  const selectedStoreId = storeId || stores[0]?.id;
  if (!selectedStoreId) return json({ stores, heatmap: null });

  const orders = await db.order.findMany({
    where: { storeConnectionId: selectedStoreId },
    select: { placedAt: true, total: true },
  });

  // Build 7x24 grid
  const grid: { orders: number; revenue: number }[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({ orders: 0, revenue: 0 }))
  );

  let maxOrders = 0;
  for (const o of orders) {
    const d = new Date(o.placedAt);
    // getDay: 0=Sun -> we want Mon=0
    const day = (d.getDay() + 6) % 7;
    const hour = d.getHours();
    grid[day][hour].orders++;
    grid[day][hour].revenue += Number(o.total);
    if (grid[day][hour].orders > maxOrders) maxOrders = grid[day][hour].orders;
  }

  // Top 5 peak slots
  const slots: { day: number; hour: number; orders: number; revenue: number }[] = [];
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      if (grid[d][h].orders > 0) {
        slots.push({ day: d, hour: h, orders: grid[d][h].orders, revenue: Math.round(grid[d][h].revenue * 100) / 100 });
      }
    }
  }
  slots.sort((a, b) => b.orders - a.orders);
  const topSlots = slots.slice(0, 5);

  return json({
    stores,
    heatmap: {
      grid: grid.map(row => row.map(cell => ({ orders: cell.orders, revenue: Math.round(cell.revenue * 100) / 100 }))),
      maxOrders,
      totalOrders: orders.length,
      topSlots,
    },
    selectedStoreId,
  });
}

export default function PeaksPage() {
  const { stores, heatmap, selectedStoreId } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  if (!heatmap) {
    return (
      <div>
        <div className="page-header"><h1 className="page-title">Peak Hours</h1></div>
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}>
          <p style={{ color: 'var(--color-text-muted)' }}>Conecteaza un magazin.</p>
        </div>
      </div>
    );
  }

  function getColor(orders: number): string {
    if (orders === 0) return 'var(--color-bg)';
    const intensity = Math.min(orders / (heatmap!.maxOrders || 1), 1);
    const alpha = 0.15 + intensity * 0.85;
    return `rgba(34, 197, 94, ${alpha})`;
  }

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
        <div>
          <h1 className="page-title">Peak Hours</h1>
          <p className="page-subtitle">{heatmap.totalOrders} comenzi analizate</p>
        </div>
        {stores.length > 1 && (
          <select className="form-input" style={{ width: 220 }} value={selectedStoreId || ''} onChange={(e) => setSearchParams({ store: e.target.value })}>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </div>


      <div className="info-box">
        <p>
          Peak Hours arata cand plaseaza clientii cele mai multe comenzi. Heatmap-ul coloreaza fiecare slot ora/zi dupa intensitate. Foloseste aceste date pentru a programa campaniile de email si ad-urile in orele de varf.
        </p>
      </div>

      {/* Heatmap */}
      <div className="card" style={{ overflowX: 'auto', marginBottom: 'var(--space-md)' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-md)' }}>Heatmap Comenzi</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 800 }}>
          {/* Hour header */}
          <div style={{ display: 'flex', gap: 2, paddingLeft: 80 }}>
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} style={{ width: 32, textAlign: 'center', fontSize: '0.625rem', color: 'var(--color-text-muted)' }}>
                {h}
              </div>
            ))}
          </div>
          {/* Grid rows */}
          {heatmap.grid.map((row, dayIdx) => (
            <div key={dayIdx} style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
              <div style={{ width: 76, fontSize: '0.75rem', color: 'var(--color-text-muted)', textAlign: 'right', paddingRight: 4, flexShrink: 0 }}>
                {DAY_NAMES[dayIdx]}
              </div>
              {row.map((cell, hourIdx) => (
                <div
                  key={hourIdx}
                  title={`${DAY_NAMES[dayIdx]} ${hourIdx}:00 - ${cell.orders} comenzi, ${cell.revenue.toLocaleString('ro-RO')} RON`}
                  style={{
                    width: 32, height: 28,
                    background: getColor(cell.orders),
                    borderRadius: 3,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.625rem', color: cell.orders > 0 ? '#fff' : 'transparent',
                    fontWeight: 600,
                    cursor: 'default',
                  }}
                >
                  {cell.orders > 0 ? cell.orders : ''}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Top 5 peak slots */}
      <div className="card">
        <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-md)' }}>Top 5 Intervale Peak</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          {heatmap.topSlots.map((slot, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', padding: 'var(--space-sm)', background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)' }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--color-success)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: '0.875rem', flexShrink: 0 }}>
                {i + 1}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-heading)' }}>
                  {DAY_NAMES[slot.day]}, {slot.hour}:00 - {slot.hour + 1}:00
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                  {slot.orders} comenzi | {slot.revenue.toLocaleString('ro-RO')} RON
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
