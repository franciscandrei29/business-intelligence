import React, { useState } from 'react';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json, redirect } from '@remix-run/node';
import { Form, Link, useLoaderData, useNavigation, useSearchParams } from '@remix-run/react';
import { requireUserContext, requireRole } from '~/lib/auth/requireAuth.server';
import { db } from '~/lib/db.server';
import { PLAN_LIMITS, PLAN_MODULES } from '~/lib/plans';

export const meta: MetaFunction = () => [{ title: 'Abonament — Kimono BI' }];

// Multi-currency prices per plan. Yearly = monthly × 10 (2 months free).
type Currency = 'EUR' | 'RON' | 'USD';
const SUPPORTED_CURRENCIES: Currency[] = ['EUR', 'RON', 'USD'];

const PLAN_AMOUNTS: Record<Currency, Record<string, { monthly: number; yearly: number; productName: string }>> = {
  EUR: {
    STARTER: { monthly: 49,  yearly: 490,  productName: 'Kimono BI Starter' },
    GROWTH:  { monthly: 129, yearly: 1290, productName: 'Kimono BI Growth' },
  },
  RON: {
    STARTER: { monthly: 249, yearly: 2490, productName: 'Kimono BI Starter' },
    GROWTH:  { monthly: 649, yearly: 6490, productName: 'Kimono BI Growth' },
  },
  USD: {
    STARTER: { monthly: 55,  yearly: 550,  productName: 'Kimono BI Starter' },
    GROWTH:  { monthly: 149, yearly: 1490, productName: 'Kimono BI Growth' },
  },
};

const CURRENCY_SYMBOL: Record<Currency, { prefix?: string; suffix?: string }> = {
  EUR: { prefix: '€' },
  RON: { suffix: ' lei' },
  USD: { prefix: '$' },
};

function fmtPrice(amount: number, currency: Currency): string {
  const cfg = CURRENCY_SYMBOL[currency];
  const value = String(amount);
  return `${cfg.prefix || ''}${value}${cfg.suffix || ''}`;
}

const TAX_PERCENT = 21;
const TAX_DISPLAY_NAME = 'TVA';

// Cached at module scope so we avoid creating multiple TaxRate objects in Stripe.
// Falls back to env var STRIPE_TAX_RATE_ID if set; else queries Stripe; else creates.
let cachedTaxRateId: string | null = null;

