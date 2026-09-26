import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData, useSearchParams } from '@remix-run/react';
import { useState, useRef } from 'react';
import { requireUser, requireUserContext } from '~/lib/auth/requireAuth.server';
import { requireModule } from '~/lib/plans.server';
import { db } from '~/lib/db.server';
import { generateForecast } from '~/lib/forecast/index';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

export const meta: MetaFunction = () => [{ title: 'Revenue Forecast — Kimono BI' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const ctx = await requireUserContext(request);
  const user = ctx.user;
  await requireModule(request, ctx.effectiveOwnerId, 'forecast');
  const url = new URL(request.url);
  const storeId = url.searchParams.get('store');
  const horizon = Number(url.searchParams.get('horizon') || 90);
  const historyDays = Number(url.searchParams.get('history') || 60);

  const stores = await db.storeConnection.findMany({
    where: { userId: ctx.effectiveOwnerId },
    select: { id: true, name: true },
  });

  const selectedStoreId = storeId || stores[0]?.id;
  if (!selectedStoreId) return json({ stores, forecast: null, selectedStoreId: null, horizon, historyDays });

  const forecast = await generateForecast(selectedStoreId, horizon);
  // Adjust history slice based on requested historyDays
  const adjustedForecast = {
    ...forecast,
    history: forecast.history.slice(-historyDays),
  };
  return json({ stores, forecast: adjustedForecast, selectedStoreId, horizon, historyDays });
}

const TREND_CONFIG = {
  up: { icon: TrendingUp, color: '#16a34a', label: 'Trend ascendent' },
  down: { icon: TrendingDown, color: '#dc2626', label: 'Trend descendent' },
  flat: { icon: Minus, color: '#525252', label: 'Trend stabil' },
};

export default function ForecastPage() {
  const { stores, forecast, selectedStoreId, horizon, historyDays } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  const updateParam = (key: string, value: string) => {
    const p = new URLSearchParams(searchParams);
    p.set(key, value);
    setSearchParams(p);
  };

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
        <div>
          <h1 className="page-title">Revenue Forecast</h1>
          <p className="page-subtitle">
            Ensemble de 4 modele: baseline + DoW + calendar RO + YoY
            {forecast?.summary.seasonalityDetected && ' · sezonalitate DoW'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select className="form-input" style={{ width: 140 }} value={historyDays} onChange={(e) => updateParam('history', e.target.value)} title="Perioadă istoric">
            <option value={30}>Istoric 30 zile</option>
            <option value={60}>Istoric 60 zile</option>
            <option value={90}>Istoric 90 zile</option>
            <option value={180}>Istoric 180 zile</option>
            <option value={365}>Istoric 1 an</option>
          </select>
          <select className="form-input" style={{ width: 140 }} value={horizon} onChange={(e) => updateParam('horizon', e.target.value)} title="Orizont predicție">
            <option value={30}>Forecast 30 zile</option>
            <option value={60}>Forecast 60 zile</option>
            <option value={90}>Forecast 90 zile</option>
            <option value={180}>Forecast 180 zile</option>
          </select>
          {stores.length > 1 && (
            <select className="form-input" style={{ width: 220 }} value={selectedStoreId || ''} onChange={(e) => updateParam('store', e.target.value)}>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
        </div>
      </div>

      <div className="info-box">
        <p>
          <strong>Ensemble median</strong> din 4 modele: (1) baseline × DoW, (2) calendar sezonier RO cu Black Friday și vară, (3) median DoW recent, (4) YoY same-week scalat. Fiecare zi = median predicțiilor — robust la outlieri.
          Mișcă cursorul peste grafic pentru detalii pe zi.
        </p>
      </div>

      {!forecast ? (
        <div className="card" style={{ textAlign: 'center', padding: '56px 24px' }}>
          <p style={{ color: 'var(--color-muted)' }}>Conecteaza un magazin pentru a vedea forecast-ul.</p>
        </div>
      ) : (
        <ForecastView forecast={forecast} />
      )}
    </div>
  );
}

function ForecastView({ forecast }: { forecast: NonNullable<ReturnType<typeof useLoaderData<typeof loader>>['forecast']> }) {
  const { summary, daily, history, scenarios } = forecast;
  const trend = TREND_CONFIG[summary.trend];
  const TrendIcon = trend.icon;
  const [chartMode, setChartMode] = useState<'daily' | 'weekly'>('daily');

  return (
    <div>
      {/* Metadata bar */}
      <div className="card" style={{ marginBottom: 'var(--space-md)', borderLeft: '6px solid #FF5A1F' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
          <div>
            <div className="mono-label">Baseline zilnic (28z)</div>
            <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'SF Mono, monospace' }}>
              {summary.baseline.toLocaleString('ro-RO')} <span style={{ fontSize: 12, color: '#525252' }}>RON/zi</span>
            </div>
            <div style={{ fontSize: 11, color: '#525252', marginTop: 4 }}>Median: {summary.medianDaily.toLocaleString('ro-RO')}</div>
          </div>
          <div>
            <div className="mono-label">Momentum (14z vs 14z)</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <TrendIcon size={18} style={{ color: trend.color }} />
              <div style={{ fontSize: 20, fontWeight: 800, color: trend.color, fontFamily: 'SF Mono, monospace' }}>
                {summary.trendPercent > 0 ? '+' : ''}{summary.trendPercent}%
              </div>
            </div>
          </div>
          {summary.yoyAvailable && summary.yoyGrowthPct !== undefined && (
            <div>
              <div className="mono-label">YoY</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: summary.yoyGrowthPct >= 0 ? '#16a34a' : '#dc2626', fontFamily: 'SF Mono, monospace', marginTop: 4 }}>
                {summary.yoyGrowthPct > 0 ? '+' : ''}{summary.yoyGrowthPct}%
              </div>
              <div style={{ fontSize: 11, color: '#525252', marginTop: 4 }}>vs acum 1 an</div>
            </div>
          )}
          <div>
            <div className="mono-label">Modele active</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginTop: 4 }}>{summary.modelsUsed.length} / 4</div>
            <div style={{ fontSize: 10, color: '#525252', marginTop: 4, fontFamily: 'SF Mono, monospace' }}>
              {summary.modelsUsed.join(', ')}
            </div>
          </div>
        </div>
      </div>

      {/* Scenarios */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
        <ScenarioCard title="Conservator" subtitle={scenarios.conservative.label} s={scenarios.conservative} color="#dc2626" />
        <ScenarioCard title="Base Case" subtitle={scenarios.base.label} s={scenarios.base} color="#FF5A1F" highlight />
        <ScenarioCard title="Optimistic" subtitle={scenarios.optimistic.label} s={scenarios.optimistic} color="#16a34a" />
      </div>

      {/* Interactive chart */}
      <div className="card" style={{ marginBottom: 'var(--space-md)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700 }}>
            Istoric {history.length} zile vs Forecast {daily.length} zile
          </h3>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 11, fontWeight: 600 }}>
            <div style={{ display: 'flex', gap: 4, border: '2px solid #0a0a0a' }}>
              <button onClick={() => setChartMode('daily')} style={{ padding: '4px 10px', background: chartMode === 'daily' ? '#0a0a0a' : '#fff', color: chartMode === 'daily' ? '#fff' : '#0a0a0a', border: 'none', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>Zilnic</button>
              <button onClick={() => setChartMode('weekly')} style={{ padding: '4px 10px', background: chartMode === 'weekly' ? '#0a0a0a' : '#fff', color: chartMode === 'weekly' ? '#fff' : '#0a0a0a', border: 'none', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>Săptămânal</button>
            </div>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 12, height: 12, background: '#0a0a0a' }} />Istoric</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 12, height: 12, background: '#FF5A1F' }} />Prezis</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 12, height: 12, background: '#FFE8DC' }} />CI 95%</span>
          </div>
        </div>
        <InteractiveChart history={history} forecast={daily} mode={chartMode} />
      </div>

      {/* Weekly aggregates */}
      <div className="card">
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Forecast săptămânal</h3>
        <WeeklyBars daily={daily} />
      </div>
    </div>
  );
}

