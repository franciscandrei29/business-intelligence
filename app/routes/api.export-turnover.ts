import type { LoaderFunctionArgs } from '@remix-run/node';
import { requireUserContext } from '~/lib/auth/requireAuth.server';
import { db } from '~/lib/db.server';

function escapeCsv(val: any): string {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes(';')) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function fmtNum(n: number): string {
  return n.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export async function loader({ request }: LoaderFunctionArgs) {
  const ctx = await requireUserContext(request);
  const url = new URL(request.url);
  const storeId = url.searchParams.get('store');
  const type = url.searchParams.get('type') || 'deadstock';

  const stores = await db.storeConnection.findMany({
    where: { userId: ctx.effectiveOwnerId },
    select: { id: true, name: true },
  });

  const selectedStoreId = storeId || stores[0]?.id;
  if (!selectedStoreId) {
    return new Response('No store found', { status: 400 });
  }

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

  const productData = products.map(p => {
    const price = Number(p.price);
    const sold = unitsSold[p.externalId] || 0;
    const turnover = p.inventory > 0 ? Math.round((sold / p.inventory) * 100) / 100 : 0;
    return {
      title: p.title, sku: p.sku, vendor: p.vendor,
      inventory: p.inventory, unitsSold: sold, turnover,
      inventoryValue: Math.round(p.inventory * price * 100) / 100,
      isDead: sold === 0,
    };
  });

  if (type === 'turnover') {
    const sorted = productData.filter(p => p.unitsSold > 0).sort((a, b) => a.turnover - b.turnover);
    const header = 'Produs,SKU,Vendor,Stoc,Vandute (90z),Turnover,Valoare Stoc';
    const rows = sorted.map(p =>
      [escapeCsv(p.title), escapeCsv(p.sku), escapeCsv(p.vendor), p.inventory, p.unitsSold, p.turnover, fmtNum(p.inventoryValue)].join(',')
    );
    const csv = '\uFEFF' + header + '\n' + rows.join('\n');
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="turnover-slab.csv"',
      },
    });
  }

  // deadstock
  const dead = productData.filter(p => p.isDead).sort((a, b) => b.inventoryValue - a.inventoryValue);
  const header = 'Produs,SKU,Vendor,Stoc,Valoare Blocata';
  const rows = dead.map(p =>
    [escapeCsv(p.title), escapeCsv(p.sku), escapeCsv(p.vendor), p.inventory, fmtNum(p.inventoryValue)].join(',')
  );
  const csv = '\uFEFF' + header + '\n' + rows.join('\n');
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="dead-stock.csv"',
    },
  });
}
