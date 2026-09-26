import { useState } from 'react';
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData, useSearchParams } from '@remix-run/react';
import { requireUser, requireUserContext } from '~/lib/auth/requireAuth.server';
import { requireModule } from '~/lib/plans.server';
import { db } from '~/lib/db.server';
import { Archive, Download } from 'lucide-react';
import { TablePagination } from '~/components/TablePagination';

export const meta: MetaFunction = () => [{ title: 'Inventory Turnover & Dead Stock — Kimono BI' }];

function buildProductData(products: any[], orders: any[], skuToExternalId: Map<string, string>) {
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

  const productData: { externalId: string; title: string; sku: string | null; vendor: string | null; inventory: number; unitsSold: number; turnover: number; inventoryValue: number; isDead: boolean }[] = [];

  for (const p of products) {
    const price = Number(p.price);
    const invValue = p.inventory * price;
    totalInventoryValue += invValue;
    const sold = unitsSold[p.externalId] || 0;
    const turnover = sold / p.inventory;
    const isDead = sold === 0;

    if (isDead) { deadStockCount++; deadStockValue += invValue; }
    totalTurnover += turnover;
    turnoverCount++;

    productData.push({
      externalId: p.externalId, title: p.title, sku: p.sku, vendor: p.vendor,
      inventory: p.inventory, unitsSold: sold,
      turnover: Math.round(turnover * 100) / 100,
      inventoryValue: Math.round(invValue * 100) / 100,
      isDead,
    });
  }

  const avgTurnover = turnoverCount > 0 ? Math.round((totalTurnover / turnoverCount) * 100) / 100 : 0;

  return { productData, totalInventoryValue: Math.round(totalInventoryValue * 100) / 100, deadStockValue: Math.round(deadStockValue * 100) / 100, deadStockCount, avgTurnover, totalProducts: products.length };
}

function escapeCsv(val: any): string {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const ctx = await requireUserContext(request);
  await requireModule(request, ctx.effectiveOwnerId, 'turnover');
  const url = new URL(request.url);
  const storeId = url.searchParams.get('store');
  const download = url.searchParams.get('download');

  const stores = await db.storeConnection.findMany({
    where: { userId: ctx.effectiveOwnerId },
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

  const { productData, totalInventoryValue, deadStockValue, deadStockCount, avgTurnover, totalProducts } = buildProductData(products, orders, skuToExternalId);

  // ── CSV Download ─────────────────────────────────────────────────────────
  if (download === 'turnover') {
    const sorted = productData
      .filter(p => p.unitsSold > 0)
      .sort((a, b) => a.turnover - b.turnover);

    const header = 'Produs,SKU,Vendor,Stoc,Vandute (90z),Turnover,Valoare Stoc';
    const rows = sorted.map(p =>
      [escapeCsv(p.title), escapeCsv(p.sku), escapeCsv(p.vendor), p.inventory, p.unitsSold, p.turnover, p.inventoryValue].join(',')
    );
    const csv = '\uFEFF' + header + '\n' + rows.join('\n');

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="turnover-slab.csv"',
      },
    });
  }

  if (download === 'deadstock') {
    const dead = productData
      .filter(p => p.isDead)
      .sort((a, b) => b.inventoryValue - a.inventoryValue);

    const header = 'Produs,SKU,Vendor,Stoc,Valoare Blocata';
    const rows = dead.map(p =>
      [escapeCsv(p.title), escapeCsv(p.sku), escapeCsv(p.vendor), p.inventory, p.inventoryValue].join(',')
    );
    const csv = '\uFEFF' + header + '\n' + rows.join('\n');

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="dead-stock.csv"',
      },
    });
  }

  // ── Normal JSON response ─────────────────────────────────────────────────
  const sortBy = url.searchParams.get('sortBy') || 'turnover';

  const allWithSales = productData.filter(p => p.unitsSold > 0);
  const worstTurnover = [...allWithSales].sort((a, b) => {
    if (sortBy === 'stockValue') return b.inventoryValue - a.inventoryValue;
    return a.turnover - b.turnover;
  }).slice(0, 20);

  const allDead = productData.filter(p => p.isDead);
  const deadStock = [...allDead].sort((a, b) => b.inventoryValue - a.inventoryValue).slice(0, 20);

  return json({
    stores,
    data: {
      totalInventoryValue, deadStockValue, deadStockCount, avgTurnover, totalProducts,
      worstTurnover, deadStock,
      worstTurnoverTotal: allWithSales.length,
      deadStockTotal: allDead.length,
      sortBy,
    },
    selectedStoreId,
  });
}

