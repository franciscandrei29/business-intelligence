import { db } from '~/lib/db.server';
import { decrypt } from '~/lib/auth/crypto.server';

const SAMEDAY_API = process.env.SAMEDAY_API_URL || 'https://api.sameday.ro';

async function getToken(username: string, password: string): Promise<string> {
  const res = await fetch(`${SAMEDAY_API}/api/authenticate?remember_me=1`, {
    method: 'POST',
    headers: { 'X-AUTH-USERNAME': username, 'X-AUTH-PASSWORD': password },
  });
  if (!res.ok) throw new Error(`Authentication failed: HTTP ${res.status}`);
  const data = await res.json();
  if (!data?.token) throw new Error('Authentication response missing token');
  return data.token;
}

export async function downloadLedgerCsv(invoiceNumber: string, username: string, password: string): Promise<string> {
  const token = await getToken(username, password);
  const url = `${SAMEDAY_API}/api/client/download-ledger-for-invoice/${encodeURIComponent(invoiceNumber)}/inline`;
  const res = await fetch(url, { headers: { 'X-AUTH-TOKEN': token } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Download failed: HTTP ${res.status} — ${text.slice(0, 200)}`);
  }
  const ct = res.headers.get('content-type') || '';
  if (!ct.toLowerCase().includes('csv')) {
    throw new Error(`Unexpected content-type "${ct}" (expected text/csv)`);
  }
  return res.text();
}

export interface ParsedLedgerItem {
  awb: string;
  totalFacturat: number;
  greutateTrimitere: number;
  serviciu: string;
  categorieExpeditie: string;
  referinta: string;
  pretFix: number;
  tarifCod: number;
  totalAlteTaxe: number;
  pretLivrareCrossborder: number;
  tarifLivrareLocker: number;
  discount: number;
  retur: boolean;
  numarFactura: string;
  dataFacturare: string;
  raw: Record<string, string>;
}

export interface ParsedLedger {
  headers: string[];
  items: ParsedLedgerItem[];
  invoiceDate: Date | null;
  invoiceNumber: string | null;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let curr = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        curr += '"';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) {
      cells.push(curr);
      curr = '';
    } else {
      curr += c;
    }
  }
  cells.push(curr);
  return cells;
}

function num(v: string | undefined): number {
  if (!v) return 0;
  const n = parseFloat(v.replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

export function parseLedgerCsv(csv: string): ParsedLedger {
  const cleaned = csv.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const lines = cleaned.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], items: [], invoiceDate: null, invoiceNumber: null };

  const headers = parseCsvLine(lines[0]);
  const items: ParsedLedgerItem[] = [];
  let firstDate: string | null = null;
  let firstInvoiceNr: string | null = null;

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    if (cells.length !== headers.length) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = cells[idx];
    });

    const awb = row['AWB'];
    if (!awb) continue;
    if (!firstDate && row['Data facturare']) firstDate = row['Data facturare'];
    if (!firstInvoiceNr && row['Numar factura']) firstInvoiceNr = row['Numar factura'];

    items.push({
      awb,
      totalFacturat: num(row['Total Facturat']),
      greutateTrimitere: num(row['Greutate trimitere']),
      serviciu: row['Serviciu'] || '',
      categorieExpeditie: row['Categorie expeditie'] || '',
      referinta: row['Referinta'] || '',
      pretFix: num(row['Pret fix']),
      tarifCod: num(row['Tarif COD']),
      totalAlteTaxe: num(row['Total alte taxe']),
      pretLivrareCrossborder: num(row['Pret livrare crossborder']),
      tarifLivrareLocker: num(row['Tarif livrare la locker']),
      discount: num(row['Discount']),
      retur: row['Retur'] === '1',
      numarFactura: row['Numar factura'] || '',
      dataFacturare: row['Data facturare'] || '',
      raw: row,
    });
  }

  return {
    headers,
    items,
    invoiceDate: firstDate ? new Date(firstDate) : null,
    invoiceNumber: firstInvoiceNr,
  };
}

async function getCredentials(storeConnectionId: string): Promise<{ username: string; password: string }> {
  const settings = await db.storeSettings.findUnique({
    where: { storeConnectionId },
    select: { courierUsername: true, courierPassword: true },
  });
  if (settings?.courierUsername && settings?.courierPassword) {
    return { username: decrypt(settings.courierUsername), password: decrypt(settings.courierPassword) };
  }
  const envUser = process.env.SAMEDAY_USERNAME;
  const envPass = process.env.SAMEDAY_PASSWORD;
  if (envUser && envPass) return { username: envUser, password: envPass };
  throw new Error('SameDay credentials not configured for this store and SAMEDAY_USERNAME/SAMEDAY_PASSWORD env not set');
}

export interface ImportResult {
  invoiceId: string;
  parsedCount: number;
  appliedCount: number;
  totalAmount: number;
  invoiceDate: Date | null;
}

export async function importInvoice(storeConnectionId: string, invoiceNumber: string): Promise<ImportResult> {
  const trimmed = invoiceNumber.trim();
  if (!/^[A-Za-z0-9_\-\/]{4,40}$/.test(trimmed)) {
    throw new Error('Invalid invoice number format');
  }

  const { username, password } = await getCredentials(storeConnectionId);

  const invoice = await db.samedayInvoice.upsert({
    where: { storeConnectionId_invoiceNumber: { storeConnectionId, invoiceNumber: trimmed } },
    create: { storeConnectionId, invoiceNumber: trimmed, status: 'PENDING' },
    update: { status: 'PENDING', errorMessage: null },
  });

  try {
    const csv = await downloadLedgerCsv(trimmed, username, password);
    await db.samedayInvoice.update({
      where: { id: invoice.id },
      data: { status: 'DOWNLOADED', downloadedAt: new Date(), rawCsvSize: csv.length },
    });

    const parsed = parseLedgerCsv(csv);
    if (parsed.items.length === 0) throw new Error('CSV-ul nu conține rânduri valide.');

    await db.samedayInvoiceItem.deleteMany({ where: { invoiceId: invoice.id } });

    const totalAmount = parsed.items.reduce((s, it) => s + it.totalFacturat, 0);

    for (let i = 0; i < parsed.items.length; i += 200) {
      const chunk = parsed.items.slice(i, i + 200);
      await db.samedayInvoiceItem.createMany({
        data: chunk.map((it) => ({
          invoiceId: invoice.id,
          awb: it.awb,
          totalFacturat: it.totalFacturat,
          greutateTrimitere: it.greutateTrimitere,
          serviciu: it.serviciu,
          categorieExpeditie: it.categorieExpeditie,
          referinta: it.referinta,
          pretFix: it.pretFix,
          tarifCod: it.tarifCod,
          totalAlteTaxe: it.totalAlteTaxe,
          pretLivrareCrossborder: it.pretLivrareCrossborder,
          tarifLivrareLocker: it.tarifLivrareLocker,
          discount: it.discount,
          retur: it.retur,
          rawRow: it.raw as object,
        })),
        skipDuplicates: true,
      });
    }

    await db.samedayInvoice.update({
      where: { id: invoice.id },
      data: {
        status: 'PARSED',
        awbCount: parsed.items.length,
        totalAmount,
        invoiceDate: parsed.invoiceDate,
      },
    });

    let appliedCount = 0;
    for (const it of parsed.items) {
      const r = await db.$executeRaw`
        UPDATE "CourierTracking"
        SET
          "estimatedCost" = COALESCE("estimatedCost", "servicePayment"),
          "servicePayment" = ${it.totalFacturat},
          "invoicedCost" = ${it.totalFacturat},
          "invoiceNumber" = ${trimmed},
          "invoiceAppliedAt" = NOW()
        WHERE "storeConnectionId" = ${storeConnectionId} AND "awb" = ${it.awb}
      `;
      if (r > 0) appliedCount += Number(r);
    }

    await db.samedayInvoice.update({
      where: { id: invoice.id },
      data: { status: 'APPLIED', appliedAt: new Date() },
    });

    return {
      invoiceId: invoice.id,
      parsedCount: parsed.items.length,
      appliedCount,
      totalAmount,
      invoiceDate: parsed.invoiceDate,
    };
  } catch (err: any) {
    await db.samedayInvoice.update({
      where: { id: invoice.id },
      data: { status: 'ERROR', errorMessage: String(err?.message || err).slice(0, 500) },
    });
    throw err;
  }
}
