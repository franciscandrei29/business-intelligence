import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { Link, useLoaderData } from '@remix-run/react';
import { requireUser } from '~/lib/auth/requireAuth.server';
import { db } from '~/lib/db.server';
import { HeartPulse, CheckCircle, AlertTriangle, XCircle, RefreshCw } from 'lucide-react';

export const meta: MetaFunction = () => [{ title: 'Data Health — Kimono BI' }];

interface HealthCheck {
  label: string;
  status: 'green' | 'yellow' | 'red';
  message: string;
  action?: { label: string; href: string };
}

interface StoreHealth {
  storeName: string;
  storeId: string;
  checks: HealthCheck[];
  score: number;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const stores = await db.storeConnection.findMany({
    where: { userId: user.id },
    select: { id: true, name: true, lastSyncAt: true, syncStatus: true, platform: true },
  });

  const storeHealths: StoreHealth[] = [];

  for (const store of stores) {
    const checks: HealthCheck[] = [];

    // 1. Last sync check
    if (store.lastSyncAt) {
      const hoursSinceSync = (Date.now() - new Date(store.lastSyncAt).getTime()) / (1000 * 60 * 60);
      if (hoursSinceSync > 168) {
        checks.push({ label: 'Ultima sincronizare', status: 'red', message: 'Sincronizat acum ' + Math.floor(hoursSinceSync / 24) + ' zile', action: { label: 'Sincronizeaza acum', href: '/stores/' + store.id } });
      } else if (hoursSinceSync > 24) {
        checks.push({ label: 'Ultima sincronizare', status: 'yellow', message: 'Sincronizat acum ' + Math.floor(hoursSinceSync) + ' ore', action: { label: 'Sincronizeaza acum', href: '/stores/' + store.id } });
      } else {
        checks.push({ label: 'Ultima sincronizare', status: 'green', message: 'Sincronizat acum ' + Math.floor(hoursSinceSync) + ' ore' });
      }
    } else {
      checks.push({ label: 'Ultima sincronizare', status: 'red', message: 'Niciodata sincronizat', action: { label: 'Sincronizeaza acum', href: '/stores/' + store.id } });
    }

    // 2. Product count
    const productCount = await db.product.count({ where: { storeConnectionId: store.id } });
    if (productCount === 0) {
      checks.push({ label: 'Produse', status: 'red', message: '0 produse importate', action: { label: 'Sincronizeaza', href: '/stores/' + store.id } });
    } else {
      checks.push({ label: 'Produse', status: 'green', message: productCount + ' produse' });
    }

    // 3. Order count
    const orderCount = await db.order.count({ where: { storeConnectionId: store.id } });
    if (orderCount === 0) {
      checks.push({ label: 'Comenzi', status: 'red', message: '0 comenzi importate', action: { label: 'Sincronizeaza', href: '/stores/' + store.id } });
    } else {
      checks.push({ label: 'Comenzi', status: 'green', message: orderCount + ' comenzi' });
    }

    // 4. Customer count
    const customerCount = await db.customer.count({ where: { storeConnectionId: store.id } });
    if (customerCount === 0) {
      checks.push({ label: 'Clienti', status: 'yellow', message: '0 clienti importati' });
    } else {
      checks.push({ label: 'Clienti', status: 'green', message: customerCount + ' clienti' });
    }

    // 5. LineItems with productId (COGS accuracy)
    if (orderCount > 0) {
      const ordersWithLineItems = await db.order.findMany({
        where: { storeConnectionId: store.id, lineItems: { not: null } },
        select: { lineItems: true },
        take: 100,
      });
      let totalItems = 0;
      let itemsWithProductId = 0;
      for (const order of ordersWithLineItems) {
        try {
          const items = JSON.parse(order.lineItems || '[]');
          for (const item of items) {
            totalItems++;
            if (item.productId || item.product_id) itemsWithProductId++;
          }
        } catch { /* skip */ }
      }
      const pct = totalItems > 0 ? Math.round((itemsWithProductId / totalItems) * 100) : 0;
      if (pct < 50) {
        checks.push({ label: 'COGS Accuracy', status: 'yellow', message: pct + '% din line items au productId - precizia COGS poate fi afectata' });
      } else {
        checks.push({ label: 'COGS Accuracy', status: 'green', message: pct + '% din line items au productId' });
      }
    }

    // 6. RFM segments
    const rfmCount = await db.rfmSegment.count({ where: { storeConnectionId: store.id } });
    const latestRfm = await db.rfmSegment.findFirst({
      where: { storeConnectionId: store.id },
      orderBy: { calculatedAt: 'desc' },
      select: { calculatedAt: true },
    });
    if (rfmCount === 0) {
      checks.push({ label: 'RFM Segments', status: 'yellow', message: 'Niciun segment RFM calculat', action: { label: 'Calculeaza', href: '/rfm' } });
    } else if (latestRfm) {
      const daysSince = (Date.now() - new Date(latestRfm.calculatedAt).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince > 30) {
        checks.push({ label: 'RFM Segments', status: 'yellow', message: rfmCount + ' segmente, calculate acum ' + Math.floor(daysSince) + ' zile', action: { label: 'Recalculeaza', href: '/rfm' } });
      } else {
        checks.push({ label: 'RFM Segments', status: 'green', message: rfmCount + ' segmente, calculate acum ' + Math.floor(daysSince) + ' zile' });
      }
    }

    // 7. Stock alerts
    const alertCount = await db.stockAlert.count({ where: { storeConnectionId: store.id } });
    checks.push({ label: 'Alerte stoc', status: alertCount > 0 ? 'green' : 'yellow', message: alertCount > 0 ? alertCount + ' alerte calculate' : 'Nicio alerta de stoc', action: alertCount === 0 ? { label: 'Calculeaza', href: '/stock' } : undefined });

    // Score
    const greenCount = checks.filter(c => c.status === 'green').length;
    const score = Math.round((greenCount / checks.length) * 100);

    storeHealths.push({ storeName: store.name, storeId: store.id, checks, score });
  }

