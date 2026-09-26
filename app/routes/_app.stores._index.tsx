import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { Link, useLoaderData } from '@remix-run/react';
import { requireUser, requireUserContext } from '~/lib/auth/requireAuth.server';
import { db } from '~/lib/db.server';
import { formatDate, formatNumber } from '~/lib/utils';
import { Plus, CheckCircle, RefreshCw, AlertCircle, ShoppingBag } from 'lucide-react';

export const meta: MetaFunction = () => [{ title: 'Magazine — Kimono BI' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const ctx = await requireUserContext(request);
  const stores = await db.storeConnection.findMany({
    where: { userId: ctx.effectiveOwnerId },
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
  const canManage = ctx.role === 'owner' || ctx.role === 'admin';
  return json({ stores, canManage });
}

const PLATFORM_CONFIG: Record<string, { bg: string; color: string; label: string }> = {
  SHOPIFY:     { bg: 'rgba(150,191,72,0.12)', color: '#5a8a00', label: 'Shopify' },
  WOOCOMMERCE: { bg: 'rgba(126,100,181,0.12)', color: '#7e64b5', label: 'WooCommerce' },
  EMAG:        { bg: 'rgba(240,160,48,0.12)', color: '#b87800', label: 'eMag' },
};

const SYNC_CONFIG: Record<string, { color: string; icon: React.ElementType; label: string }> = {
  PENDING:   { color: 'var(--warning-text)',  icon: RefreshCw,    label: 'În așteptare' },
  SYNCING:   { color: 'var(--info-text)',     icon: RefreshCw,    label: 'Sincronizare...' },
  COMPLETED: { color: 'var(--success-text)',  icon: CheckCircle,  label: 'Sincronizat' },
  FAILED:    { color: 'var(--danger-text)',   icon: AlertCircle,  label: 'Eroare sync' },
};

export default function StoresPage() {
  const { stores, canManage } = useLoaderData<typeof loader>();

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Magazine</h1>
          <p className="page-subtitle">
            {stores.length === 0 ? 'Niciun magazin conectat' : `${stores.length} magazin${stores.length > 1 ? 'e' : ''} conectat${stores.length > 1 ? 'e' : ''}`}
          </p>
        </div>
        {canManage && (
          <div className="page-actions">
            <Link to="/stores/new" className="btn btn-primary">
              <Plus size={13} /> Adaugă magazin
            </Link>
          </div>
        )}
      </div>

      {stores.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '56px 24px' }}>
          <div style={{ width: 52, height: 52, background: 'var(--bg-tertiary)', borderRadius: '50%', margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ShoppingBag size={22} color="var(--text-secondary)" />
          </div>
          {canManage ? (
            <>
              <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 20 }}>
                Conectează primul tău magazin Shopify sau eMag Marketplace pentru a vedea datele.
              </p>
              <Link to="/stores/new" className="btn btn-primary">
                + Conectează magazin
              </Link>
            </>
          ) : (
            <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
              Echipa nu are încă un magazin conectat. Doar Owner-ul sau un Admin poate adăuga unul.
            </p>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {stores.map((store) => {
            const plt = PLATFORM_CONFIG[store.platform] || PLATFORM_CONFIG.SHOPIFY;
            const sync = SYNC_CONFIG[store.syncStatus] || SYNC_CONFIG.PENDING;
            const SyncIcon = sync.icon;

            return (
              <Link
                key={store.id}
                to={`/stores/${store.id}`}
                style={{ textDecoration: 'none' }}
              >
                <div className="card" style={{ padding: '16px 20px', transition: 'border-color var(--transition-fast)', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
                    {/* Left */}
                    <div style={{ display: 'flex', gap: 14, alignItems: 'center', minWidth: 0 }}>
                      <div style={{ width: 40, height: 40, borderRadius: 10, background: plt.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: `1px solid ${plt.color}22` }}>
                        <span style={{ fontSize: 16, fontWeight: 700, color: plt.color }}>
                          {store.platform === 'SHOPIFY' ? <img src="/shopify-icon.svg" alt="" style={{ width: 18, height: 18 }} /> : store.platform === 'WOOCOMMERCE' ? <img src="/woocommerce-icon.svg" alt="" style={{ width: 18, height: 18 }} /> : store.name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>
                            {store.name}
                          </span>
                          <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 99, background: plt.bg, color: plt.color }}>
                            {plt.label}
                          </span>
                          {!store.isActive && (
                            <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 99, background: 'var(--danger-bg)', color: 'var(--danger-text)' }}>
                              Inactiv
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{store.domain}</div>
                      </div>
                    </div>

                    {/* Right: sync status */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                      <SyncIcon size={12} color={sync.color} />
                      <span style={{ fontSize: 11, color: sync.color, fontWeight: 500 }}>{sync.label}</span>
                      {store.lastSyncAt && (
                        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 4 }}>
                          · {formatDate(store.lastSyncAt, 'relative')}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Stats row */}
                  <div style={{ display: 'flex', gap: 32, marginTop: 14, paddingTop: 14, borderTop: '0.5px solid var(--border-default)' }}>
                    {[
                      { label: 'Produse', value: store._count.products },
                      { label: 'Comenzi', value: store._count.orders },
                      { label: 'Clienți', value: store._count.customers },
                    ].map((stat) => (
                      <div key={stat.label}>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 2 }}>{stat.label}</div>
                        <div style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)', letterSpacing: '-0.5px' }}>
                          {formatNumber(stat.value)}
                        </div>
                      </div>
                    ))}
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
