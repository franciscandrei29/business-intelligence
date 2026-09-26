import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { Form, useActionData, useLoaderData, useNavigation, useSearchParams } from '@remix-run/react';
import { requireUser, requireUserContext, requireMinRole } from '~/lib/auth/requireAuth.server';
import { requireModule } from '~/lib/plans.server';
import { requireModule } from '~/lib/plans.server';
import { db } from '~/lib/db.server';
import { computeAuditMetrics, type AuditMetrics } from '~/lib/audit/metrics.server';
import type { AuditCommentary } from '~/lib/pdf/audit-pdf.server';
import { FileBarChart, Download, RefreshCw } from 'lucide-react';

export const meta: MetaFunction = () => [{ title: 'BI Audit — Kimono BI' }];

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

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  excellent: { bg: '#dcfce7', fg: '#166534', label: 'Excelent' },
  good: { bg: '#dbeafe', fg: '#1e40af', label: 'Bun' },
  warning: { bg: '#fef3c7', fg: '#92400e', label: 'Atentie' },
  critical: { bg: '#fee2e2', fg: '#991b1b', label: 'Critic' },
  unavailable: { bg: '#f1f5f9', fg: '#475569', label: 'Indisponibil' },
};

export async function loader({ request }: LoaderFunctionArgs) {
  const ctx = await requireUserContext(request);
  await requireModule(request, ctx.effectiveOwnerId, 'audit');

  const stores = await db.storeConnection.findMany({
    where: { userId: ctx.effectiveOwnerId },
    select: { id: true, name: true },
  });

  const url = new URL(request.url);
  const storeId = url.searchParams.get('store') || stores[0]?.id;

  const lastAudit = storeId ? await db.aiReport.findFirst({
    where: { storeConnectionId: storeId, type: 'AUDIT' },
    orderBy: { createdAt: 'desc' },
  }) : null;

  const canRun = ctx.role !== 'viewer';
  return json({ stores, lastAudit, selectedStoreId: storeId, canRun });
}

async function generateCommentary(metrics: AuditMetrics): Promise<AuditCommentary> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      executiveSummary: 'OPENAI_API_KEY neconfigurat — raportul este generat doar pe baza metricilor calculate, fara analiza AI.',
      domainNotes: {},
      recommendations: ['Configureaza OPENAI_API_KEY pentru comentariu AI.'],
    };
  }

  // Build rich context with actual computed numbers
  const domainsContext = (Object.entries(metrics.domains) as Array<[string, any]>)
    .map(([key, d]) => {
      const metricsLine = d.metrics.map((m: any) => `    - ${m.label}: ${m.value}${m.hint ? ` (${m.hint})` : ''}`).join('\n');
      return `  ${DOMAIN_TITLES[key]} [scor ${d.score}/100 · ${d.status}]:\n${metricsLine}`;
    })
    .join('\n\n');

  const prompt = `Esti consultant senior de business intelligence pentru ecommerce romanesc.
Primesti metrici reali pentru magazinul "${metrics.store.name}" (${metrics.store.platform}).
Scor general: ${metrics.overall.score}/100 (grad ${metrics.overall.grade}).

METRICI PE DOMENII:
${domainsContext}

Genereaza un raspuns JSON strict cu urmatoarea structura:
{
  "executiveSummary": "3-4 fraze pentru conducere: starea business-ului, 2-3 puncte forte, 2-3 riscuri principale",
  "domainNotes": {
    "revenue": "1-2 paragrafe de observatii concrete, citeaza cifre",
    "catalog": "...",
    "customers": "...",
    "inventory": "...",
    "traffic": "...",
    "profitability": "...",
    "operations": "...",
    "automation": "..."
  },
  "recommendations": [
    "Recomandare 1 (cea mai impactanta) — scurta, concreta, cu verb de actiune",
    "Recomandare 2 ...",
    "...pana la 8 recomandari total"
  ]
}

Reguli STRICTE:
- Raspunde DOAR cu JSON valid, nicio explicatie in afara.
- Toate textele in limba romana.
- Foloseste CIFRELE EXACTE din metrici, nu inventa numere.
- Daca un scor e mic, nu trebuie sa-l inflorezi — fii direct.
- Recomandarile sa fie concrete, masurable (ex: "Ridica costPerUnit pentru produsele top-20 pentru a calcula marja reala", nu "optimizati marja").`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL_CHAT || 'gpt-4o',
      messages: [
        { role: 'system', content: 'Expert BI pentru ecommerce. Raspunzi exclusiv cu JSON valid in limba romana.' },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.5,
      max_tokens: 3500,
    }),
  });

  if (!res.ok) {
    return {
      executiveSummary: `Analiza AI esuata (HTTP ${res.status}). Raportul contine doar metricile calculate.`,
      domainNotes: {},
      recommendations: [],
    };
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '{}';
  try {
    const parsed = JSON.parse(content);
    return {
      executiveSummary: parsed.executiveSummary || '',
      domainNotes: parsed.domainNotes || {},
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations.slice(0, 8) : [],
    };
  } catch {
    return { executiveSummary: 'Eroare la parsarea raspunsului AI.', domainNotes: {}, recommendations: [] };
  }
}