  return json({ storeHealths });
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'green') return <CheckCircle size={18} style={{ color: '#2ecc71', flexShrink: 0 }} />;
  if (status === 'yellow') return <AlertTriangle size={18} style={{ color: '#f39c12', flexShrink: 0 }} />;
  return <XCircle size={18} style={{ color: '#e74c3c', flexShrink: 0 }} />;
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 80 ? '#2ecc71' : score >= 50 ? '#f39c12' : '#e74c3c';
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '6px 14px', borderRadius: 20,
      background: color + '18', border: '1px solid ' + color + '40',
    }}>
      <HeartPulse size={16} style={{ color }} />
      <span style={{ color, fontWeight: 700, fontSize: '0.875rem' }}>{score}%</span>
    </div>
  );
}

export default function HealthMonitorPage() {
  const { storeHealths } = useLoaderData<typeof loader>();

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Data Health</h1>
      </div>

      <div className="info-box">
        <p>
          Data Health verifica integritatea si actualitatea datelor din platforma. Verde = totul e la zi. Galben = date vechi (sync acum 24h+). Rosu = probleme detectate. Ruleaza verificarea periodic pentru a te asigura ca deciziile se bazeaza pe date corecte.
        </p>
      </div>

      {storeHealths.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>Niciun magazin conectat. Adauga un magazin pentru a vedea health check-ul.</p>
          <Link to="/stores/new" className="btn btn-primary" style={{ marginTop: 12 }}>Adauga magazin</Link>
        </div>
      ) : (
        storeHealths.map((sh: any) => (
          <div key={sh.storeId} className="card" style={{ marginBottom: 'var(--space-md)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-md)' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', margin: 0 }}>{sh.storeName}</h3>
              <ScoreBadge score={sh.score} />
            </div>

            {sh.checks.map((check: any, i: number) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-sm)',
                padding: '10px 0', borderBottom: i < sh.checks.length - 1 ? '1px solid var(--color-border)' : 'none',
              }}>
                <StatusIcon status={check.status} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.875rem', color: 'var(--color-text)', fontWeight: 500 }}>{check.label}</div>
                  <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>{check.message}</div>
                </div>
                {check.action && (
                  <Link to={check.action.href} className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '4px 10px', textDecoration: 'none' }}>
                    <RefreshCw size={12} /> {check.action.label}
                  </Link>
                )}
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
