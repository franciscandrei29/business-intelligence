import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { Link, useLoaderData, useFetcher } from '@remix-run/react';
import { useState, useEffect } from 'react';
import { requireUserContext, requireMinRole } from '~/lib/auth/requireAuth.server';
import { requireModule } from '~/lib/plans.server';
import { db } from '~/lib/db.server';
import { checkAiMessageLimit } from '~/lib/plans.server';
import { formatDate } from '~/lib/utils';
import { Bot, Send, MessageSquare, ChevronRight, Zap } from 'lucide-react';
import { buildStoreContext } from '~/lib/ask-ai-context.server';

export const meta: MetaFunction = () => [{ title: 'Ask AI — Kimono BI' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const ctx = await requireMinRole(request, 'analyst');
  await requireModule(request, ctx.effectiveOwnerId, 'ask-ai');
  const url = new URL(request.url);
  const openReportId = url.searchParams.get('r');

  const stores = await db.storeConnection.findMany({
    where: { userId: ctx.effectiveOwnerId },
    select: { id: true, name: true },
  });

  const { allowed, remaining } = await checkAiMessageLimit(ctx.effectiveOwnerId);

  const recentReports = await db.aiReport.findMany({
    where: { storeConnection: { userId: ctx.effectiveOwnerId }, type: 'ADVISOR' },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { id: true, title: true, createdAt: true },
  });

  let openReport: { id: string; title: string; content: string; createdAt: Date } | null = null;
  if (openReportId) {
    openReport = await db.aiReport.findFirst({
      where: { id: openReportId, storeConnection: { userId: ctx.effectiveOwnerId }, type: 'ADVISOR' },
      select: { id: true, title: true, content: true, createdAt: true },
    });
  }

  return json({ stores, allowed, remaining, recentReports, openReport });
}

export async function action({ request }: ActionFunctionArgs) {
  const ctx = await requireMinRole(request, 'analyst');
  const form = await request.formData();
  const message = String(form.get('message') || '').trim();
  const storeId = String(form.get('storeId') || '');

  if (!message) return json({ error: 'Mesajul este obligatoriu.' }, { status: 400 });

  const { allowed } = await checkAiMessageLimit(ctx.effectiveOwnerId);
  if (!allowed) {
    return json({ error: 'Ai atins limita de mesaje AI pentru luna aceasta.' }, { status: 400 });
  }

  const store = storeId
    ? await db.storeConnection.findFirst({ where: { id: storeId, userId: ctx.effectiveOwnerId } })
    : null;

  let context = '';
  if (store) {
    try {
      context = await buildStoreContext(store.id);






    } catch (err) {
      console.error('[ask-ai] buildStoreContext failed:', err);
      context = `Magazin: ${store.name} (${store.platform}, ${store.domain})`;
    }
  }

  const systemPrompt = `Esti analistul BI al magazinului online. Ai datele reale mai jos.

REGULI OBLIGATORII:
1. INCEPE MEREU CU CIFRA EXACTA. Nu cu "pentru a determina", nu cu introduceri. Prima propozitie = raspunsul direct.
   GRESIT: "Pentru a determina rata de retur, trebuie sa analizam datele..."
   CORECT: "Rata de retur este 0.3% - 11 retururi din 4.268 comenzi in ultimele 90 zile."
2. Raspunzi DOAR in romana.
3. ZERO formatare. Fara **, fara ##, fara bold, fara italic. Text simplu. Foloseste cratima (-) pentru liste.
4. NU spune niciodata "nu am acces", "nu dispun", "nu am date". Ai TOATE datele mai jos. Daca o cifra nu exista exact, calculeaz-o din datele disponibile.
5. Fii SCURT. Maximum 3-5 propozitii pentru intrebari simple. Pentru analize complexe, maximum 10 linii.
6. Cand dai cifre mari, foloseste separator de mii cu punct: 1.234 nu 1234.
7. Adauga CONTEXT la cifre: "156.589 RON (cu 20% mai mult decat saptamana trecuta)" nu doar "156.589 RON".
8. Daca userul intreaba "de ce", analizeaza datele si da o explicatie bazata pe cifre, nu sfaturi generice.

${context ? context : 'Nu exista un magazin selectat. Raspunde generic despre ecommerce.'}`;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return json({ error: 'OPENAI_API_KEY nu este configurat.' }, { status: 500 });

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL_CHAT || 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message },
        ],
        max_tokens: 2000,
        temperature: 0.7,
      }),
    });

    if (!response.ok) return json({ error: `Eroare OpenAI: ${response.status}` }, { status: 500 });

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || 'Nu am putut genera un raspuns.';
    const tokensUsed = data.usage?.total_tokens || 0;
    const costUsd = (tokensUsed / 1000) * 0.005;

    if (store) {
      await db.aiReport.create({
        data: {
          storeConnectionId: store.id,
          type: 'ADVISOR',
          title: message.slice(0, 100),
          content: reply,
          tokensUsed,
          costUsd,
        },
      });
    }

    return json({ reply, tokensUsed, question: message });
  } catch (err: any) {
    return json({ error: `Eroare: ${err.message}` }, { status: 500 });
  }
}

