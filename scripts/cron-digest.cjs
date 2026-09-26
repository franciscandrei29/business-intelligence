#!/usr/bin/env node
// Weekly Email Digest — runs Monday at 08:00
const { PrismaClient } = require('@prisma/client');
const nodemailer = require('nodemailer');
const db = new PrismaClient();

// ---------- Helpers ----------
function fmtRON(n) {
  return new Intl.NumberFormat('ro-RO', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.round(n));
}
function fmtPct(curr, prev) {
  if (!prev || prev === 0) return null;
  const pct = ((curr - prev) / Math.abs(prev)) * 100;
  return pct;
}
function deltaBlock(curr, prev) {
  const pct = fmtPct(curr, prev);
  if (pct === null) return { label: '—', color: '#888780' };
  const sign = pct > 0 ? '+' : '';
  const color = pct > 0 ? '#0F6E56' : pct < 0 ? '#A32D2D' : '#888780';
  return { label: `${sign}${pct.toFixed(1)}%`, color };
}
function escape(s) {
  if (s == null) return '';
  return String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
}
function periodLabel(start, end) {
  const opts = { day: 'numeric', month: 'short' };
  return `${start.toLocaleDateString('ro-RO', opts)} – ${end.toLocaleDateString('ro-RO', opts)}`;
}