function ScenarioCard({ title, subtitle, s, color, highlight }: { title: string; subtitle: string; s: { next30: number; next60: number; next90: number }; color: string; highlight?: boolean }) {
  return (
    <div className="card" style={{ borderLeft: `6px solid ${color}`, background: highlight ? '#FFE8DC' : '#ffffff' }}>
      <div className="mono-label" style={{ color }}>{title}</div>
      <div style={{ fontSize: 11, color: '#525252', marginBottom: 12, fontWeight: 600 }}>{subtitle}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Row label="30 zile" value={s.next30} />
        <Row label="60 zile" value={s.next60} />
        <Row label="90 zile" value={s.next90} bold />
      </div>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '1px solid #e5e5e5', paddingBottom: 4 }}>
      <span style={{ fontSize: 12, color: '#525252', fontWeight: 500 }}>{label}</span>
      <span style={{ fontSize: bold ? 18 : 15, fontWeight: bold ? 800 : 700, fontFamily: 'SF Mono, monospace', color: '#0a0a0a' }}>
        {value.toLocaleString('ro-RO')} <span style={{ fontSize: 10, color: '#525252' }}>RON</span>
      </span>
    </div>
  );
}

interface HoverInfo {
  x: number;
  y: number;
  isHistory: boolean;
  date: string;
  actual?: number;
  predicted?: number;
  lower?: number;
  upper?: number;
}

