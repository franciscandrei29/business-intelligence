import { db } from '~/lib/db.server';
import nodemailer from 'nodemailer';

interface DigestData {
  storeName: string;
  period: string;
  revenue: number;
  orders: number;
  customers: number;
  aov: number;
  revenueDelta: number; // % change vs previous period
  ordersDelta: number;
  topProducts: Array<{ title: string; revenue: number; units: number }>;
  stockAlerts: Array<{ title: string; daysRemaining: number; severity: string }>;
  anomalies: Array<{ message: string; severity: string }>;
  churnAtRisk: number;
}

export async function generateDigestData(storeConnectionId: string, periodDays = 7): Promise<DigestData> {
  const store = await db.storeConnection.findUnique({
    where: { id: storeConnectionId },
    select: { name: true },
  });

  const now = new Date();
  const periodStart = new Date(now);
  periodStart.setDate(periodStart.getDate() - periodDays);
  const prevStart = new Date(periodStart);
  prevStart.setDate(prevStart.getDate() - periodDays);

  // Current period
  const currentOrders = await db.order.findMany({
    where: { storeConnectionId, placedAt: { gte: periodStart, lte: now } },
    select: { total: true, lineItems: true },
  });

  const revenue = currentOrders.reduce((s, o) => s + Number(o.total), 0);
  const orders = currentOrders.length;
  const aov = orders > 0 ? revenue / orders : 0;

  // Previous period for comparison
  const prevOrders = await db.order.findMany({
    where: { storeConnectionId, placedAt: { gte: prevStart, lt: periodStart } },
    select: { total: true },
  });
  const prevRevenue = prevOrders.reduce((s, o) => s + Number(o.total), 0);
  const prevOrderCount = prevOrders.length;

  const revenueDelta = prevRevenue > 0 ? ((revenue - prevRevenue) / prevRevenue) * 100 : 0;
  const ordersDelta = prevOrderCount > 0 ? ((orders - prevOrderCount) / prevOrderCount) * 100 : 0;

  // New customers this period
  const newCustomers = await db.customer.count({
    where: { storeConnectionId, firstOrderAt: { gte: periodStart } },
  });

  // Top products from line items
  const productSales: Record<string, { title: string; revenue: number; units: number }> = {};
  for (const order of currentOrders) {
    if (!order.lineItems) continue;
    try {
      const items = JSON.parse(order.lineItems);
      for (const item of items) {
        const key = item.title || item.productId || 'unknown';
        if (!productSales[key]) productSales[key] = { title: item.title || key, revenue: 0, units: 0 };
        productSales[key].revenue += (item.price || 0) * (item.quantity || 0);
        productSales[key].units += item.quantity || 0;
      }
    } catch {}
  }
  const topProducts = Object.values(productSales)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  // Stock alerts
  const stockAlerts = await db.stockAlert.findMany({
    where: { storeConnectionId },
    orderBy: { daysRemaining: 'asc' },
    take: 5,
    select: { productTitle: true, daysRemaining: true, severity: true },
  });

  // Churn at risk count
  const atRiskCustomers = await db.customer.count({
    where: {
      storeConnectionId,
      ordersCount: { gte: 1 },
      lastOrderAt: { lt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) },
    },
  });

  return {
    storeName: store?.name || 'Magazin',
    period: periodDays === 1 ? 'zilnic' : periodDays === 7 ? 'saptamanal' : 'lunar',
    revenue: Math.round(revenue * 100) / 100,
    orders,
    customers: newCustomers,
    aov: Math.round(aov * 100) / 100,
    revenueDelta: Math.round(revenueDelta * 10) / 10,
    ordersDelta: Math.round(ordersDelta * 10) / 10,
    topProducts,
    stockAlerts: stockAlerts.map((a) => ({ title: a.productTitle, daysRemaining: a.daysRemaining, severity: a.severity })),
    anomalies: [],
    churnAtRisk: atRiskCustomers,
  };
}

