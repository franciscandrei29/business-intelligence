import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { Form, useActionData, useLoaderData, useNavigation } from '@remix-run/react';
import { requireUser } from '~/lib/auth/requireAuth.server';
import { db } from '~/lib/db.server';
import {
  BUILT_IN_RULES,
  executeChurnWinback,
  executeReorderAlert,
  executeDiscountOptimizer,
} from '~/lib/actions/index';
import { Zap, Play } from 'lucide-react';

export const meta: MetaFunction = () => [{ title: 'Automated Actions — Kimono BI' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const stores = await db.storeConnection.findMany({
    where: { userId: user.id },
    select: { id: true, name: true },
  });
  const url = new URL(request.url);
  const selectedStoreId = url.searchParams.get('store') || stores[0]?.id;
  return json({ stores, rules: BUILT_IN_RULES, selectedStoreId });
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  const ruleId = String(form.get('ruleId'));
  const storeId = String(form.get('storeId'));

  const store = await db.storeConnection.findFirst({ where: { id: storeId, userId: user.id } });
  if (!store) return json({ error: 'Store not found' }, { status: 404 });

  let result;
  switch (ruleId) {
    case 'churn-winback':
      result = await executeChurnWinback(storeId);
      break;
    case 'reorder-alert':
      result = await executeReorderAlert(storeId);
      break;
    case 'discount-optimizer':
      result = await executeDiscountOptimizer(storeId);
      break;
    default:
      return json({ error: 'Regula necunoscuta' }, { status: 400 });
  }

  return json({ result });
}

const RULE_COLORS: Record<string, string> = {
  churn_email: '#e74c3c',
  reorder_alert: '#f39c12',
  discount_suggestion: '#3498db',
};

export default function ActionsPage() {
  const { stores, rules, selectedStoreId } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isRunning = navigation.state === 'submitting';

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Automated Actions</h1>
        <p className="page-subtitle">Actiuni automate bazate pe datele magazinului</p>
      </div>


      <div className="info-box">
        <p>
          Smart Actions sunt reguli automate care analizeaza datele si genereaza actiuni concrete:<br/>
          &#x2022; Winback = clienti inactivi 90+ zile cu sugestie de discount personalizat<br/>
          &#x2022; Reaprovizionare = produse care se epuizeaza cu cantitate recomandata de comanda<br/>
          &#x2022; Discount Optimizer = produse slow-moving cu discount maxim profitabil calculat
        </p>
      </div>

      {/* Results */}
      {actionData?.result && (
        <div className="card" style={{ marginBottom: 'var(--space-md)', borderLeft: '3px solid var(--color-success)' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-sm)' }}>
            {actionData.result.rule} — {actionData.result.affectedCount} rezultate
          </h3>
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            {actionData.result.details.map((d: string, i: number) => (
              <div key={i} style={{ padding: 'var(--space-xs) 0', borderBottom: '1px solid var(--color-border)', fontSize: '0.8125rem', color: 'var(--color-text)' }}>
                {d}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Rules */}
      <div style={{ display: 'grid', gap: 'var(--space-md)' }}>
        {rules.map((rule) => (
          <div key={rule.id} className="card" style={{ borderLeft: `3px solid ${RULE_COLORS[rule.type] || 'var(--color-primary)'}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-xs)' }}>
                  <Zap size={18} style={{ color: RULE_COLORS[rule.type] }} />
                  <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', margin: 0 }}>{rule.name}</h3>
                </div>
                <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', margin: '0 0 var(--space-sm)' }}>
                  {rule.description}
                </p>
                <div style={{ display: 'flex', gap: 'var(--space-lg)', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                  <span><strong>Conditie:</strong> {rule.condition}</span>
                  <span><strong>Actiune:</strong> {rule.action}</span>
                </div>
              </div>
              <Form method="post">
                <input type="hidden" name="ruleId" value={rule.id} />
                <input type="hidden" name="storeId" value={selectedStoreId || ''} />
                <button type="submit" className="btn btn-primary" disabled={isRunning} style={{ whiteSpace: 'nowrap' }}>
                  <Play size={14} />
                  {isRunning ? 'Se ruleaza...' : 'Ruleaza'}
                </button>
              </Form>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
