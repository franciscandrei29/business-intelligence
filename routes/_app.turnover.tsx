import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData, useSearchParams } from '@remix-run/react';
import { requireUser } from '~/lib/auth/requireAuth.server';
import { db } from '~/lib/db.server';
import { Archive } from 'lucide-react';

export const meta: MetaFunction = () => [{ title: 'Inventory Turnover & Dead Stock — Kimono BI' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const url = new URL(request.url);
  const storeId = url.searchParams.get('store');

  const stores = await db.storeConnection.findMany({
    where: { userId: user.id },
    select: { id: true, name: true },
  });

  const selectedStoreId = storeId || stores[0]?.id;
  if (!selectedStoreId) return json({ stores, data: null });

  const products = await db.product.findMany({
    where: { storeConnectionId: selectedStoreId, inventory: { gt: 0 } },
    select: { externalId: true, title: true, price: true, inventory: true, vendor: true, sku: true },
  });

  const skuToExternalId = new Map<string, string>();
  for (const p of products) {
    if (p.sku) skuToExternalId.set(p.sku, p.externalId);
  }

  const d90 = new Date(); d90.setDate(d90.getDate() - 90);
  const orders = await db.order.findMany({
    where: { storeConnectionId: selectedStoreId, placedAt: { gte: d90 } },
    select: { lineItems: true },
  });

  // units sold per product
  const unitsSold: Record<string, number> = {};
  for (const o of orders) {
    if (!o.lineItems) continue;
    let items: any[];
    try { items = JSON.parse(o.lineItems); } catch { continue; }
    for (const item of items) {
      let pid = String(item.product_id || item.productId || item.externalId || '');
      if (!pid && item.sku) pid = skuToExternalId.get(String(item.sku)) || '';
      const qty = Number(item.quantity || 1);
      if (pid) unitsSold[pid] = (unitsSold[pid] || 0) + qty;
    }
  }

  let totalInventoryValue = 0;
  let deadStockValue = 0;
  let deadStockCount = 0;
  let totalTurnover = 0;
  let turnoverCount = 0;

  const productData: { externalId: string; title: string; vendor: string | null; inventory: number; unitsSold: number; turnover: number; inventoryValue: number; isDead: boolean }[] = [];

  for (const p of products) {
    const price = Number(p.price);
    const invValue = p.inventory * price;
    totalInventoryValue += invValue;
    const sold = unitsSold[p.externalId] || 0;
    const turnover = sold / p.inventory;
    const isDead = sold === 0;

    if (isDead) {
      deadStockCount++;
      deadStockValue += invValue;
    }

    totalTurnover += turnover;
    turnoverCount++;

    productData.push({
      externalId: p.externalId,
      title: p.title,
      vendor: p.vendor,
      inventory: p.inventory,
      unitsSold: sold,
      turnover: Math.round(turnover * 100) / 100,
      inventoryValue: Math.round(invValue * 100) / 100,
      isDead,
    });
  }

  const avgTurnover = turnoverCount > 0 ? Math.round((totalTurnover / turnoverCount) * 100) / 100 : 0;

  const sortBy = url.searchParams.get('sortBy') || 'turnover';

  const worstTurnover = productData.filter(p => !p.isDead).sort((a, b) => {
    if (sortBy === 'stockValue') return b.inventoryValue - a.inventoryValue;
    return a.turnover - b.turnover;
  }).slice(0, 20);
  const deadStock = productData.filter(p => p.isDead).sort((a, b) => b.inventoryValue - a.inventoryValue).slice(0, 20);

  return json({
    stores,
    data: {
      totalInventoryValue: Math.round(totalInventoryValue * 100) / 100,
      deadStockValue: Math.round(deadStockValue * 100) / 100,
      deadStockCount,
      avgTurnover,
      totalProducts: products.length,
      worstTurnover,
      deadStock,
      sortBy,
    },
    selectedStoreId,
  });
}

export default function TurnoverPage() {
  const { stores, data, selectedStoreId } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  if (!data) {
    return (
      <div>
        <div className="page-header"><h1 className="page-title">Inventory Turnover & Dead Stock</h1></div>
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}>
          <p style={{ color: 'var(--color-text-muted)' }}>Conecteaza un magazin.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
        <div>
          <h1 className="page-title">Inventory Turnover & Dead Stock</h1>
          <p className="page-subtitle">{data.totalProducts} produse cu stoc analizate (90 zile)</p>
        </div>
        {stores.length > 1 && (
          <select className="form-input" style={{ width: 220 }} value={selectedStoreId || ''} onChange={(e) => setSearchParams({ store: e.target.value })}>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </div>

      <div className="info-box">
        <p>
          Inventory Turnover masoara cat de rapid se vand produsele. Turnover mare = produs popular. Dead Stock = produse cu stoc dar fara vanzari in 90 de zile. Valoarea dead stock arata cati bani sunt blocati in produse care nu se vand.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)', flexWrap: 'wrap' }}>
        <select className="form-input" style={{ width: 220 }} value={data.sortBy || 'turnover'} onChange={(e) => { const params = new URLSearchParams(searchParams); params.set('sortBy', e.target.value); setSearchParams(params); }}>
          <option value="turnover">Sorteaza dupa Turnover</option>
          <option value="stockValue">Sorteaza dupa Valoare stoc</option>
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-md)', marginBottom: 'var(--space-xl)' }}>
        <div className="card">
          <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: 'var(--space-xs)' }}>Valoare totala stoc</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-text-heading)' }}>{data.totalInventoryValue.toLocaleString('ro-RO')} RON</div>
        </div>
        <div className="card">
          <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: 'var(--space-xs)' }}>Valoare dead stock</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-danger)' }}>{data.deadStockValue.toLocaleString('ro-RO')} RON</div>
        </div>
        <div className="card">
          <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: 'var(--space-xs)' }}>Produse dead stock</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-danger)' }}>{data.deadStockCount}</div>
        </div>
        <div className="card">
          <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: 'var(--space-xs)' }}>Turnover mediu</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-text-heading)' }}>{data.avgTurnover}x</div>
        </div>
      </div>

      {/* Worst turnover */}
      <div className="card" style={{ overflowX: 'auto', marginBottom: 'var(--space-md)' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-md)' }}>Cel mai slab turnover (cu vanzari)</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, borderBottom: '1px solid var(--color-border)' }}>Produs</th>
              <th style={{ textAlign: 'right', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, borderBottom: '1px solid var(--color-border)' }}>Stoc</th>
              <th style={{ textAlign: 'right', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, borderBottom: '1px solid var(--color-border)' }}>Vandute (90z)</th>
              <th style={{ textAlign: 'right', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, borderBottom: '1px solid var(--color-border)' }}>Turnover</th>
              <th style={{ textAlign: 'right', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, borderBottom: '1px solid var(--color-border)' }}>Valoare stoc</th>
            </tr>
          </thead>
          <tbody>
            {data.worstTurnover.map((p) => (
              <tr key={p.externalId} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td style={{ padding: 'var(--space-sm) var(--space-md)', fontSize: '0.875rem' }}>{p.title}</td>
                <td style={{ padding: 'var(--space-sm) var(--space-md)', fontSize: '0.875rem', textAlign: 'right' }}>{p.inventory}</td>
                <td style={{ padding: 'var(--space-sm) var(--space-md)', fontSize: '0.875rem', textAlign: 'right' }}>{p.unitsSold}</td>
                <td style={{ padding: 'var(--space-sm) var(--space-md)', fontSize: '0.875rem', textAlign: 'right', fontWeight: 600, color: 'var(--color-warning)' }}>{p.turnover}x</td>
                <td style={{ padding: 'var(--space-sm) var(--space-md)', fontSize: '0.875rem', textAlign: 'right' }}>{p.inventoryValue.toLocaleString('ro-RO')} RON</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.worstTurnover.length === 0 && <p style={{ textAlign: 'center', padding: 'var(--space-xl)', color: 'var(--color-text-muted)' }}>Nu exista produse cu turnover slab.</p>}
      </div>

      {/* Dead stock */}
      <div className="card" style={{ overflowX: 'auto' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-md)' }}>Dead Stock (0 vanzari in 90 zile)</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, borderBottom: '1px solid var(--color-border)' }}>Produs</th>
              <th style={{ textAlign: 'right', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, borderBottom: '1px solid var(--color-border)' }}>Stoc</th>
              <th style={{ textAlign: 'right', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, borderBottom: '1px solid var(--color-border)' }}>Valoare blocata</th>
            </tr>
          </thead>
          <tbody>
            {data.deadStock.map((p) => (
              <tr key={p.externalId} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td style={{ padding: 'var(--space-sm) var(--space-md)', fontSize: '0.875rem' }}>{p.title}</td>
                <td style={{ padding: 'var(--space-sm) var(--space-md)', fontSize: '0.875rem', textAlign: 'right' }}>{p.inventory}</td>
                <td style={{ padding: 'var(--space-sm) var(--space-md)', fontSize: '0.875rem', textAlign: 'right', fontWeight: 600, color: 'var(--color-danger)' }}>{p.inventoryValue.toLocaleString('ro-RO')} RON</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.deadStock.length === 0 && <p style={{ textAlign: 'center', padding: 'var(--space-xl)', color: 'var(--color-text-muted)' }}>Nu exista dead stock.</p>}
      </div>
    </div>
  );
}