export function buildDigestHtml(data: DigestData): string {
  const deltaColor = (d: number) => d >= 0 ? '#2ecc71' : '#e74c3c';
  const deltaSign = (d: number) => d >= 0 ? '+' : '';

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="font-family: -apple-system, sans-serif; background: #0f0f23; color: #eaeaea; padding: 20px;">
  <div style="max-width: 600px; margin: 0 auto;">
    <div style="text-align: center; padding: 20px 0; border-bottom: 1px solid #2a2a4a;">
      <h1 style="color: #fff; margin: 0;">Kimono <span style="color: #e94560;">BI</span></h1>
      <p style="color: #8888aa; margin: 4px 0 0;">Raport ${data.period} — ${data.storeName}</p>
    </div>

    <div style="display: flex; gap: 12px; margin: 20px 0; flex-wrap: wrap;">
      <div style="flex: 1; min-width: 120px; background: #1a1a2e; border-radius: 8px; padding: 16px; text-align: center;">
        <div style="color: #8888aa; font-size: 12px;">Venit</div>
        <div style="font-size: 22px; font-weight: 700; color: #fff;">${data.revenue.toLocaleString('ro-RO')} RON</div>
        <div style="font-size: 11px; color: ${deltaColor(data.revenueDelta)};">${deltaSign(data.revenueDelta)}${data.revenueDelta}%</div>
      </div>
      <div style="flex: 1; min-width: 120px; background: #1a1a2e; border-radius: 8px; padding: 16px; text-align: center;">
        <div style="color: #8888aa; font-size: 12px;">Comenzi</div>
        <div style="font-size: 22px; font-weight: 700; color: #fff;">${data.orders}</div>
        <div style="font-size: 11px; color: ${deltaColor(data.ordersDelta)};">${deltaSign(data.ordersDelta)}${data.ordersDelta}%</div>
      </div>
      <div style="flex: 1; min-width: 120px; background: #1a1a2e; border-radius: 8px; padding: 16px; text-align: center;">
        <div style="color: #8888aa; font-size: 12px;">Clienti noi</div>
        <div style="font-size: 22px; font-weight: 700; color: #fff;">${data.customers}</div>
      </div>
      <div style="flex: 1; min-width: 120px; background: #1a1a2e; border-radius: 8px; padding: 16px; text-align: center;">
        <div style="color: #8888aa; font-size: 12px;">AOV</div>
        <div style="font-size: 22px; font-weight: 700; color: #fff;">${data.aov.toLocaleString('ro-RO')} RON</div>
      </div>
    </div>

    ${data.topProducts.length > 0 ? `
    <div style="background: #1a1a2e; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
      <h3 style="color: #fff; font-size: 14px; margin: 0 0 12px;">Top produse</h3>
      ${data.topProducts.map((p, i) => `
        <div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #2a2a4a; font-size: 13px;">
          <span>${i + 1}. ${p.title}</span>
          <span style="color: #2ecc71; font-weight: 600;">${Math.round(p.revenue).toLocaleString('ro-RO')} RON (${p.units} buc)</span>
        </div>
      `).join('')}
    </div>` : ''}

    ${data.stockAlerts.length > 0 ? `
    <div style="background: #1a1a2e; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
      <h3 style="color: #fff; font-size: 14px; margin: 0 0 12px;">Alerte stoc</h3>
      ${data.stockAlerts.map((a) => `
        <div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #2a2a4a; font-size: 13px;">
          <span>${a.title}</span>
          <span style="color: ${a.severity === 'critical' ? '#e74c3c' : '#f39c12'}; font-weight: 600;">${a.daysRemaining} zile ramase</span>
        </div>
      `).join('')}
    </div>` : ''}

    ${data.churnAtRisk > 0 ? `
    <div style="background: rgba(231, 76, 60, 0.1); border: 1px solid rgba(231, 76, 60, 0.3); border-radius: 8px; padding: 16px; margin-bottom: 16px;">
      <p style="margin: 0; font-size: 13px; color: #e74c3c;">
        <strong>${data.churnAtRisk} clienti</strong> cu risc de churn (inactivi 60+ zile).
        <a href="${process.env.APP_URL || 'https://bi.kimonogroup.ro'}/churn" style="color: #e94560;">Vezi detalii →</a>
      </p>
    </div>` : ''}

    <div style="text-align: center; padding: 20px 0; border-top: 1px solid #2a2a4a;">
      <a href="${process.env.APP_URL || 'https://bi.kimonogroup.ro'}/dashboard"
         style="display: inline-block; padding: 10px 24px; background: #e94560; color: white; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px;">
        Deschide Dashboard
      </a>
      <p style="color: #8888aa; font-size: 11px; margin-top: 12px;">
        Kimono BI — Business Intelligence Platform
      </p>
    </div>
  </div>
</body>
</html>`;
}

export async function sendDigest(userId: string, storeConnectionId: string, periodDays = 7) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user) return;

  const data = await generateDigestData(storeConnectionId, periodDays);
  const html = buildDigestHtml(data);

  const port = Number(process.env.SMTP_PORT) || 25;
  const smtpUser = process.env.SMTP_USER || '';
  const smtpPass = process.env.SMTP_PASS || '';

  const config: any = {
    host: process.env.SMTP_HOST || '127.0.0.1',
    port,
    secure: port === 465,
  };
  if (smtpUser && smtpPass) config.auth = { user: smtpUser, pass: smtpPass };
  if (port === 25) config.tls = { rejectUnauthorized: false };

  const transporter = nodemailer.createTransport(config);

  const periodLabel = periodDays === 1 ? 'zilnic' : periodDays === 7 ? 'saptamanal' : 'lunar';

  await transporter.sendMail({
    from: process.env.SMTP_FROM || 'Kimono BI <noreply@kimonogroup.ro>',
    to: user.email,
    subject: `Raport ${periodLabel} — ${data.storeName} | Kimono BI`,
    html,
  });
}