const SUGGESTED = [
  'Ce produse ar trebui sa reaprovizionez urgent?',
  'Care sunt clientii cu risc de plecare?',
  'Cum pot creste valoarea medie a comenzii?',
  'Ce zile din saptamana au cele mai bune vanzari?',
];

export default function AdvisorPage() {
  const { stores, allowed, remaining, recentReports, openReport } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const [selectedStore, setSelectedStore] = useState(stores[0]?.id || '');
  const [message, setMessage] = useState('');

  const isSubmitting = fetcher.state !== 'idle';
  const ad = fetcher.data as any;
  const hasResponse = !!ad?.reply;
  const hasOpenReport = !!openReport && !hasResponse;

  // Clear message after successful response
  useEffect(() => {
    if (ad?.reply) setMessage('');
  }, [ad?.reply]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 16, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 className="page-title">Ask AI</h1>
            <p className="page-subtitle">
              {remaining === 999 ? 'Mesaje nelimitate' : `${remaining} mesaje ramase luna aceasta`}
            </p>
          </div>
          {stores.length > 1 && (
            <select className="form-input" style={{ width: 180 }} value={selectedStore}
              onChange={(e) => setSelectedStore(e.target.value)}>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
        </div>

        {ad?.error && <div className="alert alert-error">{ad.error}</div>}

        {hasOpenReport && (
          <div style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border-default)', borderRadius: 'var(--radius-xl)', overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '0.5px solid var(--border-default)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <div style={{ width: 28, height: 28, background: 'var(--kimono-orange-bg)', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <MessageSquare size={13} color="var(--kimono-orange)" />
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{openReport!.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{formatDate(openReport!.createdAt, 'relative')}</div>
                </div>
              </div>
              <Link to="/ask-ai" className="btn btn-secondary" style={{ fontSize: 11 }}>Conversatie noua</Link>
            </div>
            <div style={{ padding: '20px', fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap', color: 'var(--text-primary)' }}>{openReport!.content}</div>
          </div>
        )}

        {hasResponse && (
          <div style={{ background: 'var(--bg-dark)', borderRadius: 'var(--radius-xl)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '0.5px solid rgba(255,255,255,0.08)' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div style={{ width: 26, height: 26, background: 'var(--border-strong)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>Tu</div>
                <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)', lineHeight: 1.55, margin: 0, paddingTop: 3 }}>{ad.question}</p>
              </div>
            </div>
            <div style={{ padding: '16px 20px' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div style={{ width: 26, height: 26, background: 'var(--kimono-orange)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Bot size={13} color="white" />
                </div>
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.9)', lineHeight: 1.7, whiteSpace: 'pre-wrap', flex: 1 }}>{ad.reply}</div>
              </div>
            </div>
          </div>
        )}


        {isSubmitting && (
          <div style={{ background: 'var(--bg-dark)', borderRadius: 'var(--radius-xl)', padding: '20px', overflow: 'hidden' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <div style={{ width: 26, height: 26, background: 'var(--kimono-orange)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Bot size={13} color="white" />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--kimono-orange)', animation: 'pulse 1.4s ease-in-out infinite' }} />
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--kimono-orange)', animation: 'pulse 1.4s ease-in-out 0.2s infinite' }} />
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--kimono-orange)', animation: 'pulse 1.4s ease-in-out 0.4s infinite' }} />
                </div>
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 8 }}>Analizez datele magazinului si generez raspunsul...</p>
              </div>
            </div>
          </div>
        )}

        <div className="card" style={{ padding: '16px 20px' }}>
          <fetcher.Form method="post">
            <input type="hidden" name="storeId" value={selectedStore} />
            <textarea name="message" className="form-input" rows={3}
              placeholder="Intreaba ceva despre magazinul tau..."
              value={message} onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); (e.currentTarget.form as HTMLFormElement)?.requestSubmit(); } }}
              style={{ resize: 'none', width: '100%', marginBottom: 10 }} />
            <button type="submit" disabled={isSubmitting || !allowed || !message.trim()}
              style={{ background: isSubmitting || !message.trim() ? 'var(--border-strong)' : 'var(--kimono-orange)',
                color: 'white', border: 'none', padding: '10px 24px', borderRadius: 8,
                cursor: isSubmitting || !message.trim() ? 'default' : 'pointer',
                fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              {isSubmitting
                ? <><div style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} /> Se proceseaza...</>
                : <><Send size={14} color="white" /> Trimite</>}
            </button>
          </fetcher.Form>

          {!hasResponse && !hasOpenReport && !isSubmitting && (
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '0.5px solid var(--border-default)' }}>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 8 }}>Sugestii:</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {SUGGESTED.map((q) => (
                  <button key={q} type="button" onClick={() => setMessage(q)}
                    style={{ fontSize: 11, padding: '5px 10px', borderRadius: 99, border: '0.5px solid var(--border-default)', background: 'var(--bg-subtle)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border-default)', borderRadius: 'var(--radius-xl)', padding: '14px 16px' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
            <Zap size={13} color="var(--kimono-orange)" />
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>Utilizare AI</span>
          </div>
          {remaining === 999
            ? <p style={{ fontSize: 12, color: 'var(--success-text)', fontWeight: 500 }}>Mesaje nelimitate</p>
            : <>
                <div style={{ height: 4, borderRadius: 2, background: 'var(--border-default)', marginBottom: 6, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.max(5, (remaining / 100) * 100)}%`, background: remaining > 20 ? 'var(--success-bg-strong)' : 'var(--danger-bg-strong)', borderRadius: 2 }} />
                </div>
                <p style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{remaining} mesaje ramase luna aceasta</p>
              </>}
        </div>

        <div style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border-default)', borderRadius: 'var(--radius-xl)', padding: '14px 16px' }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 10 }}>Conversatii recente</div>
          {recentReports.length === 0
            ? <p style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Nicio conversatie inca.</p>
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {recentReports.map((r) => {
                  const isActive = openReport?.id === r.id;
                  return (
                    <Link key={r.id} to={`/ask-ai?r=${r.id}`}
                      style={{ padding: '8px 10px', borderRadius: 'var(--radius-md)', background: isActive ? 'var(--kimono-orange-bg)' : 'transparent', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <MessageSquare size={12} color={isActive ? 'var(--kimono-orange)' : 'var(--text-tertiary)'} style={{ flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: isActive ? 500 : 400, color: isActive ? 'var(--kimono-orange-text)' : 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.title}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{formatDate(r.createdAt, 'relative')}</div>
                      </div>
                      <ChevronRight size={11} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                    </Link>
                  );
                })}
              </div>}
        </div>
      </div>
    </div>
  );
}
