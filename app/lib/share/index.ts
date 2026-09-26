import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const SHARES_FILE = path.join(process.cwd(), 'data', 'shared-reports.json');

export type ReportType = 'dashboard' | 'rfm' | 'forecast' | 'audit';

export interface SharedReport {
  id: string;
  userId: string;
  shareId: string;
  reportType: ReportType;
  reportData: any;
  storeName: string;
  createdAt: string;
  expiresAt: string;
}

function readShares(): SharedReport[] {
  try {
    const dir = path.dirname(SHARES_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(SHARES_FILE)) return [];
    return JSON.parse(fs.readFileSync(SHARES_FILE, 'utf8'));
  } catch { return []; }
}

function writeShares(shares: SharedReport[]) {
  const dir = path.dirname(SHARES_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SHARES_FILE, JSON.stringify(shares, null, 2));
}

export function createShareLink(
  userId: string,
  reportType: ReportType,
  reportData: any,
  storeName: string,
  expiresInDays: number = 30
): SharedReport {
  const shares = readShares();
  const shareId = crypto.randomBytes(16).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000);

  const report: SharedReport = {
    id: crypto.randomBytes(12).toString('hex'),
    userId,
    shareId,
    reportType,
    reportData,
    storeName,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  shares.push(report);
  writeShares(shares);
  return report;
}

export function getSharedReport(shareId: string): SharedReport | null {
  const shares = readShares();
  const report = shares.find(s => s.shareId === shareId);
  if (!report) return null;
  if (new Date(report.expiresAt) < new Date()) return null;
  return report;
}

export function deleteShareLink(userId: string, shareId: string): boolean {
  const shares = readShares();
  const idx = shares.findIndex(s => s.userId === userId && s.id === shareId);
  if (idx === -1) return false;
  shares.splice(idx, 1);
  writeShares(shares);
  return true;
}

export function listShareLinks(userId: string): SharedReport[] {
  return readShares().filter(s => s.userId === userId);
}
