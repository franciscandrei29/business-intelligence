import { useState } from 'react';
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData, useSearchParams } from '@remix-run/react';
import { requireUser, requireUserContext } from '~/lib/auth/requireAuth.server';
import { requireModule } from '~/lib/plans.server';
import { db } from '~/lib/db.server';
import { XCircle } from 'lucide-react';
import { TablePagination } from '~/components/TablePagination';

export const meta: MetaFunction = () => [{ title: 'Stockout Revenue Loss — Kimono BI' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const ctx = await requireUserContext(request);
  const user = ctx.user;
  await requireModule(request, ctx.effectiveOwnerId, 'stockout');
  const url = new URL(request.url);
  const storeId = url.searchParams.get('store');

  const stores = await db.storeConnection.findMany({
    where: { userId: ctx.effectiveOwnerId },
    select: { id: true, name: true },
  });

  const selectedStoreId = storeId || stores[0]?.id;
  if (!selectedStoreId) return json({ stores, data: null });

  // Products with 0 inventory
  const outOfStockProducts = await db.product.findMany({
    where: { storeConnectionId: selectedStoreId, inventory: { lte: 0 } },
    select: { externalId: true, title: true, price: true, vendor: true, updatedAt: true, sku: true },
  });

  if (outOfStockProducts.length === 0) {
    return json({ stores, data: { totalLostRevenue: 0, productsAffected: 0, products: [] }, selectedStoreId });
  }

  const skuToExternalId = new Map<string, string>();
  for (const p of outOfStockProducts) {
    if (p.sku) skuToExternalId.set(p.sku, p.externalId);
  }

  const d90 = new Date(); d90.setDate(d90.getDate() - 90);
  const orders = await db.order.findMany({
    where: { storeConnectionId: selectedStoreId, placedAt: { gte: d90 } },
    select: { lineItems: true, placedAt: true },
  });

  // Calculate daily sales for out-of-stock products
  const productSales: Record<string, { totalQty: number; totalRev: number; firstSale: Date; lastSale: Date }> = {};

  for (const o of orders) {
    if (!o.lineItems) continue;
    let items: any[];
    try { items = JSON.parse(o.lineItems); } catch { continue; }
    for (const item of items) {
      let pid = String(item.product_id || item.productId || item.externalId || '');
      if (!pid && item.sku) pid = skuToExternalId.get(String(item.sku)) || '';
      const qty = Number(item.quantity || 1);
      const price = Number(item.price || item.sale_price || 0);
      if (!pid) continue;
      if (!productSales[pid]) productSales[pid] = { totalQty: 0, totalRev: 0, firstSale: new Date(o.placedAt), lastSale: new Date(o.placedAt) };
      productSales[pid].totalQty += qty;
      productSales[pid].totalRev += qty * price;
      const oDate = new Date(o.placedAt);
      if (oDate < productSales[pid].firstSale) productSales[pid].firstSale = oDate;
      if (oDate > productSales[pid].lastSale) productSales[pid].lastSale = oDate;
    }
  }

  const productData: { title: string; vendor: string | null; avgDailySales: number; avgDailyRevenue: number; estimatedDaysOut: number; estimatedLostRevenue: number; price: number }[] = [];

  let totalLostRevenue = 0;

  for (const p of outOfStockProducts) {
    const sales = productSales[p.externalId];
    if (!sales || sales.totalQty === 0) continue;

    const salesPeriodDays = Math.max(1, Math.ceil((sales.lastSale.getTime() - sales.firstSale.getTime()) / 86400000));
    const avgDailySales = sales.totalQty / salesPeriodDays;
    const avgDailyRevenue = sales.totalRev / salesPeriodDays;

    // Estimate days out of stock = days since last sale
    const daysSinceLastSale = Math.ceil((Date.now() - sales.lastSale.getTime()) / 86400000);
    const estimatedDaysOut = Math.max(daysSinceLastSale, 1);

    const estimatedLostRevenue = avgDailyRevenue * estimatedDaysOut;
    totalLostRevenue += estimatedLostRevenue;

    productData.push({
      title: p.title,
      vendor: p.vendor,
      avgDailySales: Math.round(avgDailySales * 100) / 100,
      avgDailyRevenue: Math.round(avgDailyRevenue * 100) / 100,
      estimatedDaysOut,
      estimatedLostRevenue: Math.round(estimatedLostRevenue * 100) / 100,
      price: Number(p.price),
    });
  }

  productData.sort((a, b) => b.estimatedLostRevenue - a.estimatedLostRevenue);

  return json({
    stores,
    data: {
      totalLostRevenue: Math.round(totalLostRevenue * 100) / 100,
      productsAffected: productData.length,
      totalOutOfStock: outOfStockProducts.length,
      products: productData.slice(0, 30),
    },
    selectedStoreId,
  });
}

export default function StockoutPage() {
  const { stores, data, selectedStoreId } = useLoaderData<typeof loader>();
  const [tblPerPage, setTblPerPage] = useState(25);
  const [tblPage, setTblPage] = useState(0);
  const [searchParams, setSearchParams] = useSearchParams();

  if (!data) {
    return (
      <div>
        <div className="page-header"><h1 className="page-title">Stockout Revenue Loss</h1></div>
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
          <h1 className="page-title">Stockout Revenue Loss</h1>
          <p className="page-subtitle">Estimare venit pierdut din lipsa stoc</p>
        </div>
        {stores.length > 1 && (
          <select className="form-input" style={{ width: 220 }} value={selectedStoreId || ''} onChange={(e) => setSearchParams({ store: e.target.value })}>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </div>


      <div className="info-box">
        <p>
          Stockout Revenue Loss estimeaza cat venit pierzi cand un produs e fara stoc. Calculul se bazeaza pe viteza de vanzare din perioada cand produsul era in stoc. Produsele cu pierdere estimata mare ar trebui reaprovizionate urgent.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-md)', marginBottom: 'var(--space-xl)' }}>
        <div className="card">
          <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: 'var(--space-xs)' }}>Estimare venit pierdut</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-danger)' }}>{data.totalLostRevenue.toLocaleString('ro-RO')} RON</div>
        </div>
        <div className="card">
          <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: 'var(--space-xs)' }}>Produse afectate (cu istoric)</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-warning)' }}>{data.productsAffected}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>din {data.totalOutOfStock} fara stoc</div>
        </div>
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-md)' }}>Produse fara stoc cu vanzari anterioare</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, borderBottom: '1px solid var(--color-border)' }}>Produs</th>
              <th style={{ textAlign: 'right', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, borderBottom: '1px solid var(--color-border)' }}>Pret</th>
              <th style={{ textAlign: 'right', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, borderBottom: '1px solid var(--color-border)' }}>Vanz. zilnice med.</th>
              <th style={{ textAlign: 'right', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, borderBottom: '1px solid var(--color-border)' }}>Zile fara stoc</th>
              <th style={{ textAlign: 'right', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, borderBottom: '1px solid var(--color-border)' }}>Venit pierdut est.</th>
            </tr>
          </thead>
          <tbody>
            {data.products.map((p, i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td style={{ padding: 'var(--space-sm) var(--space-md)', fontSize: '0.875rem' }}>
                  <div style={{ fontWeight: 500 }} style={{ maxWidth: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</div>
                  {p.vendor && <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{p.vendor}</div>}
                </td>
                <td style={{ padding: 'var(--space-sm) var(--space-md)', fontSize: '0.875rem', textAlign: 'right', whiteSpace: 'nowrap' }}>{p.price.toLocaleString('ro-RO')} RON</td>
                <td style={{ padding: 'var(--space-sm) var(--space-md)', fontSize: '0.875rem', textAlign: 'right', whiteSpace: 'nowrap' }}>{p.avgDailySales}</td>
                <td style={{ padding: 'var(--space-sm) var(--space-md)', fontSize: '0.875rem', textAlign: 'right', color: 'var(--color-warning)' }}>{p.estimatedDaysOut}</td>
                <td style={{ padding: 'var(--space-sm) var(--space-md)', fontSize: '0.875rem', textAlign: 'right', fontWeight: 700, color: 'var(--color-danger)' }}>{p.estimatedLostRevenue.toLocaleString('ro-RO')} RON</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.products.length === 0 && <p style={{ textAlign: 'center', padding: 'var(--space-xl)', color: 'var(--color-text-muted)' }}>Niciun produs fara stoc cu vanzari anterioare.</p>}
      </div>
    </div>
  );
}