async function getOrCreateTaxRate(stripe: any): Promise<string> {
  if (cachedTaxRateId) return cachedTaxRateId;
  if (process.env.STRIPE_TAX_RATE_ID) {
    cachedTaxRateId = process.env.STRIPE_TAX_RATE_ID;
    return cachedTaxRateId;
  }
  // Look for an existing matching tax rate
  try {
    const list = await stripe.taxRates.list({ limit: 100, active: true });
    const found = list.data.find((t: any) => t.percentage === TAX_PERCENT && t.display_name === TAX_DISPLAY_NAME && !t.inclusive);
    if (found) {
      cachedTaxRateId = found.id;
      return found.id;
    }
  } catch (err) {
    console.error('[stripe] taxRates.list failed:', err);
  }
  const created = await stripe.taxRates.create({
    display_name: TAX_DISPLAY_NAME,
    percentage: TAX_PERCENT,
    inclusive: false,
  });
  cachedTaxRateId = created.id;
  console.log(`[stripe] created TaxRate ${created.id} (${TAX_DISPLAY_NAME} ${TAX_PERCENT}%). Pin în .env: STRIPE_TAX_RATE_ID=${created.id}`);
  return created.id;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const ctx = await requireUserContext(request);
  const sub = await db.subscription.findUnique({ where: { userId: ctx.effectiveOwnerId } }).catch(() => null);
  return json({
    currentPlan: sub?.plan || 'FREE',
    hasStripeCustomer: Boolean(sub?.stripeCustomerId),
    role: ctx.role,
    canBilling: ctx.isOwner,
    stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const ctx = await requireRole(request, ['owner']);
  const form = await request.formData();
  const intent = String(form.get('intent'));

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return json({ error: 'Stripe nu este configurat încă. Contactează-ne la office@kimonogroup.ro.' }, { status: 500 });
  }

  const Stripe = (await import('stripe')).default;
  const stripe = new Stripe(stripeKey);

  const appUrl = process.env.APP_URL || 'https://bi.kimonogroup.ro';

  // ----- CHECKOUT (upgrade to paid plan) -----
  if (intent === 'checkout') {
    const plan = String(form.get('plan') || '').toUpperCase();
    const period = String(form.get('period') || 'monthly').toLowerCase();
    const trialCode = String(form.get('trialCode') || '').trim().toUpperCase();
    const currencyRaw = String(form.get('currency') || 'EUR').toUpperCase() as Currency;

    if (!['STARTER', 'GROWTH'].includes(plan)) {
      return json({ error: 'Plan invalid.' }, { status: 400 });
    }
    if (!['monthly', 'yearly'].includes(period)) {
      return json({ error: 'Perioadă invalidă.' }, { status: 400 });
    }
    if (!SUPPORTED_CURRENCIES.includes(currencyRaw)) {
      return json({ error: 'Monedă neacceptată.' }, { status: 400 });
    }

    const currency = currencyRaw;
    const planAmounts = PLAN_AMOUNTS[currency][plan];
    const amount = period === 'monthly' ? planAmounts.monthly : planAmounts.yearly;
    const interval = period === 'monthly' ? 'month' : 'year';
    const periodLabel = period === 'monthly' ? 'Lunar' : 'Anual (2 luni gratuite)';

    // Get or create Stripe customer
    const sub = await db.subscription.findUnique({ where: { userId: ctx.effectiveOwnerId } });
    let stripeCustomerId = sub?.stripeCustomerId;

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: ctx.user.email,
        name: ctx.user.fullName,
        metadata: { userId: ctx.effectiveOwnerId },
      });
      stripeCustomerId = customer.id;

      await db.subscription.upsert({
        where: { userId: ctx.effectiveOwnerId },
        create: { userId: ctx.effectiveOwnerId, stripeCustomerId, plan: 'FREE', status: 'ACTIVE' },
        update: { stripeCustomerId },
      });
    }

    // Trial? Only for Growth plan with valid code
    const expectedTrialCode = (process.env.TRIAL_CODE || '').toUpperCase();
    const validTrial = Boolean(expectedTrialCode) && plan === 'GROWTH' && trialCode === expectedTrialCode;

    if (trialCode && !validTrial) {
      return json({ error: 'Cod de invitație invalid sau nu se aplică pentru acest plan. Trial-ul e disponibil doar pentru Growth.' }, { status: 400 });
    }

    try {
      const taxRateId = await getOrCreateTaxRate(stripe);

      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        customer: stripeCustomerId,
        line_items: [{
          price_data: {
            currency: currency.toLowerCase(),
            product_data: {
              name: `${planAmounts.productName} — ${periodLabel}`,
              description: `${planAmounts.productName} · plată ${period === 'monthly' ? 'lunară' : 'anuală'}.`,
              metadata: { plan, period },
            },
            recurring: { interval, interval_count: 1 },
            unit_amount: amount * 100, // smallest unit (cents/bani)
            tax_behavior: 'exclusive',
          },
          quantity: 1,
          tax_rates: [taxRateId],
        }],
        subscription_data: {
          metadata: { plan, period, userId: ctx.effectiveOwnerId, currency },
          ...(validTrial ? { trial_period_days: 14 } : {}),
        },
        metadata: { plan, period, userId: ctx.effectiveOwnerId, currency },
        allow_promotion_codes: true,
        // VAT/CIF field always available in Checkout (optional). Customers who buy as a business
        // fill it; individuals leave it blank. Stripe handles the conditional UX natively.
        tax_id_collection: { enabled: true },
        billing_address_collection: 'auto' as const,
        customer_update: { address: 'auto' as const, name: 'auto' as const },
        // Note: avoid `session_id` query param — ModSecurity OWASP CRS rule 943110/943120
        // flags it as "Session Fixation Attack" with off-domain referer (Stripe), causing 404.
        success_url: `${appUrl}/pricing-analysis?success=true`,
        cancel_url: `${appUrl}/pricing-analysis?canceled=true`,
      });

      if (!session.url) {
        return json({ error: 'Stripe nu a returnat URL de checkout.' }, { status: 500 });
      }
      return redirect(session.url);
    } catch (err: any) {
      console.error('[stripe] checkout error:', err);
      return json({ error: `Eroare Stripe: ${err.message || 'unknown'}` }, { status: 500 });
    }
  }

  // ----- MANAGE (Customer Portal: invoices, payment method, cancel) -----
  if (intent === 'manage') {
    const sub = await db.subscription.findUnique({ where: { userId: ctx.effectiveOwnerId } });
    if (!sub?.stripeCustomerId) {
      return json({ error: 'Nu există un abonament Stripe activ.' }, { status: 400 });
    }
    try {
      const portal = await stripe.billingPortal.sessions.create({
        customer: sub.stripeCustomerId,
        return_url: `${appUrl}/pricing-analysis`,
      });
      return redirect(portal.url);
    } catch (err: any) {
      console.error('[stripe] portal error:', err);
      return json({ error: `Eroare deschidere portal: ${err.message || 'unknown'}` }, { status: 500 });
    }
  }

  return json({ error: 'Unknown intent' }, { status: 400 });
}

