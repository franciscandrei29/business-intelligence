import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json, redirect } from '@remix-run/node';
import { Link } from '@remix-run/react';
import { getUserFromRequest } from '~/lib/auth/session.server';
import {
  LayoutDashboard, TrendingUp, Users, ShieldAlert, LineChart, UserX,
  Activity, DollarSign, Bot, Search, FileBarChart, Zap, Mail, Heart,
  Receipt, Repeat, Gauge, Sparkles, Check, ArrowRight, Store,
} from 'lucide-react';

export const meta: MetaFunction = () => [
  { title: 'Kimono BI — Business Intelligence pentru Shopify & WooCommerce' },
  { name: 'description', content: 'Platforma de Business Intelligence cu 22 module: predictive analytics, AI advisor, profitability, churn prediction. Pentru Shopify si WooCommerce.' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUserFromRequest(request);
  if (user) return redirect('/dashboard');
  return json({});
}

const FEATURES = [
  { icon: LayoutDashboard, name: 'Dashboard KPIs', desc: 'Revenue, comenzi, AOV, Health Score' },
  { icon: LineChart, name: 'Revenue Forecast', desc: 'Predictie 30/60/90 zile cu ML' },
  { icon: UserX, name: 'Churn Prediction', desc: 'Scor 0-100 risc pierdere client' },
  { icon: Activity, name: 'Anomaly Detection', desc: 'Detectie automata drop/spike' },
  { icon: Heart, name: 'LTV Analytics', desc: 'LTV per canal, produs, cohorta' },
  { icon: Receipt, name: 'Contribution Margin', desc: 'Profit real per comanda' },
  { icon: DollarSign, name: 'Profitabilitate', desc: 'COGS, marja per produs' },
  { icon: Repeat, name: 'Repeat Purchase', desc: 'Rata repeat, produse driver' },
  { icon: TrendingUp, name: 'RFM Segments', desc: '8 segmente clienti R/F/M' },
  { icon: Users, name: 'Cohort Analysis', desc: 'Matrice retentie 12x12' },
  { icon: ShieldAlert, name: 'Smart Alerts', desc: 'Alerte stoc velocity-based' },
  { icon: Gauge, name: 'Scale Readiness', desc: 'Scor 0-100: esti gata sa scalezi?' },
  { icon: Bot, name: 'AI Advisor', desc: 'Chat GPT-4o in romana' },
  { icon: Sparkles, name: 'AI Insights', desc: 'Narativ saptamanal automat' },
  { icon: Search, name: 'SEO Engine', desc: 'Tag classify + keywords cu AI' },
  { icon: FileBarChart, name: 'BI Audit', desc: 'Raport 8 domenii + recomandari' },
  { icon: Zap, name: 'Smart Actions', desc: 'Winback, reorder, discount auto' },
  { icon: Mail, name: 'Email Digest', desc: 'Rapoarte pe email zilnic/saptamanal' },
];

const PLANS = [
  { name: 'Free', price: '$0', period: 'forever', features: ['1 magazin', '3 mesaje AI / luna', 'Dashboard + AI Advisor', 'RFM + Cohorts'] },
  { name: 'Starter', price: '$49', period: '/luna', features: ['1 magazin', '30 mesaje AI / luna', 'Toate modulele de analiza', 'Smart Alerts + Email Digest'] },
  { name: 'Growth', price: '$99', period: '/luna', popular: true, features: ['3 magazine', '100 mesaje AI / luna', 'Toate 22 modulele', 'BI Audit + SEO Engine', 'Predictive Analytics'] },
  { name: 'Scale', price: '$199', period: '/luna', features: ['10 magazine', 'AI nelimitat', 'Toate 22 modulele', 'Priority support', 'Custom prompts'] },
];

export default function LandingPage() {
  return (
    <div style={{ background: 'var(--color-bg)', color: 'var(--color-text)', minHeight: '100vh' }}>
      {/* Nav */}
      <nav style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-md) var(--space-xl)', maxWidth: 1200, margin: '0 auto' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--color-text-heading)' }}>
          Kimono <span style={{ color: 'var(--color-primary)' }}>BI</span>
        </h1>
        <div style={{ display: 'flex', gap: 'var(--space-md)', alignItems: 'center' }}>
          <Link to="/login" style={{ color: 'var(--color-text-muted)', fontSize: '0.9375rem' }}>Login</Link>
          <Link to="/register" className="btn btn-primary" style={{ fontSize: '0.875rem' }}>Start gratuit</Link>
        </div>
      </nav>

      {/* Hero */}
      <section style={{ textAlign: 'center', padding: 'var(--space-2xl) var(--space-xl)', maxWidth: 900, margin: '0 auto' }}>
        <div style={{ display: 'inline-block', padding: '4px 16px', background: 'rgba(233, 69, 96, 0.12)', borderRadius: 'var(--radius-full)', color: 'var(--color-primary)', fontSize: '0.8125rem', fontWeight: 600, marginBottom: 'var(--space-md)' }}>
          22 module de analytics — 0 setup tax
        </div>
        <h2 style={{ fontSize: '3rem', fontWeight: 800, color: 'var(--color-text-heading)', lineHeight: 1.15, marginBottom: 'var(--space-md)' }}>
          Business Intelligence<br />
          pentru <span style={{ color: 'var(--color-primary)' }}>Shopify</span> & <span style={{ color: '#7e64b5' }}>WooCommerce</span>
        </h2>
        <p style={{ fontSize: '1.25rem', color: 'var(--color-text-muted)', maxWidth: 650, margin: '0 auto var(--space-xl)', lineHeight: 1.6 }}>
          Predictive analytics, AI advisor, profitability tracking, churn prediction — totul intr-o singura platforma. Conecteaza magazinul in 2 minute.
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-md)', justifyContent: 'center' }}>
          <Link to="/register" className="btn btn-primary" style={{ fontSize: '1rem', padding: '14px 32px' }}>
            Incepe gratuit <ArrowRight size={18} />
          </Link>
          <a href="#features" className="btn btn-secondary" style={{ fontSize: '1rem', padding: '14px 32px' }}>
            Vezi features
          </a>
        </div>
        <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginTop: 'var(--space-md)' }}>
          Free forever. Nu necesita card.
        </p>
      </section>

      {/* Social proof */}
      <section style={{ textAlign: 'center', padding: 'var(--space-xl) 0', borderTop: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)' }}>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 'var(--space-2xl)', flexWrap: 'wrap' }}>
          <div><span style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--color-text-heading)' }}>22</span><br /><span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>Module analytics</span></div>
          <div><span style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--color-text-heading)' }}>2</span><br /><span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>Platforme suportate</span></div>
          <div><span style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--color-text-heading)' }}>GPT-4o</span><br /><span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>AI Advisor integrat</span></div>
          <div><span style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--color-text-heading)' }}>2 min</span><br /><span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>Setup complet</span></div>
        </div>
      </section>

      {/* Features grid */}
      <section id="features" style={{ padding: 'var(--space-2xl) var(--space-xl)', maxWidth: 1200, margin: '0 auto' }}>
        <h3 style={{ textAlign: 'center', fontSize: '2rem', fontWeight: 700, color: 'var(--color-text-heading)', marginBottom: 'var(--space-sm)' }}>
          Totul intr-o platforma
        </h3>
        <p style={{ textAlign: 'center', color: 'var(--color-text-muted)', marginBottom: 'var(--space-xl)', fontSize: '1.125rem' }}>
          Features pe care Triple Whale, Lifetimely si Peel le vand separat la $200-500/luna
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 'var(--space-md)' }}>
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <div key={f.name} className="card" style={{ padding: 'var(--space-md)' }}>
                <Icon size={24} style={{ color: 'var(--color-primary)', marginBottom: 'var(--space-sm)' }} />
                <h4 style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-text-heading)', marginBottom: 'var(--space-xs)' }}>{f.name}</h4>
                <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', margin: 0 }}>{f.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Comparison */}
      <section style={{ padding: 'var(--space-2xl) var(--space-xl)', maxWidth: 900, margin: '0 auto' }}>
        <h3 style={{ textAlign: 'center', fontSize: '2rem', fontWeight: 700, color: 'var(--color-text-heading)', marginBottom: 'var(--space-xl)' }}>
          De ce Kimono BI?
        </h3>
        <div className="card" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
                <th style={{ textAlign: 'left', padding: 'var(--space-sm) var(--space-md)', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>Feature</th>
                <th style={{ textAlign: 'center', padding: 'var(--space-sm)', fontSize: '0.8125rem', color: 'var(--color-primary)', fontWeight: 700 }}>Kimono BI</th>
                <th style={{ textAlign: 'center', padding: 'var(--space-sm)', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>Shopify Analytics</th>
                <th style={{ textAlign: 'center', padding: 'var(--space-sm)', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>Triple Whale</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Module analytics', '22', '8', '8'],
                ['Revenue Forecast', 'Da', 'Nu', 'Nu'],
                ['Churn Prediction', 'Da', 'Nu', 'Nu'],
                ['LTV per canal', 'Da', 'Nu', 'Da'],
                ['Contribution Margin', 'Da', 'Doar Advanced ($299/mo)', 'Da'],
                ['AI Advisor', 'GPT-4o, romana', 'Sidekick (english)', 'Nu'],
                ['WooCommerce', 'Da', 'Nu', 'Nu'],
                ['Pret', 'De la $0', 'Inclus ($39-299/mo)', '$129-279/mo'],
              ].map(([feature, us, shopify, tw], i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: 'var(--space-sm) var(--space-md)', fontSize: '0.8125rem' }}>{feature}</td>
                  <td style={{ padding: 'var(--space-sm)', textAlign: 'center', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-success)' }}>{us}</td>
                  <td style={{ padding: 'var(--space-sm)', textAlign: 'center', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>{shopify}</td>
                  <td style={{ padding: 'var(--space-sm)', textAlign: 'center', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>{tw}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" style={{ padding: 'var(--space-2xl) var(--space-xl)', maxWidth: 1100, margin: '0 auto' }}>
        <h3 style={{ textAlign: 'center', fontSize: '2rem', fontWeight: 700, color: 'var(--color-text-heading)', marginBottom: 'var(--space-sm)' }}>Planuri simple</h3>
        <p style={{ textAlign: 'center', color: 'var(--color-text-muted)', marginBottom: 'var(--space-xl)' }}>14 zile trial gratuit pe toate planurile platite</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--space-md)' }}>
          {PLANS.map((plan) => (
            <div key={plan.name} className="card" style={{ textAlign: 'center', border: plan.popular ? '2px solid var(--color-primary)' : undefined, position: 'relative' }}>
              {plan.popular && <div style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', background: 'var(--color-primary)', color: 'white', padding: '2px 12px', borderRadius: 'var(--radius-full)', fontSize: '0.6875rem', fontWeight: 700 }}>POPULAR</div>}
              <h4 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--color-text-heading)' }}>{plan.name}</h4>
              <div style={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--color-text-heading)', margin: 'var(--space-sm) 0' }}>
                {plan.price}<span style={{ fontSize: '0.875rem', fontWeight: 400, color: 'var(--color-text-muted)' }}>{plan.period}</span>
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 var(--space-md)', textAlign: 'left' }}>
                {plan.features.map((f, i) => (
                  <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', padding: '4px 0', fontSize: '0.875rem' }}>
                    <Check size={14} style={{ color: 'var(--color-success)', flexShrink: 0 }} /> {f}
                  </li>
                ))}
              </ul>
              <Link to="/register" className={`btn btn-full ${plan.popular ? 'btn-primary' : 'btn-secondary'}`}>
                Incepe gratuit
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer style={{ textAlign: 'center', padding: 'var(--space-xl)', borderTop: '1px solid var(--color-border)', color: 'var(--color-text-muted)', fontSize: '0.8125rem' }}>
        <p>Kimono BI — Business Intelligence Platform</p>
        <p style={{ marginTop: 'var(--space-xs)' }}>Kimono Group — Baia Mare & Bucuresti</p>
      </footer>
    </div>
  );
}