export default function TurnoverPage() {
  const { stores, data, selectedStoreId } = useLoaderData<typeof loader>();
  const [tblPerPage, setTblPerPage] = useState(25);
  const [tblPage, setTblPage] = useState(0);
  const [searchParams, setSearchParams] = useSearchParams();

  if (!data) {
    return (
      <div>
        <div className="page-header"><h1 className="page-title">Inventory Turnover & Dead Stock</h1></div>
        <div className="card" style={{ textAlign: 'center', padding: '56px 24px' }}>
          <p style={{ color: 'var(--color-text-muted)' }}>Conecteaza un magazin.</p>
        </div>
      </div>
    );
  }

  const downloadUrl = (type: string) => {
    const params = new URLSearchParams();
    if (selectedStoreId) params.set('store', selectedStoreId);
    params.set('type', type);
    return `/api/export-turnover?${params.toString()}`;
  };

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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', margin: 0 }}>
            Cel mai slab turnover (cu vanzari)
            <span style={{ fontSize: '0.75rem', fontWeight: 400, color: 'var(--color-text-muted)', marginLeft: 8 }}>
              Top 20 din {data.worstTurnoverTotal}
            </span>
          </h3>
          {data.worstTurnoverTotal > 0 && (
            <a href={downloadUrl('turnover')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)', background: 'var(--bg-tertiary)', border: '0.5px solid var(--border-default)', borderRadius: 6, textDecoration: 'none', cursor: 'pointer' }}>
              <Download size={14} />
              Descarca CSV ({data.worstTurnoverTotal})
            </a>
          )}
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, borderBottom: '0.5px solid var(--border-default)' }}>Produs</th>
              <th style={{ textAlign: 'right', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, borderBottom: '0.5px solid var(--border-default)' }}>Stoc</th>
              <th style={{ textAlign: 'right', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, borderBottom: '0.5px solid var(--border-default)' }}>Vandute (90z)</th>
              <th style={{ textAlign: 'right', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, borderBottom: '0.5px solid var(--border-default)' }}>Turnover</th>
              <th style={{ textAlign: 'right', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, borderBottom: '0.5px solid var(--border-default)' }}>Valoare stoc</th>
            </tr>
          </thead>
          <tbody>
            {data.worstTurnover.map((p) => (
              <tr key={p.externalId} style={{ borderBottom: '0.5px solid var(--border-default)' }}>
                <td style={{ padding: 'var(--space-sm) var(--space-md)', fontSize: '0.875rem' }}>{p.title}</td>
                <td style={{ padding: 'var(--space-sm) var(--space-md)', fontSize: '0.875rem', textAlign: 'right' }}>{p.inventory}</td>
                <td style={{ padding: 'var(--space-sm) var(--space-md)', fontSize: '0.875rem', textAlign: 'right' }}>{p.unitsSold}</td>
                <td style={{ padding: 'var(--space-sm) var(--space-md)', fontSize: '0.875rem', textAlign: 'right', fontWeight: 600, color: 'var(--color-warning)' }}>{p.turnover}x</td>
                <td style={{ padding: 'var(--space-sm) var(--space-md)', fontSize: '0.875rem', textAlign: 'right' }}>{p.inventoryValue.toLocaleString('ro-RO')} RON</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.worstTurnover.length === 0 && <p style={{ textAlign: 'center', padding: '32px 24px', color: 'var(--color-text-muted)' }}>Nu exista produse cu turnover slab.</p>}
      </div>

      {/* Dead stock */}
      <div className="card" style={{ overflowX: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', margin: 0 }}>
            Dead Stock (0 vanzari in 90 zile)
            <span style={{ fontSize: '0.75rem', fontWeight: 400, color: 'var(--color-text-muted)', marginLeft: 8 }}>
              Top 20 din {data.deadStockTotal}
            </span>
          </h3>
          {data.deadStockTotal > 0 && (
            <a href={downloadUrl('deadstock')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)', background: 'var(--bg-tertiary)', border: '0.5px solid var(--border-default)', borderRadius: 6, textDecoration: 'none', cursor: 'pointer' }}>
              <Download size={14} />
              Descarca CSV ({data.deadStockTotal})
            </a>
          )}
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, borderBottom: '0.5px solid var(--border-default)' }}>Produs</th>
              <th style={{ textAlign: 'right', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, borderBottom: '0.5px solid var(--border-default)' }}>Stoc</th>
              <th style={{ textAlign: 'right', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, borderBottom: '0.5px solid var(--border-default)' }}>Valoare blocata</th>
            </tr>
          </thead>
          <tbody>
            {data.deadStock.map((p) => (
              <tr key={p.externalId} style={{ borderBottom: '0.5px solid var(--border-default)' }}>
                <td style={{ padding: 'var(--space-sm) var(--space-md)', fontSize: '0.875rem' }}>{p.title}</td>
                <td style={{ padding: 'var(--space-sm) var(--space-md)', fontSize: '0.875rem', textAlign: 'right' }}>{p.inventory}</td>
                <td style={{ padding: 'var(--space-sm) var(--space-md)', fontSize: '0.875rem', textAlign: 'right', fontWeight: 600, color: 'var(--color-danger)' }}>{p.inventoryValue.toLocaleString('ro-RO')} RON</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.deadStock.length === 0 && <p style={{ textAlign: 'center', padding: '32px 24px', color: 'var(--color-text-muted)' }}>Nu exista dead stock.</p>}
      </div>
    </div>
  );
}
