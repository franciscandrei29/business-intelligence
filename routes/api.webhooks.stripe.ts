import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { db } from '~/lib/db.server';

export async function action({ request }: ActionFunctionArgs) {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripeKey || !webhookSecret) {
    return json({ error: 'Stripe not configured' }, { status: 500 });
  }

  const stripe = (await import('stripe')).default;
  const stripeClient = new stripe(stripeKey);

  const body = await request.text();
  const sig = request.headers.get('stripe-signature') || '';

  let event;
  try {
    event = stripeClient.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err: any) {
    console.error('Stripe webhook signature verification failed:', err.message);
    return json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'customer.subscription.updated':
      case 'customer.subscription.created': {
        const subscription = event.data.object as any;
        const customerId = subscription.customer;
        const status = subscription.status;
        const priceId = subscription.items?.data?.[0]?.price?.id;

        // Map price ID to plan
        const planMap: Record<string, string> = {};
        if (process.env.STRIPE_PRICE_STARTER) planMap[process.env.STRIPE_PRICE_STARTER] = 'STARTER';
        if (process.env.STRIPE_PRICE_GROWTH) planMap[process.env.STRIPE_PRICE_GROWTH] = 'GROWTH';
        if (process.env.STRIPE_PRICE_SCALE) planMap[process.env.STRIPE_PRICE_SCALE] = 'SCALE';

        const plan = priceId ? planMap[priceId] || 'FREE' : 'FREE';

        const sub = await db.subscription.findFirst({
          where: { stripeCustomerId: customerId },
        });

        if (sub) {
          const subStatus = status === 'active' || status === 'trialing' ? 'ACTIVE'
            : status === 'past_due' ? 'PAST_DUE'
            : 'CANCELED';

          await db.subscription.update({
            where: { id: sub.id },
            data: {
              plan: plan as any,
              status: subStatus as any,
              stripeSubscriptionId: subscription.id,
              currentPeriodEnd: new Date(subscription.current_period_end * 1000),
              trialEndsAt: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
            },
          });
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as any;
        const customerId = subscription.customer;

        const sub = await db.subscription.findFirst({
          where: { stripeCustomerId: customerId },
        });

        if (sub) {
          await db.subscription.update({
            where: { id: sub.id },
            data: { plan: 'FREE', status: 'CANCELED', stripeSubscriptionId: null },
          });
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as any;
        const customerId = invoice.customer;

        const sub = await db.subscription.findFirst({
          where: { stripeCustomerId: customerId },
        });

        if (sub) {
          await db.subscription.update({
            where: { id: sub.id },
            data: { status: 'PAST_DUE' },
          });
        }
        break;
      }
    }
  } catch (err) {
    console.error('Stripe webhook processing error:', err);
  }

  return json({ received: true });
}

export async function loader() {
  return json({ error: 'Method not allowed' }, { status: 405 });
}
