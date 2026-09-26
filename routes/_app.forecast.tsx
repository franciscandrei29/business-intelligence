import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData, useSearchParams } from '@remix-run/react';
import { requireUser } from '~/lib/auth/requireAuth.server';
import { db } from '~/lib/db.server';
import { generateForecast } from '~/lib/forecast/index';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

export const meta: MetaFunction = () => [{ title: 'Revenue Forecast — Kimono BI' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const url = new URL(request.url);
  const storeId = url.searchParams.get('store');

  const stores = await db.storeConnection.findMany({
    where: { userId: user.id },
    select: { id: true, name: true },
  });

  const selectedStoreId = storeId || stores[0]?.id;
  if (!selectedStoreId) return json({ stores, forecast: null, selectedStoreId: null });

  const forecast = await generateForecast(selectedStoreId);
  return json({ stores, forecast, selectedStoreId });
}

const TREND_CONFIG = {
  up: { icon: TrendingUp, color: '#16a34a', label: 'Trend ascendent' },
  down: { icon: TrendingDown, color: '#dc2626', label: 'Trend descendent' },
  flat: { icon: Minus, color: '#525252', label: 'Trend stabil' },
};

export default function ForecastPage() {
  const { stores, forecast, selectedStoreId } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
        <div>
          <h1 className="page-title">Revenue Forecast</h1>
          <p className="page-subtitle">
            Holt-Winters cu sezonalitate saptamanala
            {forecast?.summary.seasonalityDetected && ' · sezonalitate detectata'}
          </p>
        </div>
        {stores.length > 1 && (
          <select className="form-input" style={{ width: 220 }} value={selectedStoreId || ''} onChange={(e) => setSearchParams({ store: e.target.value })}>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </div>

      <div className="info-box">
        <p>
          Predictia combina trendul recent cu pattern-ul saptamanal (luni/joi vand mai mult etc). Intervalul de incredere 95% arata gama probabila. Metoda: <strong>Holt-Winters aditiv</strong>, damped trend pentru orizonturi lungi.
        </p>
      </div>

      {!forecast ? (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}>
          <p style={{ color: 'var(--color-muted)' }}>Conecteaza un magazin pentru a vedea forecast-ul.</p>
        </div>
      ) : (
        <ForecastView forecast={forecast} />
      )}
    </div>
  );
}

function ForecastView({ forecast }: { forecast: NonNullable<ReturnType<typeof useLoaderData<typeof loader>>['forecast']> }) {
  const { summary, daily, history } = forecast;
  const trend = TREND_CONFIG[summary.trend];
  const TrendIcon = trend.icon;

  return (
    <div>
      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--space-md)', marginBottom: 'var(--space-xl)' }}>
        <div className="card">
          <div className="mono-label">Urmatoarele 30 zile</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--color-black)', fontFamily: 'SF Mono, Monaco, monospace', marginTop: 4 }}>
            {summary.next30.toLocaleString('ro-RO')}
            <span style={{ fontSize: 14, color: 'var(--color-muted)', marginLeft: 6 }}>RON</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 4 }}>
            CI 95%: {summary.confidenceLow30.toLocaleString('ro-RO')} – {summary.confidenceHigh30.toLocaleString('ro-RO')} RON
          </div>
        </div>
        <div className="card">
          <div className="mono-label">Comparatie vs 30z precedent</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <TrendIcon size={22} style={{ color: trend.color }} />
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: trend.color, fontFamily: 'SF Mono, Monaco, monospace' }}>
              {summary.growthPct30 > 0 ? '+' : ''}{summary.growthPct30}%
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 4 }}>
            Prev: {summary.prev30.toLocaleString('ro-RO')} RON
          </div>
        </div>
        <div className="card">
          <div className="mono-label">Urmatoarele 60 zile</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--color-black)', fontFamily: 'SF Mono, Monaco, monospace', marginTop: 4 }}>
            {summary.next60.toLocaleString('ro-RO')}
            <span style={{ fontSize: 14, color: 'var(--color-muted)', marginLeft: 6 }}>RON</span>
          </div>
        </div>
        <div className="card">
          <div className="mono-label">Urmatoarele 90 zile</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--color-black)', fontFamily: 'SF Mono, Monaco, monospace', marginTop: 4 }}>
            {summary.next90.toLocaleString('ro-RO')}
            <span style={{ fontSize: 14, color: 'var(--color-muted)', marginLeft: 6 }}>RON</span>
          </div>
        </div>
      </div>

      {/* Combined chart (history + forecast) */}
      <div className="card" style={{ marginBottom: 'var(--space-md)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700 }}>Istoric 60 zile vs Forecast 90 zile</h3>
          <div style={{ display: 'flex', gap: 12, fontSize: 11, fontWeight: 600 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 12, height: 12, background: '#0a0a0a', display: 'inline-block' }} />Istoric</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 12, height: 12, background: '#FF5A1F', display: 'inline-block' }} />Prezis</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 12, height: 12, background: '#FFE8DC', display: 'inline-block' }} />Interval 95%</span>
          </div>
        </div>
        <Chart history={history} forecast={daily} />
      </div>

      {/* Weekly aggregates */}
      <div className="card">
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Forecast saptamanal (urmatoarele 13 sapt)</h3>
        <WeeklyBars daily={daily} />
      </div>
    </div>
  );
}