const MODULE_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  'ask-ai': 'Ask AI',
  stock: 'Smart Alerts',
  analytics: 'Revenue Analytics',
  peaks: 'Peak Hours',
  rfm: 'RFM Segments',
  cohorts: 'Cohort Analysis',
  ltv: 'LTV Analytics',
  forecast: 'Revenue Forecast',
  compare: 'Period Compare',
  churn: 'Churn Prediction',
  bcg: 'BCG Product Matrix',
  basket: 'Cross-sell / Basket',
  discounts: 'Discount Impact',
  refunds: 'Refund Analytics',
  turnover: 'Inventory / Turnover',
  fulfilment: 'Fulfilment Analytics',
  anomalies: 'Anomaly Detection',
  goals: 'Goal Tracker',
  narrative: 'AI Narrative Reports',
  shares: 'Rapoarte partajate',
  profitability: 'Profitability',
  margin: 'Profit Margin',
  scale: 'Scale Analysis',
  repeat: 'Repeat Purchase',
  stockout: 'Stockout Detection',
  'data-health': 'Data Health',
  audit: 'BI Audit',
  annotations: 'Annotations',
  digest: 'Email Digest',
  actions: 'Action Items',
};

const PLAN_TAGLINES: Record<string, string> = {
  FREE:    'Pentru când vrei să vezi cu ochii tăi.',
  STARTER: 'Pentru când ai trecut de prima sută de comenzi.',
  GROWTH:  'Pentru când profitul devine mai important decât cifra.',
  SCALE:   'Pentru când platforma trebuie să se mulează pe operațiunea ta.',
};

const PLAN_EXTRAS: Record<string, string[]> = {
  FREE: ['1 magazin', 'Ask AI — 3 mesaje / lună', 'Sync incremental la 30min'],
  STARTER: ['1 magazin', 'Ask AI — 50 mesaje / lună', 'Stock alerts', 'Suport email'],
  GROWTH: ['3 magazine', 'Ask AI nelimitat', '3 membri echipă', 'Toate cele 29 module', 'Suport prioritar email + chat'],
  SCALE: ['Magazine nelimitate', 'Echipă nelimitată', 'Funcții custom dezvoltate pentru tine', 'Integrări custom (ERP · WMS · API)', 'Onboarding dedicat + manager de cont', 'SLA 99.9% uptime', 'Suport telefon prioritar'],
};

const PLAN_ORDER = ['FREE', 'STARTER', 'GROWTH', 'SCALE'];

const numberFont = { fontFeatureSettings: '"tnum" 1, "lnum" 1' } as React.CSSProperties;

