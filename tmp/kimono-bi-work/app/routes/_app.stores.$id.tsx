import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json, redirect } from '@remix-run/node';
import { Form, Link, useLoaderData, useNavigation, useRevalidator } from '@remix-run/react';
import { requireUser } from '~/lib/auth/requireAuth.server';
import { db } from '~/lib/db.server';
import { getProvider } from '~/lib/connectors/index';
import { ArrowLeft, RefreshCw, Trash2, Package, ShoppingCart, Users, Clock, Zap } from 'lucide-react';
import { useEffect } from 'react';

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: `${data?.store?.name || 'Magazin'} — Kimono BI` },
];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const store = await db.storeConnection.findFirst({
    where: { id: params.id, userId: user.id },
    include: {
      _count: { select: { products: true, orders: true, customers: true } },
    },
  });

  if (!store) throw new Response('Not found', { status: 404 });

  return json({ store });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  const intent = String(form.get('intent'));

  const store = await db.storeConnection.findFirst({
    where: { id: params.id, userId: user.id },
  });
  if (!store) throw new Response('Not found', { status: 404 });

  if (intent === 'sync') {
    // Mark as syncing
    await db.storeConnection.update({
      where: { id: store.id },
      data: { syncStatus: 'SYNCING' },
    });

    // Run sync in background (non-blocking)
    runSync(store.id).catch((err) => {
      console.error(`Sync failed for store ${store.id}:`, err);
    });

    return json({ message: 'Sync pornit...' });
  }

  if (intent === 'update-interval') {
    const interval = parseInt(String(form.get('syncIntervalMinutes') || '60'), 10);
    if (![0, 15, 30, 60, 120, 360, 1440].includes(interval)) {
      return json({ error: 'Interval invalid' }, { status: 400 });
    }
    await db.storeConnection.update({
      where: { id: store.id },
      data: { syncIntervalMinutes: interval },
    });
    return json({ message: interval === 0 ? 'Sync automat dezactivat' : `Interval setat la ${interval} minute` });
  }

  if (intent === 'delete') {
    // Delete all related data first
    await db.$transaction([
      db.product.deleteMany({ where: { storeConnectionId: store.id } }),
      db.order.deleteMany({ where: { storeConnectionId: store.id } }),
      db.customer.deleteMany({ where: { storeConnectionId: store.id } }),
      db.rfmSegment.deleteMany({ where: { storeConnectionId: store.id } }),
      db.cohort.deleteMany({ where: { storeConnectionId: store.id } }),
      db.aiReport.deleteMany({ where: { storeConnectionId: store.id } }),
      db.stockAlert.deleteMany({ where: { storeConnectionId: store.id } }),
      db.productCost.deleteMany({ where: { storeConnectionId: store.id } }),
      db.aiInsight.deleteMany({ where: { storeConnectionId: store.id } }),
      db.storeSettings.deleteMany({ where: { storeConnectionId: store.id } }),
      db.storeConnection.delete({ where: { id: store.id } }),
    ]);

    return redirect('/stores');
  }

  return json({ error: 'Unknown intent' }, { status: 400 });
}

