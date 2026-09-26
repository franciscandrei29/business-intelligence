import crypto from 'crypto';
import { db } from '~/lib/db.server';

export type Role = 'owner' | 'admin' | 'analyst' | 'viewer';

export interface TeamMember {
  id: string;
  ownerId: string;
  email: string;
  role: Role;
  invitedAt: string;
  inviteToken?: string | null;
  acceptedAt?: string | null;
  userId?: string | null;
}

function toMember(row: any): TeamMember {
  return {
    id: row.id,
    ownerId: row.ownerId,
    email: row.email,
    role: row.role as Role,
    invitedAt: row.invitedAt instanceof Date ? row.invitedAt.toISOString() : String(row.invitedAt),
    inviteToken: row.inviteToken ?? null,
    acceptedAt: row.acceptedAt instanceof Date ? row.acceptedAt.toISOString() : (row.acceptedAt ?? null),
    userId: row.userId ?? null,
  };
}

export async function inviteUser(ownerId: string, email: string, role: Role): Promise<TeamMember> {
  if (role === 'owner') throw new Error('Nu poti invita un alt owner.');
  if (!['admin', 'analyst', 'viewer'].includes(role)) throw new Error('Rol invalid.');

  const owner = await db.user.findUnique({ where: { id: ownerId }, select: { email: true } });
  if (owner && owner.email.toLowerCase() === email.toLowerCase()) {
    throw new Error('Nu te poti invita pe tine in propria echipa.');
  }

  const existing = await db.teamMembership.findFirst({ where: { ownerId, email } });
  if (existing) throw new Error('Acest email este deja in echipa.');

  const token = crypto.randomBytes(24).toString('hex');
  const created = await db.teamMembership.create({
    data: { ownerId, email, role, inviteToken: token },
  });
  return toMember(created);
}

export async function getTeamMembers(ownerId: string): Promise<TeamMember[]> {
  const rows = await db.teamMembership.findMany({
    where: { ownerId },
    orderBy: { invitedAt: 'desc' },
  });
  return rows.map(toMember);
}

export async function removeTeamMember(ownerId: string, memberId: string): Promise<boolean> {
  const result = await db.teamMembership.deleteMany({
    where: { id: memberId, ownerId },
  });
  return result.count > 0;
}

export async function getInviteByToken(token: string): Promise<TeamMember | null> {
  if (!token) return null;
  const row = await db.teamMembership.findUnique({ where: { inviteToken: token } });
  return row ? toMember(row) : null;
}

export async function markInviteAccepted(token: string, userId: string): Promise<TeamMember | null> {
  const row = await db.teamMembership.findUnique({ where: { inviteToken: token } });
  if (!row) return null;
  const updated = await db.teamMembership.update({
    where: { id: row.id },
    data: {
      acceptedAt: new Date(),
      userId,
      inviteToken: null,
    },
  });
  return toMember(updated);
}

export async function getMembershipByUserId(userId: string): Promise<TeamMember | null> {
  const row = await db.teamMembership.findUnique({ where: { userId } });
  return row && row.acceptedAt ? toMember(row) : null;
}

export async function getEffectiveOwnerId(userId: string): Promise<string> {
  const membership = await getMembershipByUserId(userId);
  return membership ? membership.ownerId : userId;
}

export async function leaveTeam(userId: string): Promise<boolean> {
  const result = await db.teamMembership.deleteMany({ where: { userId } });
  return result.count > 0;
}

export async function getUserRole(userId: string): Promise<Role> {
  const membership = await getMembershipByUserId(userId);
  if (!membership) return 'owner';
  return membership.role;
}