export async function action({ request }: ActionFunctionArgs) {
  // Re-running audit costs OpenAI tokens — viewer blocked
  const ctx = await requireMinRole(request, 'analyst');
  const user = ctx.user;
  await requireModule(request, ctx.effectiveOwnerId, 'audit');

  const form = await request.formData();
  const intent = String(form.get('intent') || 'generate');
  const storeId = String(form.get('storeId'));

  const store = await db.storeConnection.findFirst({ where: { id: storeId, userId: ctx.effectiveOwnerId } });
  if (!store) return json({ error: 'Store not found' }, { status: 404 });

  // Default: generate and store the latest report (metrics + AI commentary)
  const metrics = await computeAuditMetrics(storeId);
  const commentary = await generateCommentary(metrics);

  const serialized = JSON.stringify({ metrics, commentary });

  await db.aiReport.create({
    data: {
      storeConnectionId: storeId,
      type: 'AUDIT',
      title: `BI Audit — ${metrics.generatedAt.toLocaleDateString('ro-RO')} · scor ${metrics.overall.score}/100`,
      content: serialized,
      tokensUsed: 0,
      costUsd: 0,
    },
  });

  return json({ success: true, metrics, commentary });
}

function parseAudit(raw: string | undefined): { metrics: AuditMetrics; commentary: AuditCommentary } | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw);
    if (p.metrics && p.commentary) return p;
  } catch {}
  return null;
}

export default function AuditPage() {
  const { stores, lastAudit, selectedStoreId, canRun } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';
  const [searchParams, setSearchParams] = useSearchParams();

  const fromAction = actionData && 'metrics' in actionData ? actionData : null;
  const fromDb = !fromAction ? parseAudit(lastAudit?.content || undefined) : null;
  const audit = fromAction || fromDb;

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
        <div>
          <h1 className="page-title">BI Audit</h1>
          <p className="page-subtitle">Raport complet pe 8 domenii cu scor, metrici reale si recomandari AI</p>
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
                    <RefreshCw size={16} className={isSubmitting ? 'spinning' : ''} />
                    {isSubmitting ? 'Se genereaza...' : (audit ? 'Regenereaza' : 'Genereaza Audit')}
                  </button>
                </Form>
              )}
              {audit && (
                <a href={`/api/audit/pdf?store=${selectedStoreId}`} className="btn btn-secondary" download>
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
          BI Audit calculeaza 8 scoruri separate pe baza datelor reale ale magazinului (nu doar GPT). Fiecare domeniu are metrici exacte, iar AI-ul adauga interpretare si recomandari. Descarca PDF pentru un raport standalone.
        </p>
      </div>

      {actionData && 'error' in actionData && (
        <div className="alert alert-error" style={{ marginBottom: 'var(--space-md)' }}>{actionData.error}</div>
      )}

      {!audit ? (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}>
          <FileBarChart size={48} style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-md)' }} />
          <p style={{ color: 'var(--color-text-muted)' }}>
            Genereaza un audit complet cu 8 scoruri pe domeniu, metrici reale si recomandari AI.
          </p>
        </div>
      ) : (
        <AuditView audit={audit} />
      )}
    </div>
  );
}

