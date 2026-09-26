import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { Form, useLoaderData, useNavigation } from '@remix-run/react';
import { requireUser, requireUserContext } from '~/lib/auth/requireAuth.server';
import { requireModule } from '~/lib/plans.server';
import { db } from '~/lib/db.server';
import { calculateCohorts } from '~/lib/cohorts/index';
import { RefreshCw } from 'lucide-react';

export const meta: MetaFunction = () => [{ title: 'Cohorts — Kimono BI' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const ctx = await requireUserContext(request);
  const user = ctx.user;
  await requireModule(request, ctx.effectiveOwnerId, 'cohorts');
  const url = new URL(request.url);
  const storeId = url.searchParams.get('store');

  const stores = await db.storeConnection.findMany({
    where: { userId: ctx.effectiveOwnerId },
    select: { id: true, name: true },
  });

  const selectedStoreId = storeId || stores[0]?.id;
  if (!selectedStoreId) return json({ stores, cohorts: [], cohortMonths: [] });

  const cohortData = await db.cohort.findMany({
    where: { storeConnectionId: selectedStoreId },
    orderBy: [{ cohortMonth: 'asc' }, { monthNumber: 'asc' }],
  });

  // Group by cohort month
  const cohortMonths = [...new Set(cohortData.map((c) => c.cohortMonth))];
  const matrix: Record<string, Record<number, { retention: number; customers: number }>> = {};

  for (const c of cohortData) {
    if (!matrix[c.cohortMonth]) matrix[c.cohortMonth] = {};
    matrix[c.cohortMonth][c.monthNumber] = {
      retention: c.retentionRate,
      customers: c.activeCustomers,
    };
  }

  return json({ stores, cohortMonths, matrix, selectedStoreId });
}

export async function action({ request }: ActionFunctionArgs) {
  const ctx = await requireUserContext(request);
  const user = ctx.user;
  const form = await request.formData();
  const storeId = String(form.get('storeId'));

  const store = await db.storeConnection.findFirst({
    where: { id: storeId, userId: ctx.effectiveOwnerId },
  });
  if (!store) return json({ error: 'Store not found' }, { status: 404 });

  await calculateCohorts(storeId);
  return json({ success: true });
}

function getRetentionColor(rate: number): string {
  if (rate >= 80) return 'rgba(46, 204, 113, 0.8)';
  if (rate >= 60) return 'rgba(46, 204, 113, 0.5)';
  if (rate >= 40) return 'rgba(241, 196, 15, 0.5)';
  if (rate >= 20) return 'rgba(231, 76, 60, 0.3)';
  if (rate > 0) return 'rgba(231, 76, 60, 0.15)';
  return 'transparent';
}

export default function CohortsPage() {
  const { stores, cohortMonths, matrix, selectedStoreId } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isCalculating = navigation.state === 'submitting';

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
        <div>
          <h1 className="page-title">Cohorts</h1>
          <p className="page-subtitle">Analiza retentie pe cohorte lunare</p>
        </div>
        {selectedStoreId && (
          <Form method="post">
            <input type="hidden" name="storeId" value={selectedStoreId} />
            <button type="submit" className="btn btn-primary" disabled={isCalculating}>
              <RefreshCw size={16} className={isCalculating ? 'spinning' : ''} />
              {isCalculating ? 'Se calculeaza...' : 'Recalculeaza'}
            </button>
          </Form>
        )}
      </div>


      <div className="info-box">
        <p>
          Analiza de cohorte arata cati clienti revin sa cumpere luna dupa luna. Fiecare rand e o cohorta (clientii care au cumparat prima data in acea luna). Procentele arata cati au revenit in lunile urmatoare. Verde inchis = retentie buna, rosu = clienti pierduti.
        </p>
      </div>

      {cohortMonths.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '56px 24px' }}>
          <p style={{ color: 'var(--color-text-muted)' }}>
            Nu exista date de cohorte. Sincronizeaza un magazin si apasa "Recalculeaza".
          </p>
        </div>
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600, borderBottom: '0.5px solid var(--border-default)' }}>
                  Cohorta
                </th>
                {Array.from({ length: 12 }, (_, i) => (
                  <th key={i} style={{ textAlign: 'center', padding: '8px 6px', fontSize: '0.6875rem', color: 'var(--color-text-muted)', fontWeight: 600, borderBottom: '0.5px solid var(--border-default)' }}>
                    Luna {i}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cohortMonths.map((month) => (
                <tr key={month}>
                  <td style={{ padding: '6px 12px', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text)', borderBottom: '0.5px solid var(--border-default)' }}>
                    {month}
                  </td>
                  {Array.from({ length: 12 }, (_, i) => {
                    const cell = (matrix as any)?.[month]?.[i];
                    const retention = cell?.retention || 0;
                    const customers = cell?.customers || 0;
                    return (
                      <td
                        key={i}
                        style={{
                          padding: '6px',
                          textAlign: 'center',
                          fontSize: '0.75rem',
                          background: getRetentionColor(retention),
                          borderBottom: '0.5px solid var(--border-default)',
                          color: retention > 0 ? 'var(--color-text-heading)' : 'var(--color-text-muted)',
                          fontWeight: retention > 0 ? 600 : 400,
                        }}
                        title={`${customers} clienti activi`}
                      >
                        {retention > 0 ? `${retention}%` : '-'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
