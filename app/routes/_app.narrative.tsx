import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { Form, useActionData, useLoaderData, useNavigation, useSearchParams } from '@remix-run/react';
import { requireUser, requireUserContext, requireMinRole } from '~/lib/auth/requireAuth.server';
import { requireModule } from '~/lib/plans.server';
import { db } from '~/lib/db.server';
import { computeNarrativeMetrics, type NarrativeMetrics } from '~/lib/narrative/metrics.server';
import type { NarrativeContent } from '~/lib/pdf/narrative-pdf.server';
import { Sparkles, Download, TrendingUp, TrendingDown, Package, AlertTriangle } from 'lucide-react';

export const meta: MetaFunction = () => [{ title: 'AI Insights — Kimono BI' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const ctx = await requireUserContext(request);
  await requireModule(request, ctx.effectiveOwnerId, 'narrative');
  const url = new URL(request.url);
  const storeId = url.searchParams.get('store');

  const stores = await db.storeConnection.findMany({
    where: { userId: ctx.effectiveOwnerId },
    select: { id: true, name: true },
  });

  const selectedStoreId = storeId || stores[0]?.id;
  const canRun = ctx.role !== 'viewer';
  if (!selectedStoreId) return json({ stores, lastNarrative: null, selectedStoreId: null, canRun });

  const lastNarrative = await db.aiReport.findFirst({
    where: { storeConnectionId: selectedStoreId, type: 'NARRATIVE' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, content: true, createdAt: true, title: true },
  });

  return json({ stores, lastNarrative, selectedStoreId, canRun });
}

async function generateNarrativeContent(metrics: NarrativeMetrics): Promise<NarrativeContent> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      headline: 'Raport indisponibil (AI neconfigurat)',
      whatHappened: 'OPENAI_API_KEY lipseste. Acest raport arata doar metricile calculate.',
      whyItMatters: '',
      actions: [],
      risks: [],
      opportunities: [],
    };
  }

  const topList = metrics.topProducts.slice(0, 5).map((p) => `    - ${p.title}: ${p.units} buc, ${p.revenue} RON`).join('\n');
  const worstList = metrics.worstProducts.map((p) => `    - ${p.title}: pierdere estimata ${p.lostRevenue} RON/sapt`).join('\n');
  const anomalyList = metrics.anomalies.map((a) => `    - ${a.title}`).join('\n');

  const prompt = `Esti analist BI pentru ecommerce romanesc. Genereaza un raport narativ saptamanal pe baza metricilor reale de mai jos.
Magazin: ${metrics.store.name} (${metrics.store.platform})
Perioada: ${metrics.period.weekStart.toLocaleDateString('ro-RO')} - ${metrics.period.weekEnd.toLocaleDateString('ro-RO')}

METRICI REALE:
- Venit: ${metrics.revenue.thisWeek} RON (${metrics.revenue.ordersThis} comenzi), vs ${metrics.revenue.prevWeek} RON (${metrics.revenue.ordersPrev} comenzi) saptamana trecuta
- Schimbare venit: ${metrics.revenue.changePct >= 0 ? '+' : ''}${metrics.revenue.changePct}%
- AOV: ${metrics.revenue.aovThis} RON vs ${metrics.revenue.aovPrev} RON precedent
- Clienti noi saptamana: ${metrics.customers.newThis} (vs ${metrics.customers.newPrev})
- Clienti fideli (2+ comenzi): ${metrics.customers.repeatThis} din ${metrics.customers.activeThis} activi
- Champions RFM: ${metrics.customers.champions} · At Risk + Lost: ${metrics.customers.atRisk}
- Refund-uri saptamana: ${metrics.refunds.count} (${metrics.refunds.amount} RON, rata ${metrics.refunds.rate}%)

Top produse vandute saptamana:
${topList || '    (fara date)'}

Produse fara stoc care au vandut recent (pierdere):
${worstList || '    (niciun caz critic)'}

Anomalii detectate:
${anomalyList || '    (niciuna)'}

Genereaza JSON strict cu:
{
  "headline": "titlu de o propozitie, 10-15 cuvinte, accentueaza cel mai important fapt",
  "whatHappened": "paragraf de 4-6 fraze cu CE s-a intamplat — foloseste cifrele exacte",
  "whyItMatters": "paragraf de 3-4 fraze cu interpretare si context — ce arata asta, de ce conteaza",
  "actions": [
    "Actiune concreta 1 pentru saptamana aceasta (cu verb, cu target masurabil)",
    "Actiune 2",
    "...3-5 total"
  ],
  "risks": ["Risc 1 de monitorizat", "Risc 2", "2-4 total"],
  "opportunities": ["Oportunitate 1 de explorat", "2-4 total"]
}

Reguli:
- Raspunde DOAR cu JSON valid.
- Romaneste, direct, profesional.
- Cifre exacte, nu rotunjite gresit.
- Daca metricile arata scadere, spune direct, nu sugarcoat.`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL_CHAT || 'gpt-4o',
      messages: [
        { role: 'system', content: 'Analist BI senior. Romana. JSON valid, fara alte comentarii.' },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.6,
      max_tokens: 2000,
    }),
  });

  if (!res.ok) {
    return {
      headline: `Analiza AI esuata (${res.status})`,
      whatHappened: 'Raportul contine doar metricile calculate.',
      whyItMatters: '',
      actions: [], risks: [], opportunities: [],
    };
  }
  const data = await res.json();
  try {
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
    return { headline: 'Eroare parsare AI', whatHappened: '', whyItMatters: '', actions: [], risks: [], opportunities: [] };
  }
}

