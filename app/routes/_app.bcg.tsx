import { useState } from 'react';
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData, useSearchParams } from '@remix-run/react';
import { requireUser, requireUserContext } from '~/lib/auth/requireAuth.server';
import { requireModule } from '~/lib/plans.server';
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
  const ctx = await requireUserContext(request);
  const user = ctx.user;
  await requireModule(request, ctx.effectiveOwnerId, 'bcg');
  const url = new URL(request.url);
  const storeId = url.searchParams.get('store');

  const stores = await db.storeConnection.findMany({
    where: { userId: ctx.effectiveOwnerId },
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
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [perPage, setPerPage] = useState(25);
  const [page, setPage] = useState(0);
  const [sortBy, setSortBy] = useState<'revenue' | 'growth' | 'margin'>('revenue');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');

  const toggleSort = (col: 'revenue' | 'growth' | 'margin') => {
    if (sortBy === col) setSortDir(sortDir === 'desc' ? 'asc' : 'desc');
    else { setSortBy(col); setSortDir('desc'); }
    setPage(0);
  };

  const filtered = bcg.products
    .filter(p => categoryFilter === 'all' || p.category === categoryFilter)
    .sort((a, b) => {
      const va = sortBy === 'revenue' ? a.revenue : sortBy === 'growth' ? a.revenueGrowth : (a.margin || 0);
      const vb = sortBy === 'revenue' ? b.revenue : sortBy === 'growth' ? b.revenueGrowth : (b.margin || 0);
      return sortDir === 'desc' ? vb - va : va - vb;
    });
  const totalPages = Math.ceil(filtered.length / perPage);
  const paginated = filtered.slice(page * perPage, (page + 1) * perPage);

  if (!bcg) {
    return (
      <div>
        <div className="page-header"><h1 className="page-title">BCG Product Matrix</h1></div>
        <div className="card" style={{ textAlign: 'center', padding: '56px 24px' }}>
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

      {/* Category filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {['all', 'Stars', 'Cash Cows', 'Question Marks', 'Dogs'].map(cat => (
          <button key={cat} onClick={() => { setCategoryFilter(cat); setPage(0); }}
            style={{
              padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              border: categoryFilter === cat ? '1.5px solid var(--kimono-orange)' : '1px solid var(--border-default)',
              background: categoryFilter === cat ? 'rgba(216,90,48,0.08)' : 'white',
              color: categoryFilter === cat ? 'var(--kimono-orange)' : cat === 'all' ? 'var(--text-secondary)' : (QUADRANT_COLORS[cat] || 'var(--text-secondary)'),
            }}>
            {cat === 'all' ? `Toate (${bcg.products.length})` : `${QUADRANT_ICONS[cat] || ''} ${cat} (${bcg.products.filter(p => p.category === cat).length})`}
          </button>
        ))}
      </div>

      {/* Products table */}
      <div className="card" style={{ overflowX: 'auto' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-md)' }}>Produse</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, borderBottom: '0.5px solid var(--border-default)' }}>Produs</th>
              <th style={{ textAlign: 'left', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, borderBottom: '0.5px solid var(--border-default)' }}>Categorie</th>
              <th onClick={() => toggleSort('revenue')} style={{ textAlign: 'right', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: sortBy === 'revenue' ? 'var(--kimono-orange)' : 'var(--color-text-muted)', fontWeight: 600, borderBottom: '0.5px solid var(--border-default)', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>Venit 90z {sortBy === 'revenue' ? (sortDir === 'desc' ? '▼' : '▲') : '↕'}</th>
              <th onClick={() => toggleSort('growth')} style={{ textAlign: 'right', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: sortBy === 'growth' ? 'var(--kimono-orange)' : 'var(--color-text-muted)', fontWeight: 600, borderBottom: '0.5px solid var(--border-default)', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>Growth % {sortBy === 'growth' ? (sortDir === 'desc' ? '▼' : '▲') : '↕'}</th>
              <th onClick={() => toggleSort('margin')} style={{ textAlign: 'right', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: sortBy === 'margin' ? 'var(--kimono-orange)' : 'var(--color-text-muted)', fontWeight: 600, borderBottom: '0.5px solid var(--border-default)', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>Margin % {sortBy === 'margin' ? (sortDir === 'desc' ? '▼' : '▲') : '↕'}</th>
            </tr>
          </thead>
          <tbody>
            {paginated.map((p) => (
              <tr key={p.externalId} style={{ borderBottom: '0.5px solid var(--border-default)' }}>
                <td style={{ padding: '10px 14px', fontSize: 13, maxWidth: 500 }}>
                  <div style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.title}</div>
                </td>
                <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                  <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem', fontWeight: 600, background: QUADRANT_COLORS[p.category] + '22', color: QUADRANT_COLORS[p.category] }}>
                    {p.category}
                  </span>
                </td>
                <td style={{ padding: '10px 14px', fontSize: 13, textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {Math.round(p.revenue).toLocaleString('ro-RO')} RON
                </td>
                <td style={{ padding: '10px 14px', fontSize: 13, textAlign: 'right', whiteSpace: 'nowrap', color: p.revenueGrowth >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                  {p.revenueGrowth > 0 ? '+' : ''}{p.revenueGrowth}%
                </td>
                <td style={{ padding: '10px 14px', fontSize: 13, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {p.margin !== null ? p.margin + '%' : 'N/A'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {/* Pagination */}
        {filtered.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderTop: '0.5px solid var(--border-default)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Per pagină:</span>
              {[25, 50, 100].map(n => (
                <button key={n} onClick={() => { setPerPage(n); setPage(0); }}
                  style={{ padding: '4px 10px', borderRadius: 6, border: perPage === n ? '1.5px solid var(--kimono-orange)' : '1px solid var(--border-default)', background: perPage === n ? 'rgba(216,90,48,0.08)' : 'white', color: perPage === n ? 'var(--kimono-orange)' : 'var(--text-secondary)', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                  {n}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{page * perPage + 1}-{Math.min((page + 1) * perPage, filtered.length)} din {filtered.length}</span>
              <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}
                style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'white', fontSize: 11, cursor: page === 0 ? 'not-allowed' : 'pointer', opacity: page === 0 ? 0.4 : 1 }}>
                ←
              </button>
              <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={(page + 1) * perPage >= filtered.length}
                style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'white', fontSize: 11, cursor: (page + 1) * perPage >= filtered.length ? 'not-allowed' : 'pointer', opacity: (page + 1) * perPage >= filtered.length ? 0.4 : 1 }}>
                →
              </button>
            </div>
          </div>
        )}

        {filtered.length === 0 && (
          <p style={{ textAlign: 'center', padding: '32px 24px', color: 'var(--color-text-muted)' }}>Nu sunt suficiente date pentru analiza BCG.</p>
        )}
      </div>
    </div>
  );
}
