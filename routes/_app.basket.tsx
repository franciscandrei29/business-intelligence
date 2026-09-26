import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData, useSearchParams } from '@remix-run/react';
import { requireUser } from '~/lib/auth/requireAuth.server';
import { db } from '~/lib/db.server';
import { calculateBasketAnalysis } from '~/lib/basket/index';
import { ShoppingBag } from 'lucide-react';

export const meta: MetaFunction = () => [{ title: 'Cross-sell Intelligence — Kimono BI' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const url = new URL(request.url);
  const storeId = url.searchParams.get('store');

  const stores = await db.storeConnection.findMany({
    where: { userId: user.id },
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


      <div className="info-box">
        <p>
          Cross-sell Intelligence arata ce produse sunt cumparate impreuna cel mai des. Lift &gt; 1 inseamna ca produsele se cumpara impreuna mai des decat ar fi de asteptat. Foloseste aceste date pentru: bundle-uri, recomandari pe pagina de produs, email-uri de cross-sell.
        </p>
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, borderBottom: '1px solid var(--color-border)' }}>#</th>
              <th style={{ textAlign: 'left', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, borderBottom: '1px solid var(--color-border)' }}>Produs A</th>
              <th style={{ textAlign: 'left', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, borderBottom: '1px solid var(--color-border)' }}>Produs B</th>
              <th style={{ textAlign: 'right', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, borderBottom: '1px solid var(--color-border)' }}>Cumparate impreuna</th>
              <th style={{ textAlign: 'right', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, borderBottom: '1px solid var(--color-border)' }}>Lift Score</th>
            </tr>
          </thead>
          <tbody>
            {pairs.map((p, i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td style={{ padding: 'var(--space-sm) var(--space-md)', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>{i + 1}</td>
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
          <p style={{ textAlign: 'center', padding: 'var(--space-xl)', color: 'var(--color-text-muted)' }}>Nu sunt suficiente date. Sunt necesare comenzi cu mai multe produse.</p>
        )}
      </div>

      {pairs.length > 0 && (
        <div className="card" style={{ marginTop: 'var(--space-md)' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-sm)' }}>Ce inseamna Lift?</h3>
          <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
            Lift &gt; 1 inseamna ca produsele sunt cumparate impreuna mai des decat s-ar astepta daca ar fi independente.
            Cu cat e mai mare lift-ul, cu atat asocierea e mai puternica. Un lift de 2.5x inseamna de 2.5 ori mai probabil sa fie cumparate impreuna.
          </p>
        </div>
      )}
    </div>
  );
}