function Chart({ history, forecast }: { history: Array<{ date: string; actual: number }>; forecast: Array<{ date: string; predicted: number; lower: number; upper: number }> }) {
  const allValues = [
    ...history.map((h) => h.actual),
    ...forecast.map((f) => f.upper),
  ];
  const maxV = Math.max(...allValues, 1);
  const W = 960;
  const H = 240;
  const padL = 44;
  const padR = 12;
  const padT = 12;
  const padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const totalPoints = history.length + forecast.length;
  const x = (i: number) => padL + (innerW * i) / Math.max(1, totalPoints - 1);
  const y = (v: number) => padT + innerH - (innerH * v) / maxV;

  // History path
  const histPath = history.length > 0
    ? history.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.actual)}`).join(' ')
    : '';

  // Forecast path and CI area
  const fcPath = forecast.map((p, i) => {
    const idx = history.length + i;
    return `${i === 0 ? 'M' : 'L'} ${x(idx)} ${y(p.predicted)}`;
  }).join(' ');

  const upperPath = forecast.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(history.length + i)} ${y(p.upper)}`).join(' ');
  const lowerPath = forecast.map((p, i) => `${i === forecast.length - 1 ? 'L' : i === 0 ? 'L' : 'L'} ${x(history.length + i)} ${y(p.lower)}`).reverse().join(' ');
  const ciArea = upperPath + ' ' + lowerPath + ' Z';

  // Y-axis labels
  const yTicks = [0, maxV / 2, maxV].map((v) => ({ v, y: y(v), label: Math.round(v).toLocaleString('ro-RO') }));
  const boundaryX = x(history.length - 1);

  return (
    <div style={{ width: '100%', overflow: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block' }}>
        {/* Grid */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={padL} y1={t.y} x2={W - padR} y2={t.y} stroke="#e5e5e5" strokeWidth={1} />
            <text x={padL - 6} y={t.y + 4} textAnchor="end" fontSize="10" fill="#525252" fontFamily="SF Mono, monospace">{t.label}</text>
          </g>
        ))}
        {/* Boundary */}
        <line x1={boundaryX} y1={padT} x2={boundaryX} y2={H - padB} stroke="#0a0a0a" strokeWidth={1} strokeDasharray="4 4" />
        <text x={boundaryX + 4} y={padT + 12} fontSize="10" fill="#525252" fontWeight="600">ACUM</text>
        {/* CI */}
        <path d={ciArea} fill="#FFE8DC" stroke="none" />
        {/* History */}
        {histPath && <path d={histPath} fill="none" stroke="#0a0a0a" strokeWidth={2} />}
        {/* Forecast */}
        <path d={fcPath} fill="none" stroke="#FF5A1F" strokeWidth={2.5} />
        {/* X-axis */}
        <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="#0a0a0a" strokeWidth={1} />
        {/* Start/end labels */}
        {history[0] && <text x={padL} y={H - 8} fontSize="10" fill="#525252">{history[0].date}</text>}
        {forecast.at(-1) && <text x={W - padR} y={H - 8} fontSize="10" fill="#525252" textAnchor="end">{forecast.at(-1)?.date}</text>}
      </svg>
    </div>
  );
}

function WeeklyBars({ daily }: { daily: Array<{ date: string; predicted: number; lower: number; upper: number }> }) {
  const weeks: Array<{ start: string; total: number; avg: number; lower: number; upper: number }> = [];
  for (let i = 0; i < daily.length; i += 7) {
    const slice = daily.slice(i, i + 7);
    const total = slice.reduce((s, d) => s + d.predicted, 0);
    const lower = slice.reduce((s, d) => s + d.lower, 0);
    const upper = slice.reduce((s, d) => s + d.upper, 0);
    weeks.push({ start: slice[0].date, total: Math.round(total), avg: Math.round(total / slice.length), lower: Math.round(lower), upper: Math.round(upper) });
  }
  const maxW = Math.max(...weeks.map((w) => w.upper));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {weeks.map((w, i) => {
        const pct = (w.total / Math.max(1, maxW)) * 100;
        const upperPct = (w.upper / Math.max(1, maxW)) * 100;
        const lowerPct = (w.lower / Math.max(1, maxW)) * 100;
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 90, fontSize: 12, color: 'var(--color-muted)', fontWeight: 600, flexShrink: 0 }}>
              Sapt {i + 1} <span style={{ fontSize: 10 }}>({w.start.slice(5)})</span>
            </span>
            <div style={{ flex: 1, height: 22, background: '#FAFAFA', border: '2px solid #0a0a0a', position: 'relative', overflow: 'hidden' }}>
              {/* CI band */}
              <div style={{ position: 'absolute', left: `${lowerPct}%`, width: `${upperPct - lowerPct}%`, height: '100%', background: '#FFE8DC' }} />
              {/* Predicted bar */}
              <div style={{ position: 'absolute', left: 0, width: `${pct}%`, height: '100%', background: '#FF5A1F', opacity: 0.9 }} />
            </div>
            <span style={{ width: 110, fontSize: 13, fontWeight: 700, textAlign: 'right', fontFamily: 'SF Mono, monospace' }}>
              {w.total.toLocaleString('ro-RO')} RON
            </span>
          </div>
        );
      })}
    </div>
  );
}