export async function action({ request }: ActionFunctionArgs) {
  // Re-running narrative costs OpenAI tokens — viewer blocked
  const ctx = await requireMinRole(request, 'analyst');
  const user = ctx.user;
  const form = await request.formData();
  const intent = String(form.get('intent') || 'generate');
  const storeId = String(form.get('storeId') || '');

  const store = storeId ? await db.storeConnection.findFirst({ where: { id: storeId, userId: ctx.effectiveOwnerId } }) : null;
  if (!store) return json({ error: 'Magazinul nu a fost gasit.' }, { status: 404 });

  const metrics = await computeNarrativeMetrics(storeId);
  const content = await generateNarrativeContent(metrics);
  const serialized = JSON.stringify({ metrics, content });

  await db.aiReport.create({
    data: {
      storeConnectionId: storeId,
      type: 'NARRATIVE',
      title: `Raport saptamanal — ${new Date().toLocaleDateString('ro-RO')}`,
      content: serialized,
      tokensUsed: 0,
      costUsd: 0,
    },
  });

  return json({ success: true, metrics, content });
}

function parseNarrative(raw: string | undefined): { metrics: NarrativeMetrics; content: NarrativeContent } | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw);
    if (p.metrics && p.content) return p;
  } catch {}
  return null;
}

export default function NarrativePage() {
  const { stores, lastNarrative, selectedStoreId, canRun } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isSubmitting = navigation.state === 'submitting';

  const fromAction = actionData && 'metrics' in actionData ? actionData : null;
  const fromDb = !fromAction ? parseNarrative(lastNarrative?.content || undefined) : null;
  const data = fromAction || fromDb;

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
        <div>
          <h1 className="page-title">AI Insights</h1>
          <p className="page-subtitle">Raport narativ saptamanal cu metrici reale si recomandari AI</p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
          {stores.length > 1 && (
            <select className="form-input" style={{ width: 220 }} value={selectedStoreId || ''} onChange={(e) => setSearchParams({ store: e.target.value })}>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          {selectedStoreId && (
            <>
              {canRun && (
                <Form method="post">
                  <input type="hidden" name="storeId" value={selectedStoreId} />
                  <input type="hidden" name="intent" value="generate" />
                  <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
                    <Sparkles size={16} />
                    {isSubmitting ? 'Se genereaza...' : (data ? 'Regenereaza' : 'Genereaza raport')}
                  </button>
                </Form>
              )}
              {data && (
                <a href={`/api/narrative/pdf?store=${selectedStoreId}`} className="btn btn-secondary" download>
                  <Download size={16} />
                  Descarca PDF
                </a>
              )}
            </>
          )}
        </div>
      </div>

      <div className="info-box">
        <p>
          AI Insights rezuma saptamana trecuta cu cifre reale din magazin: venit, comenzi, AOV, clienti noi, top produse, refund-uri si anomalii. AI-ul genereaza interpretare si actiuni concrete.
        </p>
      </div>

      {actionData && 'error' in actionData && (
        <div className="alert alert-error">{actionData.error}</div>
      )}

      {!data ? (
        <div className="card" style={{ textAlign: 'center', padding: '56px 24px' }}>
          <Sparkles size={48} style={{ color: 'var(--color-primary)', marginBottom: 'var(--space-md)', opacity: 0.5 }} />
          <p style={{ color: 'var(--color-text-muted)' }}>Genereaza primul raport saptamanal.</p>
        </div>
      ) : (
        <NarrativeView data={data} />
      )}
    </div>
  );
}

function NarrativeView({ data }: { data: { metrics: NarrativeMetrics; content: NarrativeContent } }) {
  const { metrics, content } = data;
  const r = metrics.revenue;
  const c = metrics.customers;

  return (
    <div>
      {/* Headline */}
      <div className="card" style={{ marginBottom: 'var(--space-md)', background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)', color: 'white' }}>
        <div style={{ fontSize: '0.75rem', opacity: 0.8, marginBottom: 'var(--space-xs)' }}>SĂPTĂMÂNA {formatDate(metrics.period.weekStart)} – {formatDate(metrics.period.weekEnd)}</div>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 'var(--space-sm)' }}>{content.headline}</h2>
      </div>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
        <Kpi label="Venit" value={`${r.thisWeek.toLocaleString('ro-RO')} RON`} changePct={r.changePct} prev={`${r.prevWeek.toLocaleString('ro-RO')} RON`} />
        <Kpi label="Comenzi" value={String(r.ordersThis)} changePct={pctChg(r.ordersThis, r.ordersPrev)} prev={String(r.ordersPrev)} />
        <Kpi label="AOV" value={`${Math.round(r.aovThis).toLocaleString('ro-RO')} RON`} changePct={pctChg(r.aovThis, r.aovPrev)} prev={`${Math.round(r.aovPrev)} RON`} />
        <Kpi label="Clienti noi" value={String(c.newThis)} changePct={pctChg(c.newThis, c.newPrev)} prev={String(c.newPrev)} />
      </div>

      {/* What happened + Why */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
        <div className="card">
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-sm)' }}>Ce s-a intamplat</h3>
          <p style={{ fontSize: '0.9375rem', lineHeight: 1.7, color: 'var(--color-text)' }}>{content.whatHappened}</p>
        </div>
        <div className="card">
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-sm)' }}>De ce conteaza</h3>
          <p style={{ fontSize: '0.9375rem', lineHeight: 1.7, color: 'var(--color-text)' }}>{content.whyItMatters}</p>
        </div>
      </div>

      {/* Top products + worst */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
        {metrics.topProducts.length > 0 && (
          <div className="card">
            <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-sm)', display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
              <Package size={16} /> Top produse
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
              {metrics.topProducts.slice(0, 8).map((p, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '0.5px solid var(--border-default)', fontSize: '0.875rem' }}>
                  <span style={{ color: 'var(--color-text)', flex: 1, marginRight: 'var(--space-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</span>
                  <span style={{ color: 'var(--color-text-heading)', fontWeight: 600, marginRight: 'var(--space-sm)' }}>{p.units} buc</span>
                  <span style={{ color: 'var(--color-text-muted)' }}>{p.revenue.toLocaleString('ro-RO')} RON</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {metrics.worstProducts.length > 0 && (
          <div className="card">
            <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-sm)', display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
              <AlertTriangle size={16} style={{ color: 'var(--color-danger)' }} /> Stockout cu pierdere
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
              {metrics.worstProducts.map((p, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '0.5px solid var(--border-default)', fontSize: '0.875rem' }}>
                  <span style={{ flex: 1, marginRight: 'var(--space-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</span>
                  <span style={{ color: 'var(--color-danger)', fontWeight: 600 }}>-{p.lostRevenue.toLocaleString('ro-RO')} RON/sapt</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      {content.actions.length > 0 && (
        <div className="card" style={{ marginBottom: 'var(--space-md)' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-md)' }}>Actiuni pentru saptamana aceasta</h3>
          <ol style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            {content.actions.map((a, i) => <li key={i} style={{ fontSize: '0.9375rem', color: 'var(--color-text)' }}>{a}</li>)}
          </ol>
        </div>
      )}

      {/* Risks + Opportunities */}
      {(content.risks.length > 0 || content.opportunities.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 'var(--space-md)' }}>
          {content.risks.length > 0 && (
            <div className="card" style={{ borderLeft: '3px solid var(--color-danger)' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-danger)', marginBottom: 'var(--space-sm)' }}>Riscuri de monitorizat</h3>
              <ul style={{ paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {content.risks.map((r, i) => <li key={i} style={{ fontSize: '0.875rem', color: 'var(--color-text)' }}>{r}</li>)}
              </ul>
            </div>
          )}
          {content.opportunities.length > 0 && (
            <div className="card" style={{ borderLeft: '3px solid var(--color-success)' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-success)', marginBottom: 'var(--space-sm)' }}>Oportunitati</h3>
              <ul style={{ paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {content.opportunities.map((o, i) => <li key={i} style={{ fontSize: '0.875rem', color: 'var(--color-text)' }}>{o}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, changePct, prev }: { label: string; value: string; changePct: number; prev: string }) {
  const isUp = changePct >= 0;
  return (
    <div className="card">
      <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 'var(--space-xs)' }}>{label}</div>
      <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--color-text-heading)' }}>{value}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', fontSize: '0.75rem', marginTop: 4 }}>
        {isUp ? <TrendingUp size={12} color="var(--color-success)" /> : <TrendingDown size={12} color="var(--color-danger)" />}
        <span style={{ color: isUp ? 'var(--color-success)' : 'var(--color-danger)', fontWeight: 600 }}>
          {isUp ? '+' : ''}{changePct.toFixed(1)}%
        </span>
        <span style={{ color: 'var(--color-text-muted)' }}>vs {prev}</span>
      </div>
    </div>
  );
}

function pctChg(cur: number, prev: number): number {
  return prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : 0;
}

function formatDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('ro-RO', { day: '2-digit', month: 'short' });
}
