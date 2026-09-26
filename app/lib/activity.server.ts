import { db } from '~/lib/db.server';

export type ActivityType =
  | 'signup'
  | 'member_joined'
  | 'store_connected'
  | 'store_deleted'
  | 'plan_upgraded'
  | 'plan_downgraded'
  | 'subscription_canceled'
  | 'payment_succeeded'
  | 'payment_failed'
  | 'first_sync_completed'
  | 'admin_impersonate'
  | 'admin_change_plan'
  | 'admin_extend_trial'
  | 'admin_verify_email';

export const ADMIN_TYPES = new Set<ActivityType>([
  'admin_impersonate',
  'admin_change_plan',
  'admin_extend_trial',
  'admin_verify_email',
]);

interface LogActivityInput {
  type: ActivityType;
  description: string;
  actorUserId?: string | null;
  targetUserId?: string | null;
  storeId?: string | null;
  metadata?: Record<string, any>;
}

export async function logActivity(input: LogActivityInput): Promise<void> {
  try {
    await db.activityEvent.create({
      data: {
        type: input.type,
        description: input.description,
        actorUserId: input.actorUserId || null,
        targetUserId: input.targetUserId || null,
        storeId: input.storeId || null,
        metadata: (input.metadata as any) ?? undefined,
      },
    });
  } catch (err) {
    // Activity logging is best-effort — never break the request flow
    console.error('[activity] log failed:', (err as Error).message, 'event:', input.type);
  }
}
