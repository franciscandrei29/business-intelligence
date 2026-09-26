import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json, redirect } from '@remix-run/node';
import { Form, Link, useLoaderData, useNavigation, useSearchParams } from '@remix-run/react';
import { requireUser } from '~/lib/auth/requireAuth.server';
import { db } from '~/lib/db.server';
import { PLAN_LIMITS } from '~/lib/plans';
import { Check } from 'lucide-react';

export const meta: MetaFunction = () => [{ title: 'Pricing — Kimono BI' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const sub = await db.subscription.findUnique({ where: { userId: user.id } });
  return json({ currentPlan: sub?.plan || 'FREE', stripeConfigured: !!process.env.STRIPE_SECRET_KEY });
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  const plan = String(form.get('plan'));
  const intent = String(form.get('intent'));

  if (intent === 'manage') {
    // Stripe Customer Portal
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) return json({ error: 'Stripe nu este configurat.' }, { status: 500 });

    const sub = await db.subscription.findUnique({ where: { userId: user.id } });
    if (!sub?.stripeCustomerId) return json({ error: 'Nu exista un abonament Stripe.' }, { status: 400 });

    const stripe = (await import('stripe')).default;
    const stripeClient = new stripe(stripeKey);

    const session = await stripeClient.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: `${process.env.APP_URL}/pricing`,
    });

    return redirect(session.url);
  }

  if (intent === 'checkout') {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) return json({ error: 'Stripe nu este configurat inca. Contacteaza-ne pentru upgrade.' }, { status: 500 });

    const priceIds: Record<string, string> = {
      STARTER: process.env.STRIPE_PRICE_STARTER || '',
      GROWTH: process.env.STRIPE_PRICE_GROWTH || '',
      SCALE: process.env.STRIPE_PRICE_SCALE || '',
    };

    const priceId = priceIds[plan];
    if (!priceId) return json({ error: 'Pret invalid sau neconfigurat.' }, { status: 400 });

    const sub = await db.subscription.findUnique({ where: { userId: user.id } });
    const stripe = (await import('stripe')).default;
    const stripeClient = new stripe(stripeKey);

    let customerId = sub?.stripeCustomerId;
    if (!customerId) {
      const customer = await stripeClient.customers.create({
        email: user.email,
        name: user.fullName,
        metadata: { userId: user.id },
      });
      customerId = customer.id;
      await db.subscription.update({
        where: { userId: user.id },
        data: { stripeCustomerId: customerId },
      });
    }

    const session = await stripeClient.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.APP_URL}/pricing?success=true`,
      cancel_url: `${process.env.APP_URL}/pricing?canceled=true`,
      subscription_data: { trial_period_days: 14 },
    });

    return redirect(session.url!);
  }

  return json({ error: 'Unknown intent' }, { status: 400 });
}

const PLANS = [
  { key: 'FREE', name: 'Free', price: '$0', period: 'forever', features: ['1 magazin', '3 mesaje AI / luna', 'Dashboard', 'AI Advisor'] },
  { key: 'STARTER', name: 'Starter', price: '$49', period: '/luna', features: ['1 magazin', '30 mesaje AI / luna', 'Dashboard', 'AI Advisor', 'Smart Alerts'] },
  { key: 'GROWTH', name: 'Growth', price: '$99', period: '/luna', popular: true, features: ['3 magazine', '100 mesaje AI / luna', 'Toate modulele', 'BI Audit', 'SEO Engine'] },
  { key: 'SCALE', name: 'Scale', price: '$199', period: '/luna', features: ['10 magazine', 'Mesaje AI nelimitate', 'Toate modulele', 'Custom prompts', 'Priority support'] },
];

export default function PricingPage() {
  const { currentPlan, stripeConfigured } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const upgradeFeature = searchParams.get('upgrade');

  return (
    <div>
      <div className="page-header" style={{ textAlign: 'center' }}>
        <h1 className="page-title">Planuri si preturi</h1>
        <p className="page-subtitle">
          {upgradeFeature
            ? `Functia "${upgradeFeature}" necesita un plan superior. Alege planul potrivit.`
            : 'Toate planurile platite au trial gratuit de 14 zile.'}
        </p>
      </div>

      {searchParams.get('success') && (
        <div className="alert alert-success" style={{ textAlign: 'center' }}>Abonament activat cu succes!</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--space-md)', maxWidth: 1100, margin: '0 auto' }}>
        {PLANS.map((plan) => {
          const isCurrent = currentPlan === plan.key;
          return (
            <div key={plan.key} className="card" style={{
              position: 'relative',
              border: plan.popular ? '2px solid var(--color-primary)' : undefined,
            }}>
              {plan.popular && (
                <div style={{
                  position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)',
                  background: 'var(--color-primary)', color: 'white',
                  padding: '2px 12px', borderRadius: 'var(--radius-full)',
                  fontSize: '0.6875rem', fontWeight: 700,
                }}>
                  POPULAR
                </div>
              )}
              <div style={{ textAlign: 'center', marginBottom: 'var(--space-lg)' }}>
                <h3 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--color-text-heading)' }}>{plan.name}</h3>
                <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--color-text-heading)', margin: 'var(--space-sm) 0' }}>
                  {plan.price}
                  <span style={{ fontSize: '0.875rem', fontWeight: 400, color: 'var(--color-text-muted)' }}>{plan.period}</span>
                </div>
              </div>

              <ul style={{ listStyle: 'none', padding: 0, marginBottom: 'var(--space-lg)' }}>
                {plan.features.map((f, i) => (
                  <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', padding: '4px 0', fontSize: '0.875rem', color: 'var(--color-text)' }}>
                    <Check size={14} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
                    {f}
                  </li>
                ))}
              </ul>

              {isCurrent ? (
                <div className="btn btn-secondary btn-full" style={{ pointerEvents: 'none' }}>Plan curent</div>
              ) : plan.key === 'FREE' ? (
                <div />
              ) : (
                <Form method="post">
                  <input type="hidden" name="plan" value={plan.key} />
                  <input type="hidden" name="intent" value="checkout" />
                  <button type="submit" className={`btn btn-full ${plan.popular ? 'btn-primary' : 'btn-secondary'}`}
                    disabled={navigation.state === 'submitting'}>
                    Upgrade
                  </button>
                </Form>
              )}
            </div>
          );
        })}
      </div>

      {currentPlan !== 'FREE' && stripeConfigured && (
        <div style={{ textAlign: 'center', marginTop: 'var(--space-xl)' }}>
          <Form method="post">
            <input type="hidden" name="intent" value="manage" />
            <button type="submit" className="btn btn-secondary">
              Gestioneaza abonamentul (Stripe Portal)
            </button>
          </Form>
        </div>
      )}
    </div>
  );
}
