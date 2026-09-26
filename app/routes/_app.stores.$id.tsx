import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json, redirect } from '@remix-run/node';
import { Form, Link, useActionData, useLoaderData, useNavigation } from '@remix-run/react';
import { useEffect, useState } from 'react';
import { requireUser, requireUserContext, requireRole, requireMinRole } from '~/lib/auth/requireAuth.server';
import { db } from '~/lib/db.server';

import { formatDate, formatNumber } from '~/lib/utils';
import { ArrowLeft, RefreshCw, Trash2, CheckCircle, AlertCircle, Clock, ShoppingBag, Users, Package } from 'lucide-react';

export const meta: MetaFunction = ({ data }: any) => [{ title: `${data?.store?.name || 'Magazin'} — Kimono BI` }];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const ctx = await requireUserContext(request);
  const user = ctx.user;
  const store = await db.storeConnection.findFirst({
    where: { id: params.id, userId: ctx.effectiveOwnerId },
    include: {
      _count: { select: { products: true, orders: true, customers: true } },
      settings: true,
    },
  });
  if (!store) throw new Response('Not Found', { status: 404 });
  const canManage = ctx.role === 'owner' || ctx.role === 'admin';
  const canSync = ctx.role !== 'viewer';
  return json({ store, role: ctx.role, canManage, canSync });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const form = await request.formData();
  const intent = String(form.get('intent'));

  // Different gates per intent
  let ctx;
  if (intent === 'delete') {
    ctx = await requireRole(request, ['owner', 'admin']);
  } else if (intent === 'sync') {
    ctx = await requireMinRole(request, 'analyst');
  } else {
    ctx = await requireUserContext(request);
  }

  const store = await db.storeConnection.findFirst({ where: { id: params.id, userId: ctx.effectiveOwnerId } });
  if (!store) return json({ error: 'Magazin negăsit.' }, { status: 404 });

  if (intent === 'sync') {
    await db.storeConnection.update({ where: { id: store.id }, data: { syncStatus: 'SYNCING' } });
    return json({ success: 'Sincronizare pornită.' });
  }

  if (intent === 'retest') {
    try {
      const { getProvider } = await import('~/lib/connectors/index');
      const provider = await getProvider(store);
      const result = await provider.testConnection();
      if (!result.success) {
        return json({
          retestError: result.error || 'Conexiunea a eșuat.',
          retestErrorKind: result.errorKind || 'unknown',
          retestMissingScopes: result.missingScopes || [],
        }, { status: 400 });
      }
      return json({ retestSuccess: `Conexiunea funcționează corect${result.shopName ? ` (${result.shopName})` : ''}.` });
    } catch (err: any) {
      return json({ retestError: err.message || 'Eroare la re-testare.' }, { status: 400 });
    }
  }

  if (intent === 'delete') {
    await db.storeConnection.delete({ where: { id: store.id } });
    return redirect('/stores');
  }

  return json({ error: 'Unknown intent' }, { status: 400 });
}

const PLATFORM_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  SHOPIFY:     { label: 'Shopify',     color: '#5a8a00', bg: 'rgba(150,191,72,0.12)' },
  WOOCOMMERCE: { label: 'WooCommerce', color: '#7e64b5', bg: 'rgba(126,100,181,0.12)' },
  EMAG:        { label: 'eMag',        color: '#b87800', bg: 'rgba(240,160,48,0.12)' },
};

const SYNC_CONFIG: Record<string, { color: string; bg: string; label: string; Icon: any }> = {
  PENDING:   { color: 'var(--warning-text)',  bg: 'var(--warning-bg)',  label: 'În așteptare', Icon: Clock },
  SYNCING:   { color: 'var(--info-text)',     bg: 'var(--info-bg)',     label: 'Sincronizare...', Icon: RefreshCw },
  COMPLETED: { color: 'var(--success-text)',  bg: 'var(--success-bg)',  label: 'Sincronizat', Icon: CheckCircle },
  FAILED:    { color: 'var(--danger-text)',   bg: 'var(--danger-bg)',   label: 'Eroare sync', Icon: AlertCircle },
};

