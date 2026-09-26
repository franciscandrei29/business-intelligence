import { json } from '@remix-run/node';
import { db } from '~/lib/db.server';
import { sendInvoicePaidEmail, sendSubscriptionExpiredEmail } from '~/lib/auth/email.server';

const APP_URL = process.env.APP_URL || 'https://bi.kimonogroup.ro';

const PLAN_LABELS: Record<string, string> = {
  STARTER: 'Starter',
  GROWTH: 'Growth',
  SCALE: 'Scale',
  FREE: 'Free',
};

function planLabel(plan: string, period?: string): string {
  const base = PLAN_LABELS[plan] || plan;
  if (!period) return base;
  return `${base} (${period === 'yearly' ? 'Anual' : 'Lunar'})`;
}

function pickPlanFromMetadata(metadata: any): string | null {
  if (!metadata) return null;
  const p = metadata.plan;
  if (p && ['STARTER', 'GROWTH', 'SCALE', 'FREE'].includes(p)) return p;
  return null;
}

function pickPeriodFromMetadata(metadata: any): string | null {
  if (!metadata) return null;
  return metadata.period === 'monthly' || metadata.period === 'yearly' ? metadata.period : null;
}

/**
 * Shared Stripe webhook handler.
 *
 * @param request the incoming Request
 * @param opts.webhookSecret expected signing secret to verify against (live or test)
 * @param opts.label log prefix used to disambiguate live vs test in stdout
 */