async function runSync(storeId: string) {
  try {
    const store = await db.storeConnection.findUnique({ where: { id: storeId } });
    if (!store) return;

    const provider = await getProvider(store);
    let totalProducts = 0, totalOrders = 0, totalCustomers = 0;

    // 1. Sync products (all pages)
    try {
      let productCursor: string | undefined;
      do {
        const result = await provider.fetchProducts({ cursor: productCursor, limit: 50 });
        for (const p of result.data) {
          await db.product.upsert({
            where: { storeConnectionId_externalId: { storeConnectionId: storeId, externalId: p.externalId } },
            create: { storeConnectionId: storeId, externalId: p.externalId, title: p.title, sku: p.sku, price: p.price, compareAtPrice: p.compareAtPrice, costPerUnit: p.costPerUnit, inventory: p.inventory, vendor: p.vendor, productType: p.productType, tags: p.tags, imageUrl: p.imageUrl, handle: p.handle, status: p.status },
            update: { title: p.title, sku: p.sku, price: p.price, compareAtPrice: p.compareAtPrice, costPerUnit: p.costPerUnit, inventory: p.inventory, vendor: p.vendor, productType: p.productType, tags: p.tags, imageUrl: p.imageUrl, handle: p.handle, status: p.status },
          });
        }
        totalProducts += result.data.length;
        productCursor = result.cursor;
        if (!result.hasNextPage) break;
      } while (true);
    } catch (err) { console.error(`[sync] Products failed for ${storeId}:`, err); }

    // 2. Sync customers FIRST (so we can resolve customerId when saving orders)
    try {
      let customerCursor: string | undefined;
      do {
        const result = await provider.fetchCustomers({ cursor: customerCursor, limit: 50 });
        for (const c of result.data) {
          await db.customer.upsert({
            where: { storeConnectionId_externalId: { storeConnectionId: storeId, externalId: c.externalId } },
            create: { storeConnectionId: storeId, externalId: c.externalId, email: c.email, firstName: c.firstName, lastName: c.lastName, phone: c.phone, totalSpent: c.totalSpent, ordersCount: c.ordersCount, firstOrderAt: c.firstOrderAt, lastOrderAt: c.lastOrderAt, tags: c.tags },
            update: { email: c.email, firstName: c.firstName, lastName: c.lastName, phone: c.phone, totalSpent: c.totalSpent, ordersCount: c.ordersCount, firstOrderAt: c.firstOrderAt, lastOrderAt: c.lastOrderAt, tags: c.tags },
          });
        }
        totalCustomers += result.data.length;
        customerCursor = result.cursor;
        if (!result.hasNextPage) break;
      } while (true);
    } catch (err) { console.error(`[sync] Customers failed for ${storeId} (may need read_customers scope):`, err); }

    // Build customer externalId -> id map once, to avoid per-order DB lookups
    const customerIdMap = new Map<string, string>();
    {
      const allCustomers = await db.customer.findMany({
        where: { storeConnectionId: storeId },
        select: { id: true, externalId: true },
      });
      for (const c of allCustomers) customerIdMap.set(c.externalId, c.id);
    }

    // 3. Sync orders (last 12 months) — now with customerId resolution
    try {
      const now = new Date();
      const twelveMonthsAgo = new Date(now);
      twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
      let orderCursor: string | undefined;
      do {
        const result = await provider.fetchOrders(twelveMonthsAgo, now, { cursor: orderCursor, limit: 50 });
        for (const o of result.data) {
          const customerId = o.customerExternalId ? customerIdMap.get(o.customerExternalId) ?? null : null;
          await db.order.upsert({
            where: { storeConnectionId_externalId: { storeConnectionId: storeId, externalId: o.externalId } },
            create: { storeConnectionId: storeId, externalId: o.externalId, orderNumber: o.orderNumber, customerId, total: o.total, subtotal: o.subtotal, totalRefunded: o.totalRefunded, discountTotal: o.discountTotal, currency: o.currency, status: o.status, financialStatus: o.financialStatus, fulfillmentStatus: o.fulfillmentStatus, itemsCount: o.itemsCount, lineItems: o.lineItems, placedAt: o.placedAt, fulfilledAt: o.fulfilledAt ?? null },
            update: { customerId, total: o.total, subtotal: o.subtotal, totalRefunded: o.totalRefunded, discountTotal: o.discountTotal, status: o.status, financialStatus: o.financialStatus, fulfillmentStatus: o.fulfillmentStatus, itemsCount: o.itemsCount, lineItems: o.lineItems, fulfilledAt: o.fulfilledAt ?? null },
          });
        }
        totalOrders += result.data.length;
        orderCursor = result.cursor;
        if (!result.hasNextPage) break;
      } while (true);
    } catch (err) { console.error(`[sync] Orders failed for ${storeId}:`, err); }

    // Mark as completed (even if some steps failed partially)
    await db.storeConnection.update({
      where: { id: storeId },
      data: { syncStatus: 'COMPLETED', lastSyncAt: new Date() },
    });

    console.log(`Sync completed for store ${storeId}: ${totalProducts} products, ${totalOrders} orders, ${totalCustomers} customers`);
  } catch (err) {
    console.error(`Sync error for store ${storeId}:`, err);
    await db.storeConnection.update({
      where: { id: storeId },
      data: { syncStatus: 'FAILED' },
    });
  }
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  PENDING: { label: 'In asteptare', color: 'var(--color-warning)' },
  SYNCING: { label: 'Se sincronizeaza...', color: 'var(--color-info)' },
  COMPLETED: { label: 'Sincronizat', color: 'var(--color-success)' },
  FAILED: { label: 'Esuat', color: 'var(--color-danger)' },
};

const PLATFORM_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  SHOPIFY: { bg: 'rgba(150, 191, 72, 0.15)', color: '#96bf48', label: 'Shopify' },
  WOOCOMMERCE: { bg: 'rgba(126, 100, 181, 0.15)', color: '#7e64b5', label: 'WooCommerce' },
  EMAG: { bg: 'rgba(240, 160, 48, 0.15)', color: '#f0a030', label: 'eMag' },
};

