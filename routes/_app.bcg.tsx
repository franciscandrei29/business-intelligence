import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData, useSearchParams } from '@remix-run/react';
import { requireUser } from '~/lib/auth/requireAuth.server';
import { db } from '~/lib/db.server';
import { calculateBcg } from '~/lib/bcg/index';
import { Grid3x3 } from 'lucide-react';

export const meta: MetaFunction = () => [{ title: 'BCG Product Matrix — Kimono BI' }];

const QUADRANT_COLORS: Record<string, string> = {
  Stars: '#22c55e',
  'Cash Cows': '#3b82f6',
  'Question Marks': '#f59e0b',
  Dogs: '#ef4444',
};

const QUADRANT_ICONS: Record<string, string> = {
  Stars: '\u2B50',
  'Cash Cows': '\uD83D\uDCB0',
  'Question Marks': '\u2753',
  Dogs: '\uD83D\uDC15',
};

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const url = new URL(request.url);
  const storeId = url.searchParams.get('store');

  const stores = await db.storeConnection.findMany({
    where: { userId: user.id },
    select: { id: true, name: true },
  });

  const selectedStoreId = storeId || stores[0]?.id;
  if (!selectedStoreId) return json({ stores, bcg: null });

  const bcg = await calculateBcg(selectedStoreId);
  return json({ stores, bcg, selectedStoreId });
}

export default function BcgPage() {
  const { stores, bcg, selectedStoreId } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  if (!bcg) {
    return (
      <div>
        <div className="page-header"><h1 className="page-title">BCG Product Matrix</h1></div>
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}>
          <p style={{ color: 'var(--color-text-muted)' }}>Conecteaza un magazin pentru a vedea matricea BCG.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
        <div>
          <h1 className="page-title">BCG Product Matrix</h1>
          <p className="page-subtitle">{bcg.products.length} produse analizate (ultimele 90 zile)</p>
        </div>
        {stores.length > 1 && (
          <select className="form-input" style={{ width: 220 }} value={selectedStoreId || ''} onChange={(e) => setSearchParams({ store: e.target.value })}>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </div>


      <div className="info-box">
        <p>
          Product Matrix (BCG) clasifica produsele in 4 categorii bazat pe cresterea vanzarilor si marja de profit:<br/>
          &#x2B50; Stars = cresc rapid SI au marja buna &rarr; investeste in marketing<br/>
          &#x1F4B0; Cash Cows = vanzari stabile, marja buna &rarr; genereaza profit, nu schimba nimic<br/>
          &#x2753; Question Marks = cresc rapid dar marja mica &rarr; optimizeaza costurile sau pretul<br/>
          &#x1F415; Dogs = nu cresc, marja mica &rarr; ia in considerare eliminarea din catalog
        </p>
      </div>

      {/* Quadrant cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-md)', marginBottom: 'var(--space-xl)' }}>
        {Object.entries(bcg.quadrants).map(([name, data]) => (
          <div className="card" key={name} style={{ borderLeft: `4px solid ${QUADRANT_COLORS[name]}` }}>
            <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: 'var(--space-xs)' }}>
              {QUADRANT_ICONS[name]} {name}
            </div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-text-heading)' }}>{data.count}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
              Venit: {Math.round(data.revenue).toLocaleString('ro-RO')} RON
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 'var(--space-md)', marginBottom: 'var(--space-xl)' }}>
        <div className="card">
          <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>Median Growth Threshold</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-text-heading)' }}>{bcg.medianGrowth}%</div>
        </div>
        <div className="card">
          <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>Median Margin Threshold</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-text-heading)' }}>{bcg.medianMargin}%</div>
        </div>
      </div>

      {/* Products table */}
      <div className="card" style={{ overflowX: 'auto' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-md)' }}>Produse</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, borderBottom: '1px solid var(--color-border)' }}>Produs</th>
              <th style={{ textAlign: 'left', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, borderBottom: '1px solid var(--color-border)' }}>Categorie</th>
              <th style={{ textAlign: 'right', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, borderBottom: '1px solid var(--color-border)' }}>Venit 90z</th>
              <th style={{ textAlign: 'right', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, borderBottom: '1px solid var(--color-border)' }}>Growth %</th>
              <th style={{ textAlign: 'right', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, borderBottom: '1px solid var(--color-border)' }}>Margin %</th>
            </tr>
          </thead>
          <tbody>
            {bcg.products.map((p) => (
              <tr key={p.externalId} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td style={{ padding: 'var(--space-sm) var(--space-md)', fontSize: '0.875rem' }}>
                  <div style={{ fontWeight: 500 }}>{p.title}</div>
                  {p.vendor && <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{p.vendor}</div>}
                </td>
                <td style={{ padding: 'var(--space-sm) var(--space-md)' }}>
                  <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem', fontWeight: 600, background: QUADRANT_COLORS[p.category] + '22', color: QUADRANT_COLORS[p.category] }}>
                    {p.category}
                  </span>
                </td>
                <td style={{ padding: 'var(--space-sm) var(--space-md)', fontSize: '0.875rem', textAlign: 'right', fontWeight: 600 }}>
                  {Math.round(p.revenue).toLocaleString('ro-RO')} RON
                </td>
                <td style={{ padding: 'var(--space-sm) var(--space-md)', fontSize: '0.875rem', textAlign: 'right', color: p.revenueGrowth >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                  {p.revenueGrowth > 0 ? '+' : ''}{p.revenueGrowth}%
                </td>
                <td style={{ padding: 'var(--space-sm) var(--space-md)', fontSize: '0.875rem', textAlign: 'right' }}>
                  {p.margin}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {bcg.products.length === 0 && (
          <p style={{ textAlign: 'center', padding: 'var(--space-xl)', color: 'var(--color-text-muted)' }}>Nu sunt suficiente date pentru analiza BCG.</p>
        )}
      </div>
    </div>
  );
}
