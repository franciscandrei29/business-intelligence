import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { handleStripeWebhook } from '~/lib/stripe/webhook-handler.server';

export async function action({ request }: ActionFunctionArgs) {
  return handleStripeWebhook(request, {
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET_TEST,
    label: 'stripe webhook test',
  });
}

export async function loader() {
  return json({ error: 'Method not allowed' }, { status: 405 });
}