export async function handleStripeWebhook(
  request: Request,
  opts: { webhookSecret: string | undefined; label: string }
) {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const { webhookSecret, label } = opts;

  if (!stripeKey || !webhookSecret) {
    console.error(`[${label}] Stripe not configured (missing key or webhook secret)`);
    return json({ error: 'Stripe not configured' }, { status: 500 });
  }

  const Stripe = (await import('stripe')).default;
  const stripeClient = new Stripe(stripeKey);

  const body = await request.text();
  const sig = request.headers.get('stripe-signature') || '';

  let event;
  try {
    event = stripeClient.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err: any) {
    console.error(`[${label}] signature verification failed:`, err.message);
    return json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as any;
        const customerId = session.customer;
        const userId = session.metadata?.userId;

        if (customerId && userId) {
          await db.subscription.upsert({
            where: { userId },
            create: { userId, stripeCustomerId: customerId, plan: 'FREE', status: 'ACTIVE' },
            update: { stripeCustomerId: customerId },
          });
        }
        break;
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.created': {
        const subscription = event.data.object as any;
        const customerId = subscription.customer;
        const status = subscription.status;
        const plan = pickPlanFromMetadata(subscription.metadata) || 'FREE';

        const sub = await db.subscription.findFirst({ where: { stripeCustomerId: customerId } });
        if (!sub) {
          console.warn(`[${label}] no subscription record for customer ${customerId}`);
          break;
        }
        const previousPlan = sub.plan;

        const subStatus = status === 'active' || status === 'trialing' ? 'ACTIVE'
          : status === 'past_due' ? 'PAST_DUE'
          : status === 'canceled' || status === 'unpaid' || status === 'incomplete_expired' ? 'CANCELED'
          : 'ACTIVE';

        // Stripe API ≥ 2024-09 moved current_period_end onto each subscription item.
        const currentPeriodEndRaw =
          subscription.items?.data?.[0]?.current_period_end ?? subscription.current_period_end ?? null;

        await db.subscription.update({
          where: { id: sub.id },
          data: {
            plan: plan as any,
            status: subStatus as any,
            stripeSubscriptionId: subscription.id,
            currentPeriodEnd: currentPeriodEndRaw ? new Date(currentPeriodEndRaw * 1000) : null,
            trialEndsAt: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
          },
        });

        // Log plan transition (skip noise: only when plan actually changes)
        if (event.type === 'customer.subscription.created' || previousPlan !== plan) {
          try {
            const { logActivity } = await import('~/lib/activity.server');
            const planRank: Record<string, number> = { FREE: 0, STARTER: 1, GROWTH: 2, SCALE: 3 };
            const isUpgrade = (planRank[plan] ?? 0) > (planRank[previousPlan] ?? 0);
            await logActivity({
              type: isUpgrade ? 'plan_upgraded' : 'plan_downgraded',
              description: `Plan ${previousPlan} → ${plan} (${subscription.metadata?.period || 'unknown'})`,
              targetUserId: sub.userId,
              metadata: { from: previousPlan, to: plan, stripeSubscriptionId: subscription.id, status: subStatus },
            });
          } catch {}
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as any;
        const customerId = invoice.customer;

        const sub = await db.subscription.findFirst({
          where: { stripeCustomerId: customerId },
          include: { user: { select: { id: true, email: true, fullName: true } } },
        });

        if (!sub || !sub.user) {
          console.warn(`[${label}] no subscription/user for customer ${customerId}`);
          break;
        }

        if (!invoice.amount_paid || invoice.amount_paid === 0) {
          break;
        }

        try {
          const { logActivity } = await import('~/lib/activity.server');
          await logActivity({
            type: 'payment_succeeded',
            description: `Plată ${(invoice.amount_paid / 100).toFixed(2)} ${(invoice.currency || 'eur').toUpperCase()} pentru ${sub.user.email}`,
            targetUserId: sub.user.id,
            metadata: {
              invoiceNumber: invoice.number,
              amount: invoice.amount_paid,
              currency: invoice.currency,
              hostedUrl: invoice.hosted_invoice_url,
            },
          });
        } catch {}

        let plan = 'FREE';
        let period: string | null = null;
        if (invoice.subscription) {
          try {
            const subFromStripe = await stripeClient.subscriptions.retrieve(invoice.subscription as string);
            plan = pickPlanFromMetadata(subFromStripe.metadata) || sub.plan || 'FREE';
            period = pickPeriodFromMetadata(subFromStripe.metadata);
          } catch (err) {
            console.error(`[${label}] could not retrieve subscription for invoice:`, err);
          }
        }

        try {
          await sendInvoicePaidEmail({
            toEmail: sub.user.email,
            customerName: sub.user.fullName,
            invoiceNumber: invoice.number || invoice.id,
            invoiceUrl: invoice.hosted_invoice_url || `${APP_URL}/pricing-analysis`,
            invoicePdfUrl: invoice.invoice_pdf || undefined,
            amountTotal: invoice.amount_paid,
            currency: invoice.currency,
            planLabel: planLabel(plan, period || undefined),
            periodStart: invoice.period_start || null,
            periodEnd: invoice.period_end || null,
          });
        } catch (err) {
          console.error(`[${label}] sendInvoicePaidEmail failed:`, err);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as any;
        const customerId = subscription.customer;
        const plan = pickPlanFromMetadata(subscription.metadata) || 'GROWTH';

        const sub = await db.subscription.findFirst({
          where: { stripeCustomerId: customerId },
          include: { user: { select: { id: true, email: true, fullName: true } } },
        });
        if (!sub) break;

        await db.subscription.update({
          where: { id: sub.id },
          data: { plan: 'FREE', status: 'CANCELED', stripeSubscriptionId: null, trialEndsAt: null },
        });

        try {
          const { logActivity } = await import('~/lib/activity.server');
          await logActivity({
            type: 'subscription_canceled',
            description: `${sub.user?.email || 'Cont necunoscut'} a anulat abonamentul ${plan}`,
            targetUserId: sub.user?.id || null,
            metadata: { plan, endedAt: subscription.ended_at, canceledAt: subscription.canceled_at },
          });
        } catch {}

        let lastInvoiceUrl: string | null = null;
        let lastInvoicePdfUrl: string | null = null;
        try {
          const invList = await stripeClient.invoices.list({
            customer: customerId,
            status: 'paid',
            limit: 1,
          });
          const last = invList.data[0];
          if (last) {
            lastInvoiceUrl = last.hosted_invoice_url || null;
            lastInvoicePdfUrl = last.invoice_pdf || null;
          }
        } catch (err) {
          console.error(`[${label}] invoices.list failed:`, err);
        }

        if (sub.user?.email) {
          try {
            await sendSubscriptionExpiredEmail({
              toEmail: sub.user.email,
              customerName: sub.user.fullName,
              planLabel: planLabel(plan),
              endedAt: subscription.ended_at || subscription.canceled_at || null,
              lastInvoiceUrl,
              lastInvoicePdfUrl,
              resubscribeUrl: `${APP_URL}/pricing-analysis`,
            });
          } catch (err) {
            console.error(`[${label}] sendSubscriptionExpiredEmail failed:`, err);
          }
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as any;
        const customerId = invoice.customer;
        const sub = await db.subscription.findFirst({ where: { stripeCustomerId: customerId } });
        if (sub) {
          await db.subscription.update({ where: { id: sub.id }, data: { status: 'PAST_DUE' } });
          try {
            const { logActivity } = await import('~/lib/activity.server');
            await logActivity({
              type: 'payment_failed',
              description: `Plată eșuată pentru customer ${customerId} (${(invoice.amount_due / 100).toFixed(2)} ${(invoice.currency || 'eur').toUpperCase()})`,
              targetUserId: sub.userId,
              metadata: { amount: invoice.amount_due, currency: invoice.currency, attemptCount: invoice.attempt_count },
            });
          } catch {}
        }
        break;
      }
    }
  } catch (err) {
    console.error(`[${label}] processing error:`, err);
  }

  return json({ received: true });
}
