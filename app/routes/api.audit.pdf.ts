import type { LoaderFunctionArgs } from '@remix-run/node';
import { requireUser, requireUserContext } from '~/lib/auth/requireAuth.server';
import { requireModule } from '~/lib/plans.server';
import { db } from '~/lib/db.server';
import { computeAuditMetrics, type AuditMetrics } from '~/lib/audit/metrics.server';
import { buildAuditPdf, type AuditCommentary } from '~/lib/pdf/audit-pdf.server';

async function generateCommentary(metrics: AuditMetrics): Promise<AuditCommentary> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      executiveSummary: 'OPENAI_API_KEY neconfigurat — raportul este generat doar pe baza metricilor calculate.',
      domainNotes: {},
      recommendations: [],
    };
  }

  const DOMAIN_TITLES: Record<string, string> = {
    revenue: 'Venit si Crestere',
    catalog: 'Produse si Catalog',
    customers: 'Clienti si Retentie',
    inventory: 'Stocuri si Supply Chain',
    traffic: 'Trafic si Conversie',
    profitability: 'Profitabilitate',
    operations: 'Operatiuni',
    automation: 'AI si Automatizare',
  };

  const domainsContext = (Object.entries(metrics.domains) as Array<[string, any]>)
    .map(([key, d]) => {
      const metricsLine = d.metrics.map((m: any) => `    - ${m.label}: ${m.value}${m.hint ? ` (${m.hint})` : ''}`).join('\n');
      return `  ${DOMAIN_TITLES[key]} [scor ${d.score}/100 · ${d.status}]:\n${metricsLine}`;
    })
    .join('\n\n');

  const prompt = `Esti consultant senior BI pentru ecommerce romanesc.
Magazin: "${metrics.store.name}" (${metrics.store.platform}). Scor general: ${metrics.overall.score}/100 (${metrics.overall.grade}).

METRICI PE DOMENII:
${domainsContext}

Genereaza JSON strict:
{
  "executiveSummary": "3-4 fraze pentru conducere",
  "domainNotes": { "revenue": "...", "catalog": "...", "customers": "...", "inventory": "...", "traffic": "...", "profitability": "...", "operations": "...", "automation": "..." },
  "recommendations": ["...", "...", "..."]
}

Romaneste. Cifre exacte. Fara explicatii in afara JSON-ului.`;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL_CHAT || 'gpt-4o',
        messages: [
          { role: 'system', content: 'Expert BI. JSON valid in romana.' },
          { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.5,
        max_tokens: 3500,
      }),
    });
    if (!res.ok) throw new Error('openai ' + res.status);
    const data = await res.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}');
    return {
      executiveSummary: parsed.executiveSummary || '',
      domainNotes: parsed.domainNotes || {},
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations.slice(0, 8) : [],
    };
  } catch {
    return { executiveSummary: 'Analiza AI indisponibila momentan.', domainNotes: {}, recommendations: [] };
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const ctx = await requireUserContext(request);
  const user = ctx.user;
  await requireModule(request, ctx.effectiveOwnerId, 'audit');

  const url = new URL(request.url);
  const storeId = url.searchParams.get('store');
  if (!storeId) return new Response('Missing store', { status: 400 });

  const store = await db.storeConnection.findFirst({
    where: { id: storeId, userId: ctx.effectiveOwnerId },
    select: { id: true, name: true },
  });
  if (!store) return new Response('Store not found', { status: 404 });

  // Try to reuse latest audit from DB to avoid re-running GPT
  const lastAudit = await db.aiReport.findFirst({
    where: { storeConnectionId: storeId, type: 'AUDIT' },
    orderBy: { createdAt: 'desc' },
  });

  let metrics: AuditMetrics;
  let commentary: AuditCommentary;

  if (lastAudit?.content) {
    try {
      const parsed = JSON.parse(lastAudit.content);
      if (parsed.metrics && parsed.commentary) {
        metrics = parsed.metrics;
        // Revive Date fields on metrics (they become strings after JSON)
        metrics.generatedAt = new Date(metrics.generatedAt);
        commentary = parsed.commentary;
      } else {
        throw new Error('invalid cached');
      }
    } catch {
      metrics = await computeAuditMetrics(storeId);
      commentary = await generateCommentary(metrics);
    }
  } else {
    metrics = await computeAuditMetrics(storeId);
    commentary = await generateCommentary(metrics);
  }

  const pdf = await buildAuditPdf(metrics, commentary);
  const filename = `bi-audit-${store.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.pdf`;

  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(pdf.length),
      'Cache-Control': 'no-store',
    },
  });
}
