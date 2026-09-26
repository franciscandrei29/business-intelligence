import { useState } from 'react';
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData, useSearchParams } from '@remix-run/react';
import { requireUser, requireUserContext } from '~/lib/auth/requireAuth.server';
import { requireModule } from '~/lib/plans.server';
import { db } from '~/lib/db.server';
import { calculateBasketAnalysis } from '~/lib/basket/index';
import { ShoppingBag } from 'lucide-react';

export const meta: MetaFunction = () => [{ title: 'Cross-sell Intelligence — Kimono BI' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const ctx = await requireUserContext(request);
  const user = ctx.user;
  await requireModule(request, ctx.effectiveOwnerId, 'basket');
  const url = new URL(request.url);
  const storeId = url.searchParams.get('store');

  const stores = await db.storeConnection.findMany({
    where: { userId: ctx.effectiveOwnerId },
    select: { id: true, name: true },
  });

  const selectedStoreId = storeId || stores[0]?.id;
  if (!selectedStoreId) return json({ stores, pairs: [] });

  const pairs = await calculateBasketAnalysis(selectedStoreId);
  return json({ stores, pairs, selectedStoreId });
}

export default function BasketPage() {
  const { stores, pairs, selectedStoreId } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  const [perPage, setPerPage] = useState(25);
  const [page, setPage] = useState(0);
  const [sortBy, setSortBy] = useState<'count' | 'lift'>('count');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const sorted = [...(pairs || [])].sort((a, b) => {
    const va = sortBy === 'count' ? a.count : a.lift;
    const vb = sortBy === 'count' ? b.count : b.lift;
    return sortDir === 'desc' ? vb - va : va - vb;
  });

  const totalPages = Math.ceil(sorted.length / perPage);
  const paginated = sorted.slice(page * perPage, (page + 1) * perPage);

  const toggleSort = (col: 'count' | 'lift') => {
    if (sortBy === col) setSortDir(sortDir === 'desc' ? 'asc' : 'desc');
    else { setSortBy(col); setSortDir('desc'); }
    setPage(0);
  };

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
        <div>
          <h1 className="page-title">Cross-sell Intelligence</h1>
          <p className="page-subtitle">Top {pairs.length} perechi de produse cumparate impreuna</p>
        </div>
        {stores.length > 1 && (
          <select className="form-input" style={{ width: 220 }} value={selectedStoreId || ''} onChange={(e) => setSearchParams({ store: e.target.value })}>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </div>


      {/* Lift explanation */}
      {pairs.length > 0 && (
        <div style={{ marginBottom: 16, padding: '16px 20px', background: 'linear-gradient(135deg, rgba(216,90,48,0.04) 0%, rgba(124,58,237,0.04) 100%)', border: '0.5px solid rgba(216,90,48,0.15)', borderRadius: 10, display: 'flex', gap: 16, alignItems: 'center' }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--kimono-orange)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: 'white' }}>L</span>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>Ce înseamnă Lift?</div>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
              <strong style={{ color: 'var(--kimono-orange)' }}>Lift &gt; 1</strong> = produsele se cumpără împreună mai des decât ar fi de așteptat.
              Cu cât e mai mare, cu atât asocierea e mai puternică. Ex: <strong>2.5x</strong> = de 2.5 ori mai probabil să fie cumpărate împreună.
            </p>
          </div>
        </div>
      )}

      <div className="info-box">
        <p>
          Cross-sell Intelligence arata ce produse sunt cumparate impreuna cel mai des. Lift &gt; 1 inseamna ca produsele se cumpara impreuna mai des decat ar fi de asteptat. Foloseste aceste date pentru: bundle-uri, recomandari pe pagina de produs, email-uri de cross-sell.
        </p>
      </div>

      {/* Pagination + controls */}
      {sorted.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
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
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{page * perPage + 1}-{Math.min((page + 1) * perPage, sorted.length)} din {sorted.length}</span>
            <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}
              style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'white', fontSize: 11, cursor: page === 0 ? 'not-allowed' : 'pointer', opacity: page === 0 ? 0.4 : 1 }}>
              ←
            </button>
            <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={(page + 1) * perPage >= sorted.length}
              style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'white', fontSize: 11, cursor: (page + 1) * perPage >= sorted.length ? 'not-allowed' : 'pointer', opacity: (page + 1) * perPage >= sorted.length ? 0.4 : 1 }}>
              →
            </button>
          </div>
        </div>
      )}

      <div className="card" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, borderBottom: '0.5px solid var(--border-default)' }}>#</th>
              <th style={{ textAlign: 'left', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, borderBottom: '0.5px solid var(--border-default)' }}>Produs A</th>
              <th style={{ textAlign: 'left', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, borderBottom: '0.5px solid var(--border-default)' }}>Produs B</th>
              <th onClick={() => toggleSort("count")} style={{ textAlign: 'right', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: sortBy === 'count' ? 'var(--kimono-orange)' : 'var(--color-text-muted)', fontWeight: 600, borderBottom: '0.5px solid var(--border-default)', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>Cumpărate împreună {sortBy === "count" ? (sortDir === "desc" ? "▼" : "▲") : "↕"}</th>
              <th onClick={() => toggleSort("lift")} style={{ textAlign: 'right', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: sortBy === 'lift' ? 'var(--kimono-orange)' : 'var(--color-text-muted)', fontWeight: 600, borderBottom: '0.5px solid var(--border-default)', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>Lift Score {sortBy === "lift" ? (sortDir === "desc" ? "▼" : "▲") : "↕"}</th>
            </tr>
          </thead>
          <tbody>
            {paginated.map((p, i) => (
              <tr key={i} style={{ borderBottom: '0.5px solid var(--border-default)' }}>
                <td style={{ padding: 'var(--space-sm) var(--space-md)', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>{page * perPage + i + 1}</td>
                <td style={{ padding: 'var(--space-sm) var(--space-md)', fontSize: '0.875rem' }}>{p.titleA}</td>
                <td style={{ padding: 'var(--space-sm) var(--space-md)', fontSize: '0.875rem' }}>{p.titleB}</td>
                <td style={{ padding: 'var(--space-sm) var(--space-md)', fontSize: '0.875rem', textAlign: 'right', fontWeight: 600 }}>{p.count}</td>
                <td style={{ padding: 'var(--space-sm) var(--space-md)', fontSize: '0.875rem', textAlign: 'right', fontWeight: 600, color: p.lift > 1 ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
                  {p.lift}x
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {pairs.length === 0 && (
          <p style={{ textAlign: 'center', padding: '32px 24px', color: 'var(--color-text-muted)' }}>Nu sunt suficiente date. Sunt necesare comenzi cu mai multe produse.</p>
        )}
      </div>




    </div>
  );
}