function InteractiveChart({ history, forecast, mode }: {
  history: Array<{ date: string; actual: number }>;
  forecast: Array<{ date: string; predicted: number; lower: number; upper: number }>;
  mode: 'daily' | 'weekly';
}) {
  // Aggregate weekly if mode is weekly
  const displayHistory = mode === 'weekly'
    ? aggregateWeekly(history.map((h) => ({ date: h.date, value: h.actual }))).map((w) => ({ date: w.date, actual: w.value }))
    : history;
  const displayForecast = mode === 'weekly'
    ? aggregateWeeklyForecast(forecast)
    : forecast;

  const [hover, setHover] = useState<HoverInfo | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const allValues = [
    ...displayHistory.map((h) => h.actual),
    ...displayForecast.map((f) => f.upper),
  ];
  const maxV = Math.max(...allValues, 1);
  const W = 960;
  const H = 320;
  const padL = 60;
  const padR = 20;
  const padT = 20;
  const padB = 40;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const totalPoints = displayHistory.length + displayForecast.length;
  const x = (i: number) => padL + (innerW * i) / Math.max(1, totalPoints - 1);
  const y = (v: number) => padT + innerH - (innerH * v) / maxV;

  const histPath = displayHistory.length > 0
    ? displayHistory.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.actual)}`).join(' ')
    : '';

  const fcPath = displayForecast.map((p, i) => {
    const idx = displayHistory.length + i;
    return `${i === 0 ? 'M' : 'L'} ${x(idx)} ${y(p.predicted)}`;
  }).join(' ');

  const upperCoords = displayForecast.map((p, i) => `${x(displayHistory.length + i)} ${y(p.upper)}`);
  const lowerCoords = displayForecast.map((p, i) => `${x(displayHistory.length + i)} ${y(p.lower)}`).reverse();
  const ciPath = displayForecast.length > 0
    ? 'M ' + upperCoords.join(' L ') + ' L ' + lowerCoords.join(' L ') + ' Z'
    : '';

  const yTicks = [0, maxV * 0.25, maxV * 0.5, maxV * 0.75, maxV].map((v) => ({
    v, y: y(v), label: Math.round(v).toLocaleString('ro-RO'),
  }));
  const boundaryX = x(displayHistory.length - 1);

  function handleMove(e: React.MouseEvent) {
    const svg = svgRef.current;
    if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    const relX = svgP.x;
    // Find nearest data point
    if (relX < padL || relX > W - padR) { setHover(null); return; }
    const idx = Math.round(((relX - padL) / innerW) * (totalPoints - 1));
    if (idx < 0 || idx >= totalPoints) { setHover(null); return; }

    if (idx < displayHistory.length) {
      const p = displayHistory[idx];
      setHover({ x: x(idx), y: y(p.actual), isHistory: true, date: p.date, actual: p.actual });
    } else {
      const p = displayForecast[idx - displayHistory.length];
      setHover({ x: x(idx), y: y(p.predicted), isHistory: false, date: p.date, predicted: p.predicted, lower: p.lower, upper: p.upper });
    }
  }

  return (
    <div style={{ position: 'relative', width: '100%', overflow: 'auto' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        style={{ display: 'block', cursor: 'crosshair' }}
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
      >
        {/* Y-axis grid */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={padL} y1={t.y} x2={W - padR} y2={t.y} stroke="#e5e5e5" strokeWidth={1} />
            <text x={padL - 8} y={t.y + 4} textAnchor="end" fontSize="10" fill="#525252" fontFamily="SF Mono, monospace">{t.label}</text>
          </g>
        ))}

        {/* Forecast boundary */}
        <line x1={boundaryX} y1={padT} x2={boundaryX} y2={H - padB} stroke="#0a0a0a" strokeWidth={1.5} strokeDasharray="4 4" />
        <rect x={boundaryX + 2} y={padT} width={48} height={16} fill="#0a0a0a" />
        <text x={boundaryX + 6} y={padT + 12} fontSize="10" fill="#fff" fontWeight="700">ACUM</text>

        {/* CI area */}
        {ciPath && <path d={ciPath} fill="#FFE8DC" stroke="none" />}

        {/* History line */}
        {histPath && <path d={histPath} fill="none" stroke="#0a0a0a" strokeWidth={2} />}

        {/* Forecast line */}
        <path d={fcPath} fill="none" stroke="#FF5A1F" strokeWidth={2.5} />

        {/* X-axis baseline */}
        <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="#0a0a0a" strokeWidth={1.5} />

        {/* X-axis labels */}
        {displayHistory[0] && <text x={padL} y={H - 14} fontSize="10" fill="#525252">{displayHistory[0].date}</text>}
        {displayForecast.at(-1) && <text x={W - padR} y={H - 14} fontSize="10" fill="#525252" textAnchor="end">{displayForecast.at(-1)?.date}</text>}
        <text x={W / 2} y={H - 14} fontSize="10" fill="#525252" textAnchor="middle" fontWeight="600">{mode === 'daily' ? 'Zilnic' : 'Săptămânal'}</text>

        {/* Hover crosshair + dot */}
        {hover && (
          <>
            <line x1={hover.x} y1={padT} x2={hover.x} y2={H - padB} stroke="#0a0a0a" strokeWidth={1} strokeDasharray="2 2" opacity={0.4} />
            <circle cx={hover.x} cy={hover.y} r={5} fill={hover.isHistory ? '#0a0a0a' : '#FF5A1F'} stroke="#fff" strokeWidth={2} />
          </>
        )}
      </svg>

      {hover && (
        <div style={{
          position: 'absolute',
          left: `${(hover.x / W) * 100}%`,
          top: `${(hover.y / H) * 100}%`,
          transform: hover.x > W * 0.7 ? 'translate(-110%, -130%)' : 'translate(10%, -130%)',
          background: '#0a0a0a',
          color: '#fff',
          padding: '10px 14px',
          border: '2px solid #FF5A1F',
          fontFamily: 'SF Mono, Monaco, monospace',
          fontSize: 12,
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
          zIndex: 10,
          minWidth: 180,
        }}>
          <div style={{ fontWeight: 700, marginBottom: 6, letterSpacing: 0.5, borderBottom: '1px solid #525252', paddingBottom: 4 }}>
            {hover.date}
          </div>
          {hover.isHistory ? (
            <div>
              <span style={{ color: '#a3a3a3' }}>Real:</span>{' '}
              <strong style={{ color: '#fff' }}>{hover.actual?.toLocaleString('ro-RO')} RON</strong>
            </div>
          ) : (
            <>
              <div>
                <span style={{ color: '#a3a3a3' }}>Prezis:</span>{' '}
                <strong style={{ color: '#FF5A1F' }}>{hover.predicted?.toLocaleString('ro-RO')} RON</strong>
              </div>
              <div style={{ fontSize: 11, marginTop: 3 }}>
                <span style={{ color: '#a3a3a3' }}>Min:</span> {hover.lower?.toLocaleString('ro-RO')}
              </div>
              <div style={{ fontSize: 11 }}>
                <span style={{ color: '#a3a3a3' }}>Max:</span> {hover.upper?.toLocaleString('ro-RO')}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function aggregateWeekly(data: Array<{ date: string; value: number }>): Array<{ date: string; value: number }> {
  const weeks: Array<{ date: string; value: number }> = [];
  for (let i = 0; i < data.length; i += 7) {
    const slice = data.slice(i, i + 7);
    weeks.push({
      date: slice[0].date,
      value: slice.reduce((s, d) => s + d.value, 0),
    });
  }
  return weeks;
}

function aggregateWeeklyForecast(forecast: Array<{ date: string; predicted: number; lower: number; upper: number }>): Array<{ date: string; predicted: number; lower: number; upper: number }> {
  const weeks: Array<{ date: string; predicted: number; lower: number; upper: number }> = [];
  for (let i = 0; i < forecast.length; i += 7) {
    const slice = forecast.slice(i, i + 7);
    weeks.push({
      date: slice[0].date,
      predicted: slice.reduce((s, d) => s + d.predicted, 0),
      lower: slice.reduce((s, d) => s + d.lower, 0),
      upper: slice.reduce((s, d) => s + d.upper, 0),
    });
  }
  return weeks;
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
            <span style={{ width: 100, fontSize: 12, color: 'var(--color-muted)', fontWeight: 600, flexShrink: 0 }}>
              Săpt {i + 1} <span style={{ fontSize: 10 }}>({w.start.slice(5)})</span>
            </span>
            <div style={{ flex: 1, height: 22, background: '#FAFAFA', border: '2px solid #0a0a0a', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', left: `${lowerPct}%`, width: `${upperPct - lowerPct}%`, height: '100%', background: '#FFE8DC' }} />
              <div style={{ position: 'absolute', left: 0, width: `${pct}%`, height: '100%', background: '#FF5A1F', opacity: 0.9 }} />
            </div>
            <span style={{ width: 120, fontSize: 13, fontWeight: 700, textAlign: 'right', fontFamily: 'SF Mono, monospace' }}>
              {w.total.toLocaleString('ro-RO')} RON
            </span>
          </div>
        );
      })}
    </div>
  );
}