export default function StoreDetailPage() {
  const { store } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const isSyncing = store.syncStatus === 'SYNCING';

  // Auto-refresh while syncing
  useEffect(() => {
    if (!isSyncing) return;
    const interval = setInterval(() => {
      revalidator.revalidate();
    }, 3000);
    return () => clearInterval(interval);
  }, [isSyncing, revalidator]);

  const statusInfo = STATUS_LABELS[store.syncStatus] || STATUS_LABELS.PENDING;
  const pStyle = PLATFORM_STYLES[store.platform] || PLATFORM_STYLES.SHOPIFY;

  return (
    <div>
      <div className="page-header">
        <Link to="/stores" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', color: 'var(--color-text-muted)', fontSize: '0.875rem', marginBottom: 'var(--space-sm)' }}>
          <ArrowLeft size={16} />
          Inapoi la magazine
        </Link>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-xs)' }}>
              <h1 className="page-title" style={{ marginBottom: 0 }}>{store.name}</h1>
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
            <p className="page-subtitle">{store.domain}</p>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
            <Form method="post" onSubmit={(e) => {
              if (!confirm('Esti sigur ca vrei sa stergi acest magazin si toate datele asociate?')) {
                e.preventDefault();
              }
            }}>
              <input type="hidden" name="intent" value="delete" />
              <button type="submit" className="btn btn-secondary" style={{ color: 'var(--color-danger)' }}>
                <Trash2 size={16} />
                Șterge
              </button>
            </Form>
          </div>
        </div>
      </div>

      {/* Sync control card */}
      <div className="card" style={{ marginBottom: 'var(--space-md)', borderLeft: '6px solid #FF5A1F' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, alignItems: 'start' }}>
          <div>
            <div className="mono-label" style={{ marginBottom: 6 }}>Status sincronizare</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: statusInfo.color, display: 'inline-block' }} />
              <span style={{ fontWeight: 700, fontSize: 15 }}>{statusInfo.label}</span>
            </div>
            {store.lastSyncAt && (
              <div style={{ fontSize: 12, color: '#525252', marginTop: 6 }}>
                Ultima: <strong style={{ color: '#0a0a0a', fontFamily: 'SF Mono, monospace' }}>
                  {new Date(store.lastSyncAt).toLocaleString('ro-RO', { dateStyle: 'short', timeStyle: 'short' })}
                </strong>
              </div>
            )}
          </div>

          <div>
            <div className="mono-label" style={{ marginBottom: 6 }}>Interval sync automat</div>
            <Form method="post">
              <input type="hidden" name="intent" value="update-interval" />
              <select
                name="syncIntervalMinutes"
                className="form-input"
                defaultValue={store.syncIntervalMinutes ?? 60}
                onChange={(e) => e.currentTarget.form?.requestSubmit()}
                style={{ width: '100%', maxWidth: 220 }}
              >
                <option value={15}>La 15 minute</option>
                <option value={30}>La 30 minute</option>
                <option value={60}>La 1 oră</option>
                <option value={120}>La 2 ore</option>
                <option value={360}>La 6 ore</option>
                <option value={1440}>La 24 ore (zilnic)</option>
                <option value={0}>Dezactivat (doar manual)</option>
              </select>
            </Form>
            {store.lastSyncAt && (store.syncIntervalMinutes ?? 0) > 0 && (
              <div style={{ fontSize: 11, color: '#525252', marginTop: 6 }}>
                Următoarea rundă:{' '}
                <strong style={{ color: '#0a0a0a', fontFamily: 'SF Mono, monospace' }}>
                  {new Date(new Date(store.lastSyncAt).getTime() + (store.syncIntervalMinutes ?? 60) * 60 * 1000).toLocaleString('ro-RO', { dateStyle: 'short', timeStyle: 'short' })}
                </strong>
              </div>
            )}
          </div>

          <div>
            <div className="mono-label" style={{ marginBottom: 6 }}>Sincronizare manuală</div>
            <Form method="post">
              <input type="hidden" name="intent" value="sync" />
              <button
                type="submit"
                className="btn btn-primary"
                disabled={isSyncing || navigation.state === 'submitting'}
                style={{ width: '100%', maxWidth: 220 }}
              >
                <Zap size={14} />
                {isSyncing ? 'În progres...' : 'Sync acum'}
              </button>
            </Form>
            <div style={{ fontSize: 11, color: '#525252', marginTop: 6 }}>
              Trage toate datele noi din magazin acum.
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--space-md)' }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <Package size={24} style={{ color: 'var(--color-primary)', marginBottom: 'var(--space-sm)' }} />
          <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--color-text-heading)' }}>
            {store._count.products}
          </div>
          <div style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>Produse</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <ShoppingCart size={24} style={{ color: 'var(--color-info)', marginBottom: 'var(--space-sm)' }} />
          <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--color-text-heading)' }}>
            {store._count.orders}
          </div>
          <div style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>Comenzi</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <Users size={24} style={{ color: 'var(--color-success)', marginBottom: 'var(--space-sm)' }} />
          <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--color-text-heading)' }}>
            {store._count.customers}
          </div>
          <div style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>Clienti</div>
        </div>
      </div>

      {/* Info card */}
      <div className="card" style={{ marginTop: 'var(--space-md)' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-md)' }}>
          Detalii conexiune
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 'var(--space-sm)', fontSize: '0.875rem' }}>
          <span style={{ color: 'var(--color-text-muted)' }}>Platforma</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
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
          </span>
          <span style={{ color: 'var(--color-text-muted)' }}>Domeniu</span>
          <span>{store.domain}</span>
          <span style={{ color: 'var(--color-text-muted)' }}>Activ</span>
          <span>{store.isActive ? 'Da' : 'Nu'}</span>
          <span style={{ color: 'var(--color-text-muted)' }}>Creat la</span>
          <span>{new Date(store.createdAt).toLocaleString('ro-RO')}</span>
        </div>
      </div>
    </div>
  );
}
