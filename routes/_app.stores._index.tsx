import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { Link, useLoaderData, useSearchParams } from '@remix-run/react';
import { requireUser } from '~/lib/auth/requireAuth.server';
import { db } from '~/lib/db.server';
import { Store, Plus, CheckCircle } from 'lucide-react';

export const meta: MetaFunction = () => [{ title: 'Magazine — Kimono BI' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const stores = await db.storeConnection.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      domain: true,
      platform: true,
      isActive: true,
      syncStatus: true,
      lastSyncAt: true,
      createdAt: true,
      _count: { select: { products: true, orders: true, customers: true } },
    },
  });
  return json({ stores });
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'var(--color-warning)',
  SYNCING: 'var(--color-info)',
  COMPLETED: 'var(--color-success)',
  FAILED: 'var(--color-danger)',
};

const PLATFORM_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  SHOPIFY: { bg: 'rgba(150, 191, 72, 0.15)', color: '#96bf48', label: 'Shopify' },
  WOOCOMMERCE: { bg: 'rgba(126, 100, 181, 0.15)', color: '#7e64b5', label: 'WooCommerce' },
  EMAG: { bg: 'rgba(240, 160, 48, 0.15)', color: '#f0a030', label: 'eMag' },
};

export default function StoresPage() {
  const { stores } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const wcSuccess = searchParams.get('wc_success');

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
        <div>
          <h1 className="page-title">Magazine</h1>
          <p className="page-subtitle">Gestioneaza magazinele tale conectate</p>
        </div>
        <Link to="/stores/new" className="btn btn-primary">
          <Plus size={18} />
          Adauga magazin
        </Link>
      </div>

      {wcSuccess && (
        <div className="alert alert-success" style={{ marginBottom: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
          <CheckCircle size={18} />
          Magazinul WooCommerce a fost conectat cu succes! Cheile API au fost salvate automat.
        </div>
      )}

      {stores.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}>
          <Store size={48} style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-md)' }} />
          <p style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-md)' }}>
            Nu ai niciun magazin conectat.
          </p>
          <Link to="/stores/new" className="btn btn-primary">
            Conecteaza primul magazin
          </Link>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--space-md)' }}>
          {stores.map((store) => {
            const pStyle = PLATFORM_STYLES[store.platform] || PLATFORM_STYLES.SHOPIFY;
            return (
              <Link
                key={store.id}
                to={`/stores/${store.id}`}
                className="card"
                style={{ textDecoration: 'none', display: 'block' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-xs)' }}>
                      <h3 style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--color-text-heading)' }}>
                        {store.name}
                      </h3>
                      <span style={{
                        fontSize: '0.6875rem',
                        padding: '2px 8px',
                        borderRadius: 'var(--radius-full)',
                        background: pStyle.bg,
                        color: pStyle.color,
                        fontWeight: 600,
                      }}>
                        {pStyle.label}
                      </span>
                    </div>
                    <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
                      {store.domain}
                    </p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: STATUS_COLORS[store.syncStatus] || 'var(--color-text-muted)',
                      display: 'inline-block',
                    }} />
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                      {store.syncStatus}
                    </span>
                  </div>
                </div>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: 'var(--space-md)',
                  marginTop: 'var(--space-md)',
                  paddingTop: 'var(--space-md)',
                  borderTop: '1px solid var(--color-border)',
                }}>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Produse</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-text-heading)' }}>
                      {store._count.products}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Comenzi</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-text-heading)' }}>
                      {store._count.orders}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Clienti</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-text-heading)' }}>
                      {store._count.customers}
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