export default function StoreDetailPage() {
  const { store, canManage, canSync } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSyncing = navigation.state === 'submitting';

  const plt = PLATFORM_CONFIG[store.platform] || PLATFORM_CONFIG.SHOPIFY;
  const sync = SYNC_CONFIG[store.syncStatus] || SYNC_CONFIG.PENDING;
  const SyncIcon = sync.Icon;

  return (
    <div>
      <div className="page-header">
        <div>
          <Link to="/stores" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10, textDecoration: 'none' }}>
            <ArrowLeft size={12} /> Înapoi la magazine
          </Link>
          <h1 className="page-title">{store.name}</h1>
          <p className="page-subtitle">{store.domain}</p>
        </div>
        {canSync && (
          <div className="page-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {canManage && (
              <Form method="post">
                <input type="hidden" name="intent" value="retest" />
                <button type="submit" className="btn btn-secondary" disabled={isSyncing}>
                  <RefreshCw size={12} />
                  Re-testează conexiunea
                </button>
              </Form>
            )}
            <Form method="post">
              <input type="hidden" name="intent" value="sync" />
              <button type="submit" className="btn btn-primary" disabled={isSyncing || store.syncStatus === 'SYNCING'}>
                <RefreshCw size={12} style={{ animation: store.syncStatus === 'SYNCING' ? 'spin 1s linear infinite' : undefined }} />
                {store.syncStatus === 'SYNCING' ? 'Se sincronizează...' : 'Sincronizează'}
              </button>
            </Form>
          </div>
        )}
      </div>

      {actionData?.success && <div className="alert alert-success">{actionData.success}</div>}
      {actionData?.error && <div className="alert alert-error">{actionData.error}</div>}
      {actionData?.retestSuccess && (
        <div className="alert alert-success" style={{ marginBottom: 16 }}>
          ✓ {actionData.retestSuccess}
        </div>
      )}
      {actionData?.retestError && (
        <div style={{
          marginBottom: 16, padding: '12px 14px',
          background: actionData.retestErrorKind === 'missing_scopes' ? 'rgba(217,119,6,0.06)' : 'rgba(220,38,38,0.05)',
          border: `1px solid ${actionData.retestErrorKind === 'missing_scopes' ? 'rgba(217,119,6,0.4)' : 'rgba(220,38,38,0.3)'}`,
          borderRadius: 10,
        }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: actionData.retestErrorKind === 'missing_scopes' ? '#92400e' : '#991b1b', marginBottom: 6 }}>
            {actionData.retestError}
          </div>
          {Array.isArray(actionData.retestMissingScopes) && actionData.retestMissingScopes.length > 0 && (
            <>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const, marginBottom: 8 }}>
                {actionData.retestMissingScopes.map((s: string) => (
                  <code key={s} style={{
                    background: '#0a0a0a', color: '#FFB590',
                    padding: '3px 9px', borderRadius: 4,
                    fontFamily: 'ui-monospace, monospace', fontSize: 11.5, fontWeight: 600,
                  }}>{s}</code>
                ))}
              </div>
              <div style={{ fontSize: 11.5, color: '#78350f', lineHeight: 1.55 }}>
                Întoarce-te în Shopify Admin → app-ul Kimono BI → <strong>Configuration</strong> → <strong>Configure</strong> Admin API → bifează scope-urile lipsă → <strong>Save</strong>. Apoi click din nou pe <strong>Re-testează conexiunea</strong>.
              </div>
            </>
          )}
        </div>
      )}

      {/* Sync progress card — visible while sync is active or on first run */}
      {(store.syncStatus === 'SYNCING' || (store.syncStatus === 'PENDING' && store._count.orders === 0)) && (
        <SyncProgressCard storeId={store.id} initialOrders={store._count.orders} />
      )}

      {/* Status + platform */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 12px', borderRadius: 99, background: plt.bg, color: plt.color, fontSize: 12, fontWeight: 600 }}>
          {plt.label}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 12px', borderRadius: 99, background: sync.bg, color: sync.color, fontSize: 12, fontWeight: 600 }}>
          <SyncIcon size={11} /> {sync.label}
        </span>
        {!store.isActive && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 12px', borderRadius: 99, background: 'var(--danger-bg)', color: 'var(--danger-text)', fontSize: 12, fontWeight: 600 }}>
            Inactiv
          </span>
        )}
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Produse', value: store._count.products, Icon: Package, color: '#7c3aed', bg: 'rgba(124,58,237,0.1)' },
          { label: 'Comenzi', value: store._count.orders, Icon: ShoppingBag, color: 'var(--kimono-orange)', bg: 'rgba(216,90,48,0.1)' },
          { label: 'Clienți', value: store._count.customers, Icon: Users, color: '#0369a1', bg: 'rgba(3,105,161,0.1)' },
        ].map((stat) => {
          const Icon = stat.Icon;
          return (
            <div key={stat.label} className="card" style={{ padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 38, height: 38, borderRadius: 9, background: stat.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon size={16} color={stat.color} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 2 }}>{stat.label}</div>
                <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.5px' }}>
                  {formatNumber(stat.value)}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Details */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ padding: '12px 20px', borderBottom: '0.5px solid var(--border-default)' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Detalii</span>
        </div>
        {[
          { label: 'Platformă', value: plt.label },
          { label: 'Domeniu', value: store.domain },
          { label: 'Status', value: store.isActive ? 'Activ' : 'Inactiv' },
          { label: 'Ultima sincronizare', value: store.lastSyncAt ? formatDate(store.lastSyncAt, 'relative') : 'Niciodată' },
          { label: 'Data conectării', value: formatDate(store.createdAt, 'date') },
        ].map((row) => (
          <div key={row.label} style={{ display: 'flex', padding: '12px 20px', borderBottom: '0.5px solid var(--border-default)', gap: 16 }}>
            <div style={{ width: 160, fontSize: 12, color: 'var(--text-secondary)', flexShrink: 0 }}>{row.label}</div>
            <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>{row.value}</div>
          </div>
        ))}
      </div>

      {/* Danger zone — admin only */}
      {canManage && (
        <div className="card" style={{ border: '0.5px solid var(--danger-bg-strong)' }}>
          <div style={{ padding: '12px 20px', borderBottom: '0.5px solid var(--danger-bg-strong)' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--danger-text)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Zonă periculoasă</span>
          </div>
          <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4 }}>Șterge magazinul</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Toate datele asociate (comenzi, clienți, produse) vor fi șterse definitiv.</div>
            </div>
            <Form method="post" onSubmit={(e) => { if (!confirm('Ești sigur? Această acțiune este ireversibilă.')) e.preventDefault(); }}>
              <input type="hidden" name="intent" value="delete" />
              <button type="submit" className="btn btn-secondary" style={{ color: 'var(--danger-text)', borderColor: 'var(--danger-bg-strong)' }} disabled={isSyncing}>
                <Trash2 size={12} /> Șterge magazinul
              </button>
            </Form>
          </div>
        </div>
      )}
    </div>
  );
}

