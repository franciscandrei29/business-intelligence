import type { LoaderFunctionArgs } from '@remix-run/node';
import { requireUser, requireUserContext } from '~/lib/auth/requireAuth.server';
import { db } from '~/lib/db.server';
import { computeNarrativeMetrics, type NarrativeMetrics } from '~/lib/narrative/metrics.server';
import { buildNarrativePdf, type NarrativeContent } from '~/lib/pdf/narrative-pdf.server';

async function generateContent(metrics: NarrativeMetrics): Promise<NarrativeContent> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      headline: 'Raport saptamanal',
      whatHappened: 'OPENAI_API_KEY lipseste. Raport doar cu metrici calculate.',
      whyItMatters: '',
      actions: [], risks: [], opportunities: [],
    };
  }

  const topList = metrics.topProducts.slice(0, 5).map((p) => `    - ${p.title}: ${p.units} buc, ${p.revenue} RON`).join('\n');
  const worstList = metrics.worstProducts.map((p) => `    - ${p.title}: pierdere ~${p.lostRevenue} RON/sapt`).join('\n');
  const prompt = `Analist BI ecommerce ro. Magazin: ${metrics.store.name}.
Venit saptamana: ${metrics.revenue.thisWeek} RON (${metrics.revenue.ordersThis} cmd), prev ${metrics.revenue.prevWeek} RON (${metrics.revenue.ordersPrev}), schimb: ${metrics.revenue.changePct}%.
AOV: ${metrics.revenue.aovThis} vs ${metrics.revenue.aovPrev}. Clienti noi: ${metrics.customers.newThis} (prev ${metrics.customers.newPrev}). Repeat: ${metrics.customers.repeatThis}/${metrics.customers.activeThis}. Champions: ${metrics.customers.champions} · At Risk+Lost: ${metrics.customers.atRisk}. Refund-uri: ${metrics.refunds.count} (${metrics.refunds.amount} RON, ${metrics.refunds.rate}%).
Top: ${topList || '(niciunul)'}.
Out of stock cu vanzari: ${worstList || '(niciunul)'}.

JSON strict: { "headline":"...", "whatHappened":"...", "whyItMatters":"...", "actions":[...], "risks":[...], "opportunities":[...] }. Romaneste.`;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL_CHAT || 'gpt-4o',
        messages: [
          { role: 'system', content: 'Analist BI senior romanesc. JSON valid.' },
          { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.6,
        max_tokens: 2000,
      }),
    });
    const data = await res.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}');
    return {
      headline: parsed.headline || 'Raport saptamanal',
      whatHappened: parsed.whatHappened || '',
      whyItMatters: parsed.whyItMatters || '',
      actions: Array.isArray(parsed.actions) ? parsed.actions : [],
      risks: Array.isArray(parsed.risks) ? parsed.risks : [],
      opportunities: Array.isArray(parsed.opportunities) ? parsed.opportunities : [],
    };
  } catch {
    return { headline: 'Raport saptamanal', whatHappened: '', whyItMatters: '', actions: [], risks: [], opportunities: [] };
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const ctx = await requireUserContext(request);
  const user = ctx.user;
  const url = new URL(request.url);
  const storeId = url.searchParams.get('store');
  if (!storeId) return new Response('Missing store', { status: 400 });

  const store = await db.storeConnection.findFirst({
    where: { id: storeId, userId: ctx.effectiveOwnerId },
    select: { id: true, name: true },
  });
  if (!store) return new Response('Store not found', { status: 404 });

  const lastNarrative = await db.aiReport.findFirst({
    where: { storeConnectionId: storeId, type: 'NARRATIVE' },
    orderBy: { createdAt: 'desc' },
  });

  let metrics: NarrativeMetrics;
  let content: NarrativeContent;

  if (lastNarrative?.content) {
    try {
      const parsed = JSON.parse(lastNarrative.content);
      if (parsed.metrics && parsed.content) {
        metrics = parsed.metrics;
        // Revive Date fields
        metrics.period.weekStart = new Date(metrics.period.weekStart);
        metrics.period.weekEnd = new Date(metrics.period.weekEnd);
        metrics.period.prevWeekStart = new Date(metrics.period.prevWeekStart);
        metrics.period.prevWeekEnd = new Date(metrics.period.prevWeekEnd);
        content = parsed.content;
      } else {
        throw new Error('invalid cached');
      }
    } catch {
      metrics = await computeNarrativeMetrics(storeId);
      content = await generateContent(metrics);
    }
  } else {
    metrics = await computeNarrativeMetrics(storeId);
    content = await generateContent(metrics);
  }

  const pdf = await buildNarrativePdf(metrics, content);
  const filename = `ai-insights-${store.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.pdf`;

  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(pdf.length),
      'Cache-Control': 'no-store',
    },
  });
}