function AuditView({ audit }: { audit: { metrics: AuditMetrics; commentary: AuditCommentary } }) {
  const { metrics, commentary } = audit;
  return (
    <div>
      {/* Hero score */}
      <div className="card" style={{ marginBottom: 'var(--space-md)', background: 'linear-gradient(135deg, var(--color-card) 0%, var(--color-bg) 100%)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-md)' }}>
          <div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: 'var(--space-xs)' }}>Scor general Kimono BI</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-sm)' }}>
              <span style={{ fontSize: '3.5rem', fontWeight: 800, color: 'var(--color-text-heading)', lineHeight: 1 }}>{metrics.overall.score}</span>
              <span style={{ fontSize: '1.25rem', color: 'var(--color-text-muted)' }}>/ 100</span>
              <span className="status-badge" style={{ background: GRADE_BG[metrics.overall.grade], color: GRADE_FG[metrics.overall.grade], padding: '4px 12px', borderRadius: 'var(--radius-sm)', fontWeight: 700, marginLeft: 'var(--space-sm)' }}>
                Grad {metrics.overall.grade}
              </span>
            </div>
            <p style={{ color: 'var(--color-text)', fontSize: '0.9375rem', marginTop: 'var(--space-sm)', maxWidth: 640 }}>
              {metrics.overall.verdict}
            </p>
          </div>
        </div>
      </div>

      {/* Executive summary */}
      {commentary.executiveSummary && (
        <div className="card" style={{ marginBottom: 'var(--space-md)' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-sm)' }}>Executive Summary</h3>
          <p style={{ color: 'var(--color-text)', fontSize: '0.9375rem', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{commentary.executiveSummary}</p>
        </div>
      )}

      {/* Domain cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
        {(Object.entries(metrics.domains) as Array<[string, any]>).map(([key, d]) => {
          const style = STATUS_STYLE[d.status] || STATUS_STYLE.good;
          return (
            <div key={key} className="card" style={{ borderLeft: `4px solid ${style.fg}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-sm)' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)' }}>{DOMAIN_TITLES[key]}</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                  <span style={{ background: style.bg, color: style.fg, padding: '2px 8px', borderRadius: 'var(--radius-sm)', fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase' }}>{style.label}</span>
                  <span style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--color-text-heading)' }}>{d.score}<span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>/100</span></span>
                </div>
              </div>
              {/* Score bar */}
              <div style={{ height: 6, background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)', overflow: 'hidden', marginBottom: 'var(--space-md)' }}>
                <div style={{ width: `${d.score}%`, height: '100%', background: style.fg }} />
              </div>
              {/* Metrics */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)' }}>
                {d.metrics.map((m: any, i: number) => (
                  <div key={i} style={{ padding: 'var(--space-sm)', background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)' }}>
                    <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 2 }}>{m.label}</div>
                    <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-text-heading)' }}>{m.value}</div>
                    {m.hint && <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)', marginTop: 2 }}>{m.hint}</div>}
                  </div>
                ))}
              </div>
              {/* AI note */}
              {commentary.domainNotes[key] && (
                <div style={{ padding: 'var(--space-sm)', background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)', borderLeft: '2px solid var(--color-primary)' }}>
                  <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 4 }}>Observatii AI</div>
                  <div style={{ fontSize: '0.8125rem', color: 'var(--color-text)', lineHeight: 1.6 }}>{commentary.domainNotes[key]}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Recommendations */}
      {commentary.recommendations.length > 0 && (
        <div className="card">
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-md)' }}>Recomandari prioritizate</h3>
          <ol style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            {commentary.recommendations.map((r, i) => (
              <li key={i} style={{ fontSize: '0.9375rem', color: 'var(--color-text)', lineHeight: 1.6 }}>{r}</li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

const GRADE_BG: Record<string, string> = { A: '#dcfce7', B: '#dbeafe', C: '#fef3c7', D: '#fee2e2', F: '#fecaca' };
const GRADE_FG: Record<string, string> = { A: '#166534', B: '#1e40af', C: '#92400e', D: '#991b1b', F: '#7f1d1d' };
