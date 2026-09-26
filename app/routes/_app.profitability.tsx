import { useState } from 'react';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { Form, useActionData, useLoaderData, useNavigation } from '@remix-run/react';
import { requireUser, requireUserContext } from '~/lib/auth/requireAuth.server';
import { requireModule } from '~/lib/plans.server';
import { db } from '~/lib/db.server';
import { calculateProfitability } from '~/lib/profit/index';
import { DollarSign, Upload } from 'lucide-react';
import { TablePagination } from '~/components/TablePagination';

export const meta: MetaFunction = () => [{ title: 'Profitabilitate — Kimono BI' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const ctx = await requireUserContext(request);
  const user = ctx.user;
  await requireModule(request, ctx.effectiveOwnerId, 'profitability');
  const url = new URL(request.url);
  const storeId = url.searchParams.get('store');

  const stores = await db.storeConnection.findMany({
    where: { userId: ctx.effectiveOwnerId },
    select: { id: true, name: true },
  });

  const selectedStoreId = storeId || stores[0]?.id;
  if (!selectedStoreId) return json({ stores, profit: null });

  const profit = await calculateProfitability(selectedStoreId);
  return json({ stores, profit, selectedStoreId });
}

export async function action({ request }: ActionFunctionArgs) {
  const ctx = await requireUserContext(request);
  const user = ctx.user;
  const form = await request.formData();
  const storeId = String(form.get('storeId'));
  const intent = String(form.get('intent'));

  const store = await db.storeConnection.findFirst({ where: { id: storeId, userId: ctx.effectiveOwnerId } });
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
  const [tblPerPage, setTblPerPage] = useState(25);
  const [tblPage, setTblPage] = useState(0);
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();

  if (!profit) {
    return (
      <div>
        <div className="page-header"><h1 className="page-title">Profitabilitate</h1></div>
        <div className="card" style={{ textAlign: 'center', padding: '56px 24px' }}>
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
          Profitabilitate calculeaza marja de profit per produs bazat pe cost (COGS) vs pret de vanzare, incluzand costurile operationale (transport, retururi, fee-uri card). Configureaza costurile in <a href="/settings" style={{ color: 'var(--kimono-orange)' }}>Settings</a>.
        </p>
      </div>

      {/* Net Profit Overview */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-md)', marginBottom: 'var(--space-xl)' }}>
        <div className="card" style={{ borderLeft: '3px solid #22c55e' }}>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>Revenue total (12 luni)</div>
          <div style={{ fontSize: 22, fontWeight: 600, color: '#22c55e' }}>{profit.totalRevenue.toLocaleString('ro-RO')} RON</div>
        </div>
        <div className="card" style={{ borderLeft: '3px solid #f59e0b' }}>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>COGS (cost produse)</div>
          <div style={{ fontSize: 22, fontWeight: 600, color: '#f59e0b' }}>-{profit.totalCOGS.toLocaleString('ro-RO')} RON</div>
        </div>
        <div className="card" style={{ borderLeft: '3px solid #3b82f6' }}>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>Gross Profit</div>
          <div style={{ fontSize: 22, fontWeight: 600, color: '#3b82f6' }}>{profit.grossProfit.toLocaleString('ro-RO')} RON</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Marja bruta: {profit.grossMarginPercent}%</div>
        </div>
        <div className="card" style={{ borderLeft: '3px solid #dc2626' }}>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>Costuri operationale</div>
          <div style={{ fontSize: 22, fontWeight: 600, color: '#dc2626' }}>-{profit.operationalCosts.total.toLocaleString('ro-RO')} RON</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            {profit.operationalCosts.shippingCost > 0 && `Transport: ${profit.operationalCosts.shippingCost.toLocaleString('ro-RO')} | `}
            {profit.operationalCosts.returnCost > 0 && `Retururi: ${profit.operationalCosts.returnCost.toLocaleString('ro-RO')} | `}
            {profit.operationalCosts.cardFees > 0 && `Card: ${profit.operationalCosts.cardFees.toLocaleString('ro-RO')}`}
          </div>
        </div>
        <div className="card" style={{ borderLeft: '3px solid #7c3aed', background: 'rgba(124,58,237,0.03)' }}>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>Net Profit (real)</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: profit.netProfit >= 0 ? '#7c3aed' : '#dc2626' }}>{profit.netProfit.toLocaleString('ro-RO')} RON</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Marja neta: {profit.netMarginPercent}%</div>
        </div>
      </div>

      {actionData?.success && <div className="alert alert-success">{actionData.success}</div>}



      {/* Top profitable products */}
      {profit.topProfitable.length > 0 && (
        <div className="card" style={{ overflowX: 'auto', marginBottom: 'var(--space-md)' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-md)' }}>
            Top 10 cele mai profitabile produse
          </h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
            <thead>
              <tr style={{ borderBottom: '0.5px solid var(--border-default)' }}>
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
                <tr key={p.productId} style={{ borderBottom: '0.5px solid var(--border-default)' }}>
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
              <tr style={{ borderBottom: '0.5px solid var(--border-default)' }}>
                <th style={{ textAlign: 'left', padding: 'var(--space-sm)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Produs</th>
                <th style={{ textAlign: 'right', padding: 'var(--space-sm)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Marja %</th>
                <th style={{ textAlign: 'right', padding: 'var(--space-sm)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Profit total</th>
                <th style={{ textAlign: 'left', padding: 'var(--space-sm)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Actualizeaza cost</th>
              </tr>
            </thead>
            <tbody>
              {profit.leastProfitable.map((p) => (
                <tr key={p.productId} style={{ borderBottom: '0.5px solid var(--border-default)' }}>
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