// ---------- Build email HTML (table-based for Outlook compat) ----------
function buildEmail(store, data, appUrl) {
  const {
    revenue, prevRevenue, orders, prevOrders, aov, prevAov,
    newCustomers, prevNewCustomers, topProducts, stockoutCount, weekStart, weekEnd,
  } = data;

  const dRev = deltaBlock(revenue, prevRevenue);
  const dOrd = deltaBlock(orders, prevOrders);
  const dAov = deltaBlock(aov, prevAov);
  const dCust = deltaBlock(newCustomers, prevNewCustomers);

  const KPI = (label, value, unit, delta, deltaCtx) => `
    <td class="kbi-kpi-cell" style="padding:18px 16px;border:1px solid #EAEAEA;background:#FFFFFF;width:50%;vertical-align:top;">
      <div style="font-size:10px;font-weight:600;color:#888780;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">${label}</div>
      <div class="kbi-kpi-value" style="font-size:24px;font-weight:700;color:#0A0A0A;letter-spacing:-0.5px;line-height:1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
        ${value}<span style="font-size:13px;font-weight:500;color:#888780;margin-left:4px;">${unit || ''}</span>
      </div>
      <div style="margin-top:8px;font-size:11.5px;">
        <span style="color:${delta.color};font-weight:700;">${delta.label}</span>
        <span style="color:#888780;margin-left:6px;">${deltaCtx}</span>
      </div>
    </td>
  `;

  const topProductsRows = topProducts.length === 0
    ? `<tr><td colspan="3" style="padding:14px 16px;font-size:12.5px;color:#888780;font-style:italic;text-align:center;">Nu sunt vânzări în această săptămână.</td></tr>`
    : topProducts.map((p, i) => `
      <tr>
        <td style="padding:12px 16px;font-size:12px;color:#888780;font-weight:600;border-top:0.5px solid #EAEAEA;width:24px;">${String(i + 1).padStart(2, '0')}</td>
        <td style="padding:12px 8px;font-size:13px;color:#0A0A0A;border-top:0.5px solid #EAEAEA;font-weight:500;">${escape(p.title)}</td>
        <td style="padding:12px 16px;font-size:12.5px;color:#0A0A0A;border-top:0.5px solid #EAEAEA;text-align:right;font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap;">
          ${fmtRON(p.revenue)} RON
          <div style="font-size:10.5px;color:#888780;font-weight:400;margin-top:2px;">${p.units} ${p.units === 1 ? 'unitate' : 'unități'}</div>
        </td>
      </tr>
    `).join('');

  return `<!DOCTYPE html>
<html lang="ro">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="format-detection" content="telephone=no">
  <title>Raport săptămânal Kimono BI</title>
  <style>
    @media only screen and (max-width:520px) {
      .kbi-wrap { padding: 12px 8px !important; }
      .kbi-shell { width: 100% !important; max-width: 100% !important; }
      .kbi-pad { padding: 18px 18px !important; }
      .kbi-pad-h { padding: 18px 18px !important; }
      .kbi-pad-tb { padding: 0 18px 22px !important; }
      .kbi-h1 { font-size: 19px !important; line-height: 1.25 !important; }
      .kbi-period { display: block !important; margin-top: 8px !important; padding: 4px 9px !important; font-size: 9.5px !important; }
      .kbi-period-cell { display: block !important; width: 100% !important; text-align: left !important; }
      .kbi-period-cell-logo { display: block !important; width: 100% !important; margin-bottom: 4px !important; }
      .kbi-kpi-cell { display: block !important; width: 100% !important; box-sizing: border-box !important; border-right: 1px solid #EAEAEA !important; border-bottom: none !important; }
      .kbi-kpi-cell:last-child { border-bottom: 1px solid #EAEAEA !important; }
      .kbi-kpi-value { font-size: 22px !important; }
      .kbi-cta { display: block !important; width: 100% !important; box-sizing: border-box !important; padding: 14px 16px !important; }
      .kbi-quick-cell { display: block !important; width: 100% !important; box-sizing: border-box !important; border-right: none !important; border-bottom: 0.5px solid #EAEAEA !important; padding: 14px 8px !important; }
      .kbi-quick-cell:last-child { border-bottom: none !important; }
      .kbi-product-rev { font-size: 12px !important; }
      .kbi-section-label { font-size: 10px !important; }
    }
  </style>
</head>
<!--[if mso]>
<style type="text/css">
  body, table, td, a { font-family: Arial, Helvetica, sans-serif !important; }
</style>
<![endif]-->
<body style="margin:0;padding:0;background:#FAFAF9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0A0A0A;-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;">Raportul tău săptămânal Kimono BI: ${fmtRON(revenue)} RON, ${orders} comenzi, ${dRev.label} vs săptămâna trecută.</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAFAF9;">
    <tr><td align="center" class="kbi-wrap" style="padding:32px 16px;">

      <table role="presentation" width="600" cellpadding="0" cellspacing="0" class="kbi-shell" style="max-width:600px;width:100%;background:#FFFFFF;border:1px solid #EAEAEA;">

        <!-- Header dark -->
        <tr><td class="kbi-pad-h" style="background:#0A0A0A;padding:24px 28px;border-bottom:4px solid #D85A30;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td class="kbi-period-cell-logo" style="vertical-align:middle;">
                <div style="display:inline-block;vertical-align:middle;width:34px;height:34px;background:#D85A30;border-radius:8px;text-align:center;line-height:34px;color:#FFFFFF;font-size:16px;font-weight:800;letter-spacing:-0.5px;">K</div>
                <div style="display:inline-block;vertical-align:middle;margin-left:10px;">
                  <div style="color:#FFFFFF;font-size:18px;font-weight:700;letter-spacing:-0.4px;line-height:1.1;">Kimono <span style="color:#D85A30;">BI</span></div>
                  <div style="color:#888780;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;margin-top:2px;font-weight:500;">Raport săptămânal</div>
                </div>
              </td>
              <td class="kbi-period-cell" style="text-align:right;vertical-align:middle;">
                <div class="kbi-period" style="display:inline-block;padding:5px 11px;background:rgba(216,90,48,0.15);border:1px solid rgba(216,90,48,0.3);color:#FFB590;font-size:10px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;border-radius:4px;">${escape(periodLabel(weekStart, weekEnd))}</div>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Greeting + store -->
        <tr><td class="kbi-pad" style="padding:32px 28px 24px;">
          <div class="kbi-section-label" style="font-size:11px;color:#D85A30;text-transform:uppercase;letter-spacing:1.5px;font-weight:700;margin-bottom:10px;">${escape(store.name)}</div>
          <h1 class="kbi-h1" style="margin:0 0 10px;font-size:24px;font-weight:600;letter-spacing:-0.7px;color:#0A0A0A;line-height:1.2;">Săptămâna asta în magazinul tău</h1>
          <p style="margin:0;font-size:14px;color:#5F5E5A;line-height:1.6;">Cifrele cheie pentru perioada ${escape(periodLabel(weekStart, weekEnd))}, comparate cu săptămâna anterioară.</p>
        </td></tr>

        <!-- KPI grid 2x2 -->
        <tr><td class="kbi-pad-tb" style="padding:0 28px 28px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <tr>
              ${KPI('Venit', fmtRON(revenue), 'RON', dRev, 'vs. săpt. trecută')}
              ${KPI('Comenzi', String(orders), '', dOrd, 'vs. săpt. trecută')}
            </tr>
            <tr>
              ${KPI('Valoare medie comandă', fmtRON(aov), 'RON', dAov, 'vs. săpt. trecută')}
              ${KPI('Clienți noi', String(newCustomers), '', dCust, 'vs. săpt. trecută')}
            </tr>
          </table>
        </td></tr>

        <!-- Stockout warning (conditional) -->
        ${stockoutCount > 0 ? `<tr><td class="kbi-pad-tb" style="padding:0 28px 24px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#FCEBEB;border:1px solid #F5C4C4;border-left:4px solid #A32D2D;">
            <tr><td style="padding:14px 18px;">
              <div style="font-size:10px;font-weight:700;color:#A32D2D;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">⚠ Atenție</div>
              <div style="font-size:13.5px;color:#0A0A0A;font-weight:600;">${stockoutCount} ${stockoutCount === 1 ? 'produs are stoc critic' : 'produse au stoc critic'}</div>
              <div style="font-size:12px;color:#5F5E5A;margin-top:4px;line-height:1.5;">Verifică <a href="${appUrl}/stock" style="color:#A32D2D;font-weight:600;text-decoration:underline;">Stock alerts</a> și recomandările de comandă urgentă.</div>
            </td></tr>
          </table>
        </td></tr>` : ''}

        <!-- Top products -->
        <tr><td class="kbi-pad-tb" style="padding:8px 28px 28px;">
          <div class="kbi-section-label" style="font-size:11px;color:#D85A30;text-transform:uppercase;letter-spacing:1.5px;font-weight:700;margin-bottom:14px;">Top 3 produse după venit</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:0.5px solid #EAEAEA;border-collapse:collapse;">
            ${topProductsRows}
          </table>
        </td></tr>

        <!-- CTA -->
        <tr><td class="kbi-pad-tb" style="padding:8px 28px 32px;text-align:center;">
          <a href="${appUrl}/dashboard" class="kbi-cta" style="display:inline-block;padding:14px 36px;background:#D85A30;color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:700;letter-spacing:0.3px;border-radius:8px;border:1px solid #D85A30;box-sizing:border-box;">
            Deschide Dashboard →
          </a>
          <div style="margin-top:12px;font-size:11px;color:#888780;">Vezi cifrele live, raportul detaliat și AI Advisor cu top 3 acțiuni.</div>
        </td></tr>

        <!-- Quick links -->
        <tr><td class="kbi-pad-tb" style="padding:0 28px 32px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:0.5px solid #EAEAEA;padding-top:20px;">
            <tr>
              <td class="kbi-quick-cell" style="padding:14px 8px;text-align:center;border-right:0.5px solid #EAEAEA;width:25%;">
                <a href="${appUrl}/rfm" style="text-decoration:none;color:#0A0A0A;font-size:12px;font-weight:600;display:block;">RFM</a>
                <div style="font-size:10.5px;color:#888780;margin-top:2px;">Segmente clienți</div>
              </td>
              <td class="kbi-quick-cell" style="padding:14px 8px;text-align:center;border-right:0.5px solid #EAEAEA;width:25%;">
                <a href="${appUrl}/forecast" style="text-decoration:none;color:#0A0A0A;font-size:12px;font-weight:600;display:block;">Forecast</a>
                <div style="font-size:10.5px;color:#888780;margin-top:2px;">Predicție venit</div>
              </td>
              <td class="kbi-quick-cell" style="padding:14px 8px;text-align:center;border-right:0.5px solid #EAEAEA;width:25%;">
                <a href="${appUrl}/margin" style="text-decoration:none;color:#0A0A0A;font-size:12px;font-weight:600;display:block;">Margin</a>
                <div style="font-size:10.5px;color:#888780;margin-top:2px;">Profit pe comandă</div>
              </td>
              <td class="kbi-quick-cell" style="padding:14px 8px;text-align:center;width:25%;">
                <a href="${appUrl}/ask-ai" style="text-decoration:none;color:#D85A30;font-size:12px;font-weight:700;display:block;">Ask AI →</a>
                <div style="font-size:10.5px;color:#888780;margin-top:2px;">Întreabă orice</div>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#FAFAF9;padding:20px 28px;border-top:1px solid #EAEAEA;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="font-size:11px;color:#888780;line-height:1.6;">
                <strong style="color:#0A0A0A;">Kimono BI</strong> · Operat de GLOBAL DISTRIBUTION CENTER SRL · București<br>
                CUI 50169414 · J2024010966408 · Primești acest email pentru că ai un cont activ pe <a href="${appUrl}" style="color:#888780;text-decoration:underline;">bi.kimonogroup.ro</a>.<br>
                <a href="${appUrl}/settings" style="color:#888780;text-decoration:underline;">Gestionează preferințele</a> · <a href="${appUrl}/contact" style="color:#888780;text-decoration:underline;">Contact</a>
              </td>
            </tr>
          </table>
        </td></tr>

      </table>

      <div style="font-size:10.5px;color:#B4B2A9;margin-top:20px;letter-spacing:0.3px;">
        © ${new Date().getFullYear()} GLOBAL DISTRIBUTION CENTER SRL. Toate drepturile rezervate.
      </div>

    </td></tr>
  </table>
</body>
</html>`;
}

