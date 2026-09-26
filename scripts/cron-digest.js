#!/usr/bin/env node
// Weekly Email Digest — runs Monday at 08:00
const { PrismaClient } = require('@prisma/client');
const nodemailer = require('nodemailer');
const db = new PrismaClient();

async function main() {
  const users = await db.user.findMany({
    where: { emailVerified: true },
    include: { stores: { where: { isActive: true }, take: 1 } },
  });

  const port = Number(process.env.SMTP_PORT) || 25;
  const config = { host: process.env.SMTP_HOST || '127.0.0.1', port, secure: port === 465 };
  if (port === 25) config.tls = { rejectUnauthorized: false };
  const transporter = nodemailer.createTransport(config);

  for (const user of users) {
    if (user.stores.length === 0) continue;
    const store = user.stores[0];

    try {
      const now = new Date();
      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 7);
      const prevWeek = new Date(weekAgo);
      prevWeek.setDate(prevWeek.getDate() - 7);

      const [current, previous] = await Promise.all([
        db.order.aggregate({ where: { storeConnectionId: store.id, placedAt: { gte: weekAgo } }, _sum: { total: true }, _count: true }),
        db.order.aggregate({ where: { storeConnectionId: store.id, placedAt: { gte: prevWeek, lt: weekAgo } }, _sum: { total: true }, _count: true }),
      ]);

      const revenue = Number(current._sum.total || 0);
      const prevRevenue = Number(previous._sum.total || 0);
      const delta = prevRevenue > 0 ? ((revenue - prevRevenue) / prevRevenue * 100).toFixed(1) : '0';
      const appUrl = process.env.APP_URL || 'https://bi.kimonogroup.ro';

      const html = [
        '<div style="font-family:sans-serif;max-width:500px;margin:0 auto;background:#1a1a2e;color:#eaeaea;padding:24px;border-radius:8px;">',
        '<h2 style="color:#fff;">Kimono <span style="color:#e94560;">BI</span> — Raport saptamanal</h2>',
        '<p>Magazin: <strong>' + store.name + '</strong></p>',
        '<p>Venit saptamana aceasta: <strong>' + revenue.toFixed(2) + ' RON</strong> (' + delta + '% vs saptamana trecuta)</p>',
        '<p>Comenzi: <strong>' + current._count + '</strong></p>',
        '<a href="' + appUrl + '/dashboard" style="display:inline-block;padding:10px 20px;background:#e94560;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">Deschide Dashboard</a>',
        '</div>',
      ].join('\n');

      await transporter.sendMail({
        from: process.env.SMTP_FROM || 'Kimono BI <noreply@kimonogroup.ro>',
        to: user.email,
        subject: 'Raport saptamanal — ' + store.name + ' | Kimono BI',
        html: html,
      });
      console.log('[digest] Sent to ' + user.email + ' for ' + store.name);
    } catch (err) {
      console.error('[digest] Error for ' + user.email + ':', err.message);
    }
  }
}

main().catch(console.error).finally(() => db.$disconnect());
