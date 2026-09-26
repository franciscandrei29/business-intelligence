import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { Form, useActionData, useLoaderData, useNavigation } from '@remix-run/react';
import { requireUser } from '~/lib/auth/requireAuth.server';
import { db } from '~/lib/db.server';
import { calculateProfitability } from '~/lib/profit/index';
import { DollarSign, Upload } from 'lucide-react';

export const meta: MetaFunction = () => [{ title: 'Profitabilitate — Kimono BI' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const url = new URL(request.url);
  const storeId = url.searchParams.get('store');

  const stores = await db.storeConnection.findMany({
    where: { userId: user.id },
    select: { id: true, name: true },
  });

  const selectedStoreId = storeId || stores[0]?.id;
  if (!selectedStoreId) return json({ stores, profit: null });

  const profit = await calculateProfitability(selectedStoreId);
  return json({ stores, profit, selectedStoreId });
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  const storeId = String(form.get('storeId'));
  const intent = String(form.get('intent'));

  const store = await db.storeConnection.findFirst({ where: { id: storeId, userId: user.id } });
  if (!store) return json({ error: 'Store not found' }, { status: 404 });

  if (intent === 'updateCost') {
    const productExternalId = String(form.get('productExternalId'));
    const costPerUnit = parseFloat(String(form.get('costPerUnit')));
    const productTitle = String(form.get('productTitle') || '');

    if (isNaN(costPerUnit) || costPerUnit < 0) {
      return json({ error: 'Cost invalid.' }, { status: 400 });
    }

    await db.productCost.upsert({
      where: {
        storeConnectionId_productExternalId: { storeConnectionId: storeId, productExternalId },
      },
      create: { storeConnectionId: storeId, productExternalId, productTitle, costPerUnit },
      update: { costPerUnit, productTitle },
    });

    return json({ success: 'Cost actualizat.' });
  }

  return json({ error: 'Unknown intent' }, { status: 400 });
}

export default function ProfitabilityPage() {
  const { stores, profit, selectedStoreId } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();

  if (!profit) {
    return (
      <div>
        <div className="page-header"><h1 className="page-title">Profitabilitate</h1></div>
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}>
          <p style={{ color: 'var(--color-text-muted)' }}>Conecteaza un magazin.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Profitabilitate</h1>
        <p className="page-subtitle">
          {profit.productsWithCost} produse cu cost | {profit.productsWithoutCost} fara cost definit
        </p>
      </div>


      <div className="info-box">
        <p>
          Profitabilitate calculeaza marja de profit per produs bazat pe cost (COGS) vs pret de vanzare. Produsele sunt ordonate dupa profitul total. Daca un produs nu are cost setat, nu apare in analiza — adauga costurile manual sau importa-le din Shopify.
        </p>
      </div>

      {actionData?.success && <div className="alert alert-success">{actionData.success}</div>}

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-md)', marginBottom: 'var(--space-xl)' }}>
        <div className="card">
          <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: 'var(--space-xs)' }}>Venit total (12 luni)</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-text-heading)' }}>{profit.totalRevenue.toLocaleString('ro-RO')} RON</div>
        </div>
        <div className="card">
          <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: 'var(--space-xs)' }}>Cost bunuri (COGS)</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-danger)' }}>{profit.totalCOGS.toLocaleString('ro-RO')} RON</div>
        </div>
        <div className="card">
          <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: 'var(--space-xs)' }}>Profit brut</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-success)' }}>{profit.grossProfit.toLocaleString('ro-RO')} RON</div>
        </div>
        <div className="card">
          <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: 'var(--space-xs)' }}>Marja bruta</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: profit.grossMarginPercent >= 50 ? 'var(--color-success)' : profit.grossMarginPercent >= 30 ? 'var(--color-warning)' : 'var(--color-danger)' }}>
            {profit.grossMarginPercent}%
          </div>
        </div>
      </div>

      {/* Top profitable products */}
      {profit.topProfitable.length > 0 && (
        <div className="card" style={{ overflowX: 'auto', marginBottom: 'var(--space-md)' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-md)' }}>
            Top 10 cele mai profitabile produse
          </h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                <th style={{ textAlign: 'left', padding: 'var(--space-sm)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Produs</th>
                <th style={{ textAlign: 'right', padding: 'var(--space-sm)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Pret</th>
                <th style={{ textAlign: 'right', padding: 'var(--space-sm)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Cost</th>
                <th style={{ textAlign: 'right', padding: 'var(--space-sm)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Marja %</th>
                <th style={{ textAlign: 'right', padding: 'var(--space-sm)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Vandute</th>
                <th style={{ textAlign: 'right', padding: 'var(--space-sm)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Profit total</th>
              </tr>
            </thead>
            <tbody>
              {profit.topProfitable.map((p) => (
                <tr key={p.productId} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: 'var(--space-sm)', fontSize: '0.875rem' }}>{p.title}</td>
                  <td style={{ padding: 'var(--space-sm)', fontSize: '0.875rem', textAlign: 'right' }}>{p.price} RON</td>
                  <td style={{ padding: 'var(--space-sm)', fontSize: '0.875rem', textAlign: 'right', color: 'var(--color-text-muted)' }}>{p.costPerUnit} RON</td>
                  <td style={{ padding: 'var(--space-sm)', fontSize: '0.875rem', textAlign: 'right', fontWeight: 600, color: p.marginPercent >= 50 ? 'var(--color-success)' : 'var(--color-warning)' }}>
                    {p.marginPercent}%
                  </td>
                  <td style={{ padding: 'var(--space-sm)', fontSize: '0.875rem', textAlign: 'right' }}>{p.unitsSold}</td>
                  <td style={{ padding: 'var(--space-sm)', fontSize: '0.875rem', textAlign: 'right', fontWeight: 700, color: 'var(--color-success)' }}>{p.totalProfit.toLocaleString('ro-RO')} RON</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Least profitable */}
      {profit.leastProfitable.length > 0 && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-md)' }}>
            Cele mai putin profitabile produse
          </h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                <th style={{ textAlign: 'left', padding: 'var(--space-sm)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Produs</th>
                <th style={{ textAlign: 'right', padding: 'var(--space-sm)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Marja %</th>
                <th style={{ textAlign: 'right', padding: 'var(--space-sm)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Profit total</th>
                <th style={{ textAlign: 'left', padding: 'var(--space-sm)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Actualizeaza cost</th>
              </tr>
            </thead>
            <tbody>
              {profit.leastProfitable.map((p) => (
                <tr key={p.productId} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: 'var(--space-sm)', fontSize: '0.875rem' }}>{p.title}</td>
                  <td style={{ padding: 'var(--space-sm)', fontSize: '0.875rem', textAlign: 'right', color: p.marginPercent < 20 ? 'var(--color-danger)' : 'var(--color-warning)' }}>
                    {p.marginPercent}%
                  </td>
                  <td style={{ padding: 'var(--space-sm)', fontSize: '0.875rem', textAlign: 'right', fontWeight: 600, color: p.totalProfit < 0 ? 'var(--color-danger)' : 'var(--color-text)' }}>
                    {p.totalProfit.toLocaleString('ro-RO')} RON
                  </td>
                  <td style={{ padding: 'var(--space-sm)' }}>
                    <Form method="post" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <input type="hidden" name="storeId" value={selectedStoreId || ''} />
                      <input type="hidden" name="intent" value="updateCost" />
                      <input type="hidden" name="productExternalId" value={p.productId} />
                      <input type="hidden" name="productTitle" value={p.title} />
                      <input name="costPerUnit" type="number" step="0.01" defaultValue={p.costPerUnit} className="form-input" style={{ width: 80, padding: '4px 8px', fontSize: '0.8125rem' }} />
                      <button type="submit" className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.75rem' }}>
                        Salveaza
                      </button>
                    </Form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
