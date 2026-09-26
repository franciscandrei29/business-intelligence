import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const TEAMS_FILE = path.join(process.cwd(), 'data', 'teams.json');

export type Role = 'owner' | 'admin' | 'analyst' | 'viewer';

export interface TeamMember {
  id: string;
  ownerId: string;
  email: string;
  role: Role;
  invitedAt: string;
}

function readTeams(): TeamMember[] {
  try {
    const dir = path.dirname(TEAMS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(TEAMS_FILE)) return [];
    return JSON.parse(fs.readFileSync(TEAMS_FILE, 'utf8'));
  } catch { return []; }
}

function writeTeams(teams: TeamMember[]) {
  const dir = path.dirname(TEAMS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(TEAMS_FILE, JSON.stringify(teams, null, 2));
}

export function inviteUser(ownerId: string, email: string, role: Role): TeamMember {
  const teams = readTeams();
  const existing = teams.find(t => t.ownerId === ownerId && t.email === email);
  if (existing) throw new Error('Acest email este deja in echipa.');
  if (role === 'owner') throw new Error('Nu poti invita un alt owner.');

  const member: TeamMember = {
    id: crypto.randomBytes(12).toString('hex'),
    ownerId,
    email,
    role,
    invitedAt: new Date().toISOString(),
  };
  teams.push(member);
  writeTeams(teams);
  return member;
}

export function getTeamMembers(ownerId: string): TeamMember[] {
  return readTeams().filter(t => t.ownerId === ownerId);
}

export function removeTeamMember(ownerId: string, memberId: string): boolean {
  const teams = readTeams();
  const idx = teams.findIndex(t => t.ownerId === ownerId && t.id === memberId);
  if (idx === -1) return false;
  teams.splice(idx, 1);
  writeTeams(teams);
  return true;
}

export function getUserRole(userId: string, storeOwnerId: string): Role {
  if (userId === storeOwnerId) return 'owner';
  const teams = readTeams();
  const member = teams.find(t => t.ownerId === storeOwnerId && t.email === userId);
  return member?.role || 'viewer';
}
