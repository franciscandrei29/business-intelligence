import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { Form, Link, useActionData, useLoaderData, useNavigation, useSearchParams } from '@remix-run/react';
import { useState } from 'react';
import { requireUser } from '~/lib/auth/requireAuth.server';
import { db } from '~/lib/db.server';
import { checkAiMessageLimit } from '~/lib/plans';
import { Bot, Send, MessageSquare, ChevronRight } from 'lucide-react';

export const meta: MetaFunction = () => [{ title: 'AI Advisor — Kimono BI' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const url = new URL(request.url);
  const openReportId = url.searchParams.get('r');

  const stores = await db.storeConnection.findMany({
    where: { userId: user.id },
    select: { id: true, name: true },
  });

  const { allowed, remaining } = await checkAiMessageLimit(user.id);

  // Get recent conversations
  const recentReports = await db.aiReport.findMany({
    where: { storeConnection: { userId: user.id }, type: 'ADVISOR' },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { id: true, title: true, createdAt: true },
  });

  // If a specific report is requested, load its full content
  let openReport: { id: string; title: string; content: string; createdAt: Date } | null = null;
  if (openReportId) {
    openReport = await db.aiReport.findFirst({
      where: { id: openReportId, storeConnection: { userId: user.id }, type: 'ADVISOR' },
      select: { id: true, title: true, content: true, createdAt: true },
    });
  }

  return json({ stores, allowed, remaining, recentReports, openReport });
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  const message = String(form.get('message') || '').trim();
  const storeId = String(form.get('storeId') || '');

  if (!message) return json({ error: 'Mesajul este obligatoriu.' }, { status: 400 });

  const { allowed } = await checkAiMessageLimit(user.id);
  if (!allowed) {
    return json({ error: 'Ai atins limita de mesaje AI pentru luna aceasta. Fa upgrade la planul urmator.' }, { status: 400 });
  }

  // Validate store
  const store = storeId ? await db.storeConnection.findFirst({
    where: { id: storeId, userId: user.id },
  }) : null;

  // Build context
  let context = '';
  if (store) {
    const [productCount, orderCount, customerCount, topProducts, recentAlerts] = await Promise.all([
      db.product.count({ where: { storeConnectionId: store.id } }),
      db.order.count({ where: { storeConnectionId: store.id } }),
      db.customer.count({ where: { storeConnectionId: store.id } }),
      db.product.findMany({
        where: { storeConnectionId: store.id },
        orderBy: { price: 'desc' },
        take: 5,
        select: { title: true, price: true, inventory: true },
      }),
      db.stockAlert.findMany({
        where: { storeConnectionId: store.id },
        take: 3,
        select: { productTitle: true, daysRemaining: true, severity: true },
      }),
    ]);

    context = `
Magazin: ${store.name} (${store.platform}, ${store.domain})
Statistici: ${productCount} produse, ${orderCount} comenzi, ${customerCount} clienti
Top produse: ${topProducts.map(p => `${p.title} (${Number(p.price)} RON, stoc: ${p.inventory})`).join('; ')}
${recentAlerts.length > 0 ? `Alerte stoc: ${recentAlerts.map(a => `${a.productTitle} - ${a.daysRemaining} zile ramase (${a.severity})`).join('; ')}` : 'Nu exista alerte de stoc.'}
`;
  }

  const systemPrompt = `Esti AI Advisor-ul platformei Kimono BI, un asistent de business intelligence pentru magazine online.
Raspunzi DOAR in limba romana.
Esti expert in ecommerce, analiza de date, marketing digital, si strategii de crestere.
Dai sfaturi concrete, actionabile, bazate pe datele magazinului.
Fii concis dar complet. Foloseste bullet points cand e util.
${context ? `\nContext magazin:\n${context}` : '\nNu exista un magazin selectat. Raspunde generic despre ecommerce.'}`;

  // Call OpenAI
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return json({ error: 'OPENAI_API_KEY nu este configurat.' }, { status: 500 });
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
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

    if (!response.ok) {
      const errText = await response.text();
      return json({ error: `Eroare OpenAI: ${response.status}` }, { status: 500 });
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || 'Nu am putut genera un raspuns.';
    const tokensUsed = data.usage?.total_tokens || 0;
    const costUsd = (tokensUsed / 1000) * 0.005; // Approximate GPT-4o cost

    // Save to DB
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

    return json({ reply, tokensUsed });
  } catch (err: any) {
    return json({ error: `Eroare: ${err.message}` }, { status: 500 });
  }
}

export default function AdvisorPage() {
  const { stores, allowed, remaining, recentReports, openReport } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const isSubmitting = navigation.state === 'submitting';
  const [selectedStore, setSelectedStore] = useState(stores[0]?.id || '');

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">AI Advisor</h1>
        <p className="page-subtitle">
          {remaining === 999 ? 'Mesaje nelimitate' : `${remaining} mesaje ramase luna aceasta`}
        </p>
      </div>


      <div className="info-box">
        <p>
          AI Advisor este un consultant virtual bazat pe GPT-4o care analizeaza datele magazinului tau si ofera sfaturi concrete in limba romana. Intreaba orice despre strategie, marketing, pricing, sau optimizare. Contextul magazinului (produse, alerte, vanzari) este inclus automat.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--space-md)' }}>
        {/* Chat area */}
        <div>
          {/* Open historical conversation */}
          {openReport && !actionData?.reply && (
            <div className="card" style={{ marginBottom: 'var(--space-md)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                  <MessageSquare size={20} style={{ color: 'var(--color-primary)' }} />
                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--color-text-heading)' }}>{openReport.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--color-muted)' }}>{new Date(openReport.createdAt).toLocaleString('ro-RO')}</div>
                  </div>
                </div>
                <Link to="/advisor" className="btn btn-secondary">Conversatie noua</Link>
              </div>
              <div style={{ fontSize: '0.9375rem', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                {openReport.content}
              </div>
            </div>
          )}

          {/* Current reply (after submission) */}
          {actionData?.reply && (
            <div className="card" style={{ marginBottom: 'var(--space-md)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)' }}>
                <Bot size={20} style={{ color: 'var(--color-primary)' }} />
                <span style={{ fontWeight: 600, color: 'var(--color-text-heading)' }}>Kimono AI</span>
              </div>
              <div style={{ fontSize: '0.9375rem', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                {actionData.reply}
              </div>
            </div>
          )}

          {actionData?.error && (
            <div className="alert alert-error" style={{ marginBottom: 'var(--space-md)' }}>{actionData.error}</div>
          )}

          {/* Input */}
          <div className="card">
            <Form method="post">
              <input type="hidden" name="storeId" value={selectedStore} />

              {stores.length > 1 && (
                <div className="form-group">
                  <label className="form-label">Magazin context</label>
                  <select className="form-input" value={selectedStore} onChange={(e) => setSelectedStore(e.target.value)}>
                    {stores.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Intreaba ceva despre magazinul tau</label>
                <textarea
                  name="message"
                  className="form-input"
                  rows={3}
                  placeholder="Ex: Ce strategii imi recomanzi pentru a creste vanzarile luna viitoare?"
                  required
                  style={{ resize: 'vertical' }}
                />
              </div>

              <button type="submit" className="btn btn-primary" disabled={isSubmitting || !allowed}>
                <Send size={16} />
                {isSubmitting ? 'Se genereaza raspunsul...' : 'Trimite'}
              </button>
            </Form>
          </div>
        </div>

        {/* History sidebar */}
        <div>
          <div className="card">
            <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-md)' }}>
              Conversatii recente
            </h3>
            {recentReports.length === 0 ? (
              <p style={{ color: 'var(--color-muted)', fontSize: 13 }}>Nicio conversatie inca.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {recentReports.map((r) => {
                  const isActive = openReport?.id === r.id;
                  return (
                    <Link
                      key={r.id}
                      to={`/advisor?r=${r.id}`}
                      style={{
                        padding: 10,
                        background: isActive ? 'var(--color-accent-light)' : 'var(--color-off-white)',
                        border: isActive ? '2px solid var(--color-black)' : '2px solid transparent',
                        borderRadius: 4,
                        textDecoration: 'none',
                        color: 'var(--color-black)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        transition: 'background 120ms ease',
                      }}
                    >
                      <MessageSquare size={14} style={{ flexShrink: 0, color: isActive ? 'var(--color-accent)' : 'var(--color-muted)' }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {r.title}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--color-muted)', fontWeight: 500 }}>
                          {new Date(r.createdAt).toLocaleString('ro-RO', { dateStyle: 'short', timeStyle: 'short' })}
                        </div>
                      </div>
                      <ChevronRight size={14} style={{ flexShrink: 0, color: 'var(--color-muted)' }} />
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