// ---------- Build text fallback ----------
function buildText(store, data, appUrl) {
  const dRev = deltaBlock(data.revenue, data.prevRevenue);
  return `KIMONO BI — Raport saptamanal pentru ${store.name}
Perioada: ${periodLabel(data.weekStart, data.weekEnd)}

VENIT: ${fmtRON(data.revenue)} RON (${dRev.label} vs sapt. trecuta)
COMENZI: ${data.orders}
VALOARE MEDIE COMANDA: ${fmtRON(data.aov)} RON
CLIENTI NOI: ${data.newCustomers}
${data.stockoutCount > 0 ? `\n⚠ ATENTIE: ${data.stockoutCount} produse au stoc critic.\n` : ''}
Top 3 produse:
${data.topProducts.map((p, i) => `  ${i + 1}. ${p.title} — ${fmtRON(p.revenue)} RON (${p.units} buc.)`).join('\n') || '  Nu sunt vanzari in aceasta saptamana.'}

Deschide dashboard: ${appUrl}/dashboard
Ask AI: ${appUrl}/ask-ai

—
Kimono BI (GLOBAL DISTRIBUTION CENTER SRL) · bi.kimonogroup.ro
`;
}

// ---------- Per-store metrics ----------
async function computeStoreMetrics(storeId) {
  const now = new Date();
  const weekEnd = new Date(now);
  const weekStart = new Date(now); weekStart.setDate(weekStart.getDate() - 7);
  const prevWeekEnd = new Date(weekStart);
  const prevWeekStart = new Date(weekStart); prevWeekStart.setDate(prevWeekStart.getDate() - 7);

  const [current, previous, currCustomers, prevCustomers, currOrdersForProducts, stockAlerts] = await Promise.all([
    db.order.aggregate({ where: { storeConnectionId: storeId, placedAt: { gte: weekStart, lt: weekEnd } }, _sum: { total: true }, _count: true }),
    db.order.aggregate({ where: { storeConnectionId: storeId, placedAt: { gte: prevWeekStart, lt: prevWeekEnd } }, _sum: { total: true }, _count: true }),
    db.customer.count({ where: { storeConnectionId: storeId, firstOrderAt: { gte: weekStart, lt: weekEnd } } }),
    db.customer.count({ where: { storeConnectionId: storeId, firstOrderAt: { gte: prevWeekStart, lt: prevWeekEnd } } }),
    db.order.findMany({
      where: { storeConnectionId: storeId, placedAt: { gte: weekStart, lt: weekEnd } },
      select: { lineItems: true },
    }),
    db.stockAlert.count({ where: { storeConnectionId: storeId, currentStock: { gt: 0 }, severity: { in: ['critical', 'high'] } } }).catch(() => 0),
  ]);

  const revenue = Number(current._sum.total || 0);
  const prevRevenue = Number(previous._sum.total || 0);
  const orders = current._count;
  const prevOrders = previous._count;
  const aov = orders > 0 ? revenue / orders : 0;
  const prevAov = prevOrders > 0 ? prevRevenue / prevOrders : 0;

  // Top products by revenue (parse lineItems JSON)
  const productSales = {};
  for (const o of currOrdersForProducts) {
    if (!o.lineItems) continue;
    let items;
    try { items = JSON.parse(o.lineItems); } catch { continue; }
    if (!Array.isArray(items)) continue;
    for (const it of items) {
      const title = String(it.title || it.name || 'Produs necunoscut').slice(0, 80);
      const qty = Number(it.quantity || it.qty || 1);
      const price = Number(it.price || it.total || 0);
      if (!productSales[title]) productSales[title] = { title, units: 0, revenue: 0 };
      productSales[title].units += qty;
      productSales[title].revenue += price * qty;
    }
  }
  const topProducts = Object.values(productSales).sort((a, b) => b.revenue - a.revenue).slice(0, 3);

  return {
    revenue, prevRevenue, orders, prevOrders, aov, prevAov,
    newCustomers: currCustomers, prevNewCustomers: prevCustomers,
    topProducts, stockoutCount: stockAlerts, weekStart, weekEnd,
  };
}