function getDisplayPrice(plan: string, period: 'monthly' | 'yearly', currency: Currency): { primary: string; secondary: string | null } {
  const amounts = PLAN_AMOUNTS[currency][plan];
  if (!amounts) return { primary: '0', secondary: null };
  if (period === 'monthly') {
    return { primary: fmtPrice(amounts.monthly, currency), secondary: '/ lună' };
  }
  // yearly: show effective monthly + total annual
  const effMonthly = Math.round(amounts.yearly / 12);
  return { primary: fmtPrice(effMonthly, currency), secondary: `/ lună · facturat ${fmtPrice(amounts.yearly, currency)}/an` };
}

export default function AbonamentPage() {
  const { currentPlan, hasStripeCustomer, canBilling, stripeConfigured } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const upgradeModule = searchParams.get('upgrade');
  const success = searchParams.get('success');
  const canceled = searchParams.get('canceled');

  const [period, setPeriod] = useState<'monthly' | 'yearly'>('yearly');
  const [currency, setCurrency] = useState<Currency>('EUR');
  const [trialCode, setTrialCode] = useState('');

  const isPaid = currentPlan !== 'FREE' && hasStripeCustomer;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Abonament</h1>
          <p className="page-subtitle">
            {upgradeModule
              ? <>Modulul <strong>{MODULE_LABELS[upgradeModule] || upgradeModule}</strong> necesită un plan superior.</>
              : 'Planul tău, cele 4 opțiuni disponibile și ce este inclus în fiecare.'}
          </p>
        </div>
        {canBilling && isPaid && (
          <div className="page-actions">
            <Form method="post">
              <input type="hidden" name="intent" value="manage" />
              <button type="submit" className="btn btn-secondary" disabled={navigation.state === 'submitting'}>
                Gestionează abonamentul →
              </button>
            </Form>
          </div>
        )}
      </div>

      {success && (
        <div className="alert alert-success" style={{ marginBottom: 16 }}>
          ✓ Plata a fost procesată. Planul se actualizează în câteva secunde după confirmare Stripe.
        </div>
      )}
      {canceled && (
        <div className="alert" style={{ marginBottom: 16, background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', padding: '10px 14px', borderRadius: 8 }}>
          Checkout-ul a fost anulat. Planul tău rămâne neschimbat.
        </div>
      )}
      {!stripeConfigured && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>
          Stripe nu este configurat încă pe acest server. Contactează administratorul.
        </div>
      )}
      {!canBilling && (
        <div className="alert" style={{ marginBottom: 16, background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', padding: '10px 14px', borderRadius: 8 }}>
          Doar Owner-ul echipei poate modifica abonamentul sau achita.
        </div>
      )}

      {/* Currency + Period + Business toggles */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, marginBottom: 22 }}>
        {/* Currency selector */}
        <div style={{ display: 'inline-flex', background: 'var(--bg-tertiary)', borderRadius: 99, padding: 4, gap: 4 }}>
          {SUPPORTED_CURRENCIES.map((c) => (
            <button
              key={c}
              onClick={() => setCurrency(c)}
              style={{
                padding: '7px 16px', borderRadius: 99, border: 'none', cursor: 'pointer',
                background: currency === c ? 'white' : 'transparent',
                color: currency === c ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontSize: 12, fontWeight: 600, letterSpacing: '0.3px',
                boxShadow: currency === c ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                transition: 'all 0.15s',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <span style={{ opacity: 0.6 }}>{CURRENCY_SYMBOL[c].prefix || CURRENCY_SYMBOL[c].suffix?.trim() || ''}</span>
              {c}
            </button>
          ))}
        </div>

        {/* Period toggle */}
        <div style={{ display: 'inline-flex', background: 'var(--bg-tertiary)', borderRadius: 99, padding: 4, gap: 4 }}>
          <button
            onClick={() => setPeriod('monthly')}
            style={{
              padding: '8px 18px', borderRadius: 99, border: 'none', cursor: 'pointer',
              background: period === 'monthly' ? 'white' : 'transparent',
              color: period === 'monthly' ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontSize: 13, fontWeight: 600,
              boxShadow: period === 'monthly' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              transition: 'all 0.15s',
            }}
          >
            Lunar
          </button>
          <button
            onClick={() => setPeriod('yearly')}
            style={{
              padding: '8px 18px', borderRadius: 99, border: 'none', cursor: 'pointer',
              background: period === 'yearly' ? 'white' : 'transparent',
              color: period === 'yearly' ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontSize: 13, fontWeight: 600,
              boxShadow: period === 'yearly' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              transition: 'all 0.15s',
              display: 'flex', alignItems: 'center', gap: 8,
            }}
          >
            Anual
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99, background: '#16a34a', color: 'white', letterSpacing: '0.3px' }}>
              -2 LUNI
            </span>
          </button>
        </div>

        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center', maxWidth: 480, lineHeight: 1.55 }}>
          Persoană fizică sau companie? Câmpul pentru CIF/VAT apare în Checkout-ul Stripe — completezi acolo dacă facturezi pe firmă.
        </div>
      </div>

      <div className="kbi-carousel-hint">← Glisează pentru a vedea toate planurile →</div>
      <div className="kbi-pricing-grid" style={{ marginBottom: 28 }}>
        {PLAN_ORDER.map((key) => {
          const p = PLAN_LIMITS[key];
          const modules = PLAN_MODULES[key] || [];
          const extras = PLAN_EXTRAS[key] || [];
          const tagline = PLAN_TAGLINES[key];
          const isCurrent = currentPlan === key;
          const isPopular = key === 'GROWTH';
          const isScale = key === 'SCALE';
          const isFree = key === 'FREE';
          const currentIdx = PLAN_ORDER.indexOf(currentPlan);
          const planIdx = PLAN_ORDER.indexOf(key);
          const isUpgrade = planIdx > currentIdx;
          const showTrialInput = key === 'GROWTH' && isUpgrade && canBilling;

          // Display price
          let priceDisplay: { primary: string; secondary: string | null };
          if (isFree) priceDisplay = { primary: fmtPrice(0, currency), secondary: 'pentru totdeauna' };
          else if (isScale) priceDisplay = { primary: 'Custom', secondary: 'ofertă personalizată' };
          else priceDisplay = getDisplayPrice(key, period, currency);

          return (
            <div key={key} style={{
              background: 'white',
              border: isCurrent ? `2px solid ${p.color}` : (isPopular ? '2px solid var(--kimono-orange)' : '0.5px solid var(--border-default)'),
              borderRadius: 14,
              padding: '26px 22px',
              position: 'relative' as const,
              boxShadow: isCurrent ? `0 8px 28px ${p.color}22` : (isPopular ? '0 12px 36px rgba(216,90,48,0.12)' : undefined),
            }}>
              {isCurrent && (
                <div style={{ position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%)', background: p.color, color: 'white', fontSize: 10, fontWeight: 700, padding: '4px 12px', borderRadius: 99, whiteSpace: 'nowrap' as const, letterSpacing: '0.8px', textTransform: 'uppercase' as const }}>
                  Plan curent
                </div>
              )}
              {!isCurrent && isPopular && (
                <div style={{ position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%)', background: 'var(--kimono-orange)', color: 'white', fontSize: 10, fontWeight: 700, padding: '4px 12px', borderRadius: 99, whiteSpace: 'nowrap' as const, letterSpacing: '0.8px', textTransform: 'uppercase' as const }}>
                  Cel mai ales
                </div>
              )}

              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: p.color, marginBottom: 12, textTransform: 'uppercase' as const, letterSpacing: '1.2px' }}>{p.label}</div>

                <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.35, letterSpacing: '-0.2px', marginBottom: 16, minHeight: 36 }}>
                  {tagline}
                </div>

                <div style={{ ...numberFont }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' as const }}>
                    <span style={{ fontSize: priceDisplay.primary === 'Custom' ? 32 : 40, fontWeight: 400, color: 'var(--text-primary)', letterSpacing: '-1.5px', lineHeight: 1 }}>
                      {priceDisplay.primary}
                    </span>
                    {priceDisplay.secondary && (
                      <span style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>{priceDisplay.secondary}</span>
                    )}
                  </div>
                </div>
              </div>

              {/* CTA */}
              {isCurrent ? (
                <div style={{
                  display: 'block', textAlign: 'center', padding: '11px 0', borderRadius: 8, fontSize: 13, fontWeight: 600,
                  marginBottom: 22, background: p.color + '15', color: p.color, border: `1px solid ${p.color}30`,
                }}>
                  ✓ Plan curent
                </div>
              ) : isScale ? (
                <a href="mailto:office@kimonogroup.ro?subject=Ofertă%20Scale%20Kimono%20BI" style={{
                  display: 'block', textAlign: 'center', padding: '11px 0', borderRadius: 8, fontSize: 13, fontWeight: 600,
                  textDecoration: 'none', marginBottom: 22,
                  background: p.color, color: 'white', border: `1px solid ${p.color}`,
                }}>
                  Cere ofertă →
                </a>
              ) : isFree ? (
                <div style={{
                  display: 'block', textAlign: 'center', padding: '11px 0', borderRadius: 8, fontSize: 13, fontWeight: 500,
                  marginBottom: 22, background: 'transparent', color: 'var(--text-tertiary)', border: '0.5px dashed var(--border-default)',
                }}>
                  Plan gratuit
                </div>
              ) : isUpgrade && canBilling ? (
                <Form method="post" style={{ marginBottom: showTrialInput ? 12 : 22 }}>
                  <input type="hidden" name="plan" value={key} />
                  <input type="hidden" name="period" value={period} />
                  <input type="hidden" name="currency" value={currency} />
                  <input type="hidden" name="intent" value="checkout" />
                  {showTrialInput && (
                    <input type="hidden" name="trialCode" value={trialCode} />
                  )}
                  <button type="submit" style={{
                    width: '100%', padding: '11px 0', borderRadius: 8, fontSize: 13, fontWeight: 600, border: `1px solid ${isPopular ? 'var(--kimono-orange)' : 'var(--bg-dark)'}`, cursor: 'pointer',
                    background: isPopular ? 'var(--kimono-orange)' : 'var(--bg-dark)',
                    color: 'white',
                  }} disabled={navigation.state === 'submitting' || !stripeConfigured}>
                    {navigation.state === 'submitting' ? 'Se redirectează...' : `Upgrade la ${p.label} →`}
                  </button>
                </Form>
              ) : isUpgrade && !canBilling ? (
                <div style={{
                  display: 'block', textAlign: 'center', padding: '11px 0', borderRadius: 8, fontSize: 12, fontWeight: 500,
                  marginBottom: 22, background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '0.5px dashed var(--border-default)',
                }}>
                  Doar Owner poate face upgrade
                </div>
              ) : (
                <div style={{
                  display: 'block', textAlign: 'center', padding: '11px 0', borderRadius: 8, fontSize: 13, fontWeight: 500,
                  marginBottom: 22, background: 'transparent', color: 'var(--text-tertiary)', border: '0.5px dashed var(--border-default)',
                }}>
                  Plan inferior
                </div>
              )}

              {/* Trial code input — only on Growth upgrade */}
              {showTrialInput && (
                <div style={{ marginBottom: 18, padding: '10px 12px', background: 'rgba(216,90,48,0.05)', border: '0.5px solid rgba(216,90,48,0.2)', borderRadius: 8 }}>
                  <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--kimono-orange)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 6, display: 'block' }}>
                    Ai cod de invitație?
                  </label>
                  <input
                    type="text"
                    placeholder="ex: KIMONO14"
                    value={trialCode}
                    onChange={(e) => setTrialCode(e.target.value)}
                    className="form-input"
                    style={{ width: '100%', fontSize: 12, padding: '7px 10px', textTransform: 'uppercase' as const }}
                  />
                  <div style={{ fontSize: 10.5, color: 'var(--text-secondary)', marginTop: 5, lineHeight: 1.4 }}>
                    Cu cod valid primești <strong style={{ color: 'var(--kimono-orange)' }}>14 zile gratuit pe Growth</strong>. Cardul nu se debitează în trial; după 14 zile se trece automat la facturare.
                  </div>
                </div>
              )}

              {/* Extras */}
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' as const, letterSpacing: '1.2px', marginBottom: 12 }}>Include</div>
              <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 10, marginBottom: 18 }}>
                {extras.map((e) => (
                  <div key={e} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <span style={{ display: 'inline-block', width: 10, height: 1, background: p.color, flexShrink: 0, marginTop: 8 }} />
                    <span style={{ fontSize: 12.5, color: 'var(--text-primary)', lineHeight: 1.5 }}>{e}</span>
                  </div>
                ))}
              </div>

              {/* Module count badge */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 14, borderTop: '0.5px solid var(--border-default)' }}>
                <div style={{ width: 32, height: 32, borderRadius: 7, background: p.color + '15', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: p.color, ...numberFont }}>
                  {isScale ? '∞' : modules.length}
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  {isScale ? 'toate modulele + custom' : `${modules.length} module incluse`}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Module comparison table */}
      <div className="card" style={{ padding: 'clamp(16px, 3vw, 24px)', overflowX: 'auto' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 14 }}>Module incluse per plan</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 540 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-default)' }}>
              <th style={{ padding: '10px 12px', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textAlign: 'left', width: '36%' }}>Modul</th>
              <th style={{ padding: '10px 8px', fontSize: 11, fontWeight: 600, color: '#5F5E5A', textAlign: 'center' }}>Free</th>
              <th style={{ padding: '10px 8px', fontSize: 11, fontWeight: 600, color: '#0369a1', textAlign: 'center' }}>Starter</th>
              <th style={{ padding: '10px 8px', fontSize: 11, fontWeight: 600, color: '#D85A30', textAlign: 'center' }}>Growth</th>
              <th style={{ padding: '10px 8px', fontSize: 11, fontWeight: 600, color: '#7c3aed', textAlign: 'center' }}>Scale</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['Dashboard + Ask AI + GA4', true, true, true, true],
              ['Peak Hours', true, true, true, true],
              ['Smart Alerts (stoc)', false, true, true, true],
              ['RFM + Cohorts + LTV', false, true, true, true],
              ['Forecast + Period Compare', false, true, true, true],
              ['Churn + BCG + Cross-sell', false, false, true, true],
              ['Discounts + Refunds + Margin', false, false, true, true],
              ['Inventory + Fulfilment + Anomalies', false, false, true, true],
              ['Goals + AI Narrative + Shares', false, false, true, true],
              ['BI Audit + Data Health + Annotations', false, false, true, true],
              ['Email Digest + Action Items', false, false, true, true],
              ['Funcții custom + Integrări custom', false, false, false, true],
              ['Multi-store nelimitat + Echipă nelimitată', false, false, false, true],
            ].map((row: any, ri: number) => (
              <tr key={ri} style={{ borderBottom: '0.5px solid var(--border-default)' }}>
                <td style={{ padding: '9px 12px', fontSize: 12.5, color: 'var(--text-primary)' }}>{row[0]}</td>
                {[1,2,3,4].map((i: number) => (
                  <td key={i} style={{ padding: '9px 8px', textAlign: 'center', fontSize: 14, color: row[i] ? 'var(--success-text)' : 'var(--text-muted)' }}>
                    {row[i] ? '✓' : '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Info box */}
      <div style={{ marginTop: 24, padding: '20px 22px', background: 'var(--bg-page)', border: '0.5px solid var(--border-default)', borderRadius: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 10 }}>Despre upgrade-uri și facturare</div>
        <ul style={{ margin: 0, padding: '0 0 0 18px', fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          <li>Plată securizată prin Stripe — card-ul nu trece prin serverele noastre.</li>
          <li>Upgrade-ul intră imediat, cu calcul proporțional pentru zilele rămase din perioada curentă.</li>
          <li>Downgrade-ul intră la finalul perioadei de facturare curente.</li>
          <li>La plata anuală beneficiezi de 2 luni gratuite (echivalent ~17% reducere).</li>
          <li>TVA 21% se aplică pe toate planurile, peste prețul afișat.</li>
          <li>Pentru factură pe firmă, completează CIF/VAT direct în Stripe Checkout — sau scrie-ne la <a href="mailto:office@kimonogroup.ro" style={{ color: 'var(--kimono-orange-text)' }}>office@kimonogroup.ro</a>.</li>
        </ul>
      </div>
    </div>
  );
}