function SyncProgressCard({ storeId, initialOrders }: { storeId: string; initialOrders: number }) {
  const [data, setData] = useState({
    syncStatus: 'PENDING' as string,
    counts: { products: 0, orders: initialOrders, customers: 0 },
    lastSyncAt: null as string | null,
  });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const res = await fetch(`/api/sync/status?storeId=${storeId}`);
        if (res.ok) {
          const fresh = await res.json();
          if (!cancelled) setData(fresh);
          // Stop polling when sync finishes (any non-syncing state with at least some data)
          if (fresh.syncStatus !== 'SYNCING' && fresh.counts.orders > 0) return;
        }
      } catch { /* network blip — try again */ }
      if (!cancelled) timer = setTimeout(tick, 5000);
    };

    timer = setTimeout(tick, 3000);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [storeId]);

  const isSyncing = data.syncStatus === 'SYNCING';
  const hasFinished = data.syncStatus === 'COMPLETED' && data.counts.orders > 0;

  return (
    <div style={{
      marginBottom: 20,
      padding: '16px 20px',
      background: hasFinished ? 'rgba(22,163,74,0.05)' : 'rgba(216,90,48,0.04)',
      border: `1px solid ${hasFinished ? 'rgba(22,163,74,0.2)' : 'rgba(216,90,48,0.2)'}`,
      borderRadius: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          background: hasFinished ? 'rgba(22,163,74,0.15)' : 'rgba(216,90,48,0.15)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: hasFinished ? '#15803d' : 'var(--kimono-orange)',
          flexShrink: 0,
        }}>
          {hasFinished ? <CheckCircle size={14} /> : <RefreshCw size={14} style={{ animation: isSyncing ? 'spin 1.5s linear infinite' : undefined }} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            {hasFinished ? 'Primul sync s-a încheiat' : isSyncing ? 'Se importă datele din magazin' : 'Sincronizare în așteptare'}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 1 }}>
            {hasFinished
              ? `Toate datele sunt disponibile. Dashboard-urile sunt populate.`
              : isSyncing
                ? 'Primul import durează tipic 5–15 minute pentru un magazin cu istoric. Poți închide pagina — sync-ul continuă în background.'
                : 'Sincronizarea va începe în următoarele minute (cron la 15min).'}
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {[
          { label: 'Produse', value: data.counts.products },
          { label: 'Comenzi', value: data.counts.orders },
          { label: 'Clienți', value: data.counts.customers },
        ].map((m) => (
          <div key={m.label} style={{
            padding: '10px 12px', background: 'white', borderRadius: 6,
            border: '0.5px solid var(--border-default)',
          }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{m.label}</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
              {formatNumber(m.value)}
              {isSyncing && m.value > 0 && (
                <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 400, marginLeft: 6 }}>și creștem</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