// ---------- Main ----------
async function main() {
  const users = await db.user.findMany({
    where: { emailVerified: true },
    include: { stores: { where: { isActive: true }, take: 1 } },
  });

  const port = Number(process.env.SMTP_PORT) || 25;
  const config = {
    host: process.env.SMTP_HOST || '127.0.0.1',
    port,
    secure: port === 465,
    tls: { rejectUnauthorized: false },
  };
  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    config.auth = { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS };
  }
  const transporter = nodemailer.createTransport(config);
  const appUrl = process.env.APP_URL || 'https://bi.kimonogroup.ro';

  for (const user of users) {
    if (user.stores.length === 0) continue;
    const store = user.stores[0];

    try {
      const data = await computeStoreMetrics(store.id);
      const html = buildEmail(store, data, appUrl);
      const text = buildText(store, data, appUrl);

      const dRev = deltaBlock(data.revenue, data.prevRevenue);
      const subject = `${store.name} — ${fmtRON(data.revenue)} RON săpt. asta (${dRev.label}) | Kimono BI`;

      await transporter.sendMail({
        from: process.env.SMTP_FROM || 'Kimono BI <noreply@kimonogroup.ro>',
        to: user.email,
        subject,
        text,
        html,
      });
      console.log('[digest] Sent to ' + user.email + ' for ' + store.name);
    } catch (err) {
      console.error('[digest] Error for ' + user.email + ':', err.message);
    }
  }
}

main().catch(console.error).finally(() => db.$disconnect());
