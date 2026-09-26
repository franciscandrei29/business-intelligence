import type { LoaderFunctionArgs } from '@remix-run/node';
import { requireUser } from '~/lib/auth/requireAuth.server';
import { db } from '~/lib/db.server';

function escapeCsv(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers.map(escapeCsv).join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeCsv).join(','));
  }
  return lines.join('\n');
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const url = new URL(request.url);
  const storeId = url.searchParams.get('store');
  const type = url.searchParams.get('type');

  if (!storeId || !type) {
    return new Response('Missing store or type parameter', { status: 400 });
  }

  // Verify the store belongs to the user
  const store = await db.storeConnection.findFirst({
    where: { id: storeId, userId: user.id },
    select: { id: true, name: true },
  });

  if (!store) {
    return new Response('Store not found', { status: 404 });
  }

  let csv = '';
  let filename = '';

  if (type === 'products') {
    const products = await db.product.findMany({
      where: { storeConnectionId: storeId },
      select: { title: true, sku: true, price: true, inventory: true, vendor: true, status: true },
      orderBy: { title: 'asc' },
    });

    const headers = ['Title', 'SKU', 'Price', 'Inventory', 'Vendor', 'Status'];
    const rows = products.map((p) => [
      p.title, p.sku, Number(p.price), p.inventory, p.vendor, p.status,
    ]);
    csv = toCsv(headers, rows);
    filename = `products-${store.name}-${new Date().toISOString().slice(0, 10)}.csv`;

  } else if (type === 'customers') {
    const customers = await db.customer.findMany({
      where: { storeConnectionId: storeId },
      select: { email: true, firstName: true, lastName: true, totalSpent: true, ordersCount: true, lastOrderAt: true },
      orderBy: { totalSpent: 'desc' },
    });

    const headers = ['Email', 'First Name', 'Last Name', 'Total Spent', 'Orders Count', 'Last Order'];
    const rows = customers.map((c) => [
      c.email,
      c.firstName,
      c.lastName,
      Number(c.totalSpent),
      c.ordersCount,
      c.lastOrderAt ? new Date(c.lastOrderAt).toISOString().slice(0, 10) : null,
    ]);
    csv = toCsv(headers, rows);
    filename = `customers-${store.name}-${new Date().toISOString().slice(0, 10)}.csv`;

  } else if (type === 'orders') {
    const orders = await db.order.findMany({
      where: { storeConnectionId: storeId },
      select: { orderNumber: true, placedAt: true, total: true, currency: true, status: true, itemsCount: true },
      orderBy: { placedAt: 'desc' },
    });

    const headers = ['Order Number', 'Date', 'Total', 'Currency', 'Status', 'Items Count'];
    const rows = orders.map((o) => [
      o.orderNumber,
      new Date(o.placedAt).toISOString().slice(0, 10),
      Number(o.total),
      o.currency,
      o.status,
      o.itemsCount,
    ]);
    csv = toCsv(headers, rows);
    filename = `orders-${store.name}-${new Date().toISOString().slice(0, 10)}.csv`;

  } else {
    return new Response('Invalid type. Use: products, customers, orders', { status: 400 });
  }

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
