import React, { useState } from 'react';
import type { MetaFunction } from '@remix-run/node';
import { Link } from '@remix-run/react';
import { PublicNav, PublicFooter } from '~/components/PublicLayout';

export const meta: MetaFunction = () => [
  { title: 'Funcționalități — Kimono BI' },
  { name: 'description', content: 'Toate modulele și funcționalitățile platformei Kimono BI pentru magazine eCommerce.' },
];

const FEATURES = [
  {
    category: 'Analiză & Raportare',
    color: '#D85A30',
    items: [
      {
        name: 'Dashboard live',
        desc: 'KPI-uri în timp real: venituri, comenzi, clienți noi, AOV.',
        details: [
          'KPI-uri principale: Revenue, Nr. comenzi, Clienți noi, AOV, Refund Rate',
          'Comparații automate cu ziua, săptămâna și luna anterioară',
          'Grafice sparkline pentru trend-ul ultimelor 7 și 30 de zile',
          'Disponibil pe toate planurile, inclusiv Free',
        ],
      },
      {
        name: 'Revenue Forecast',
        desc: 'Predicție venituri pe 30/60/90/180 zile cu 4 modele statistice.',
        details: [
          'Ensemble: Holt-Winters, baseline sezonier, day-of-week, Year-over-Year',
          'Interval de încredere 80% și 95% vizualizat pe grafic',
          'Actualizat automat zilnic pe baza datelor noi',
          'Disponibil din planul Starter',
        ],
      },
      {
        name: 'Goal Tracker',
        desc: 'Targeturi automate +10% față de luna anterioară pe 6 KPI-uri.',
        details: [
          '6 KPI-uri monitorizate: Revenue, Orders, AOV, New Customers, Repeat Rate, Margin',
          'Bară de progres cu indicator on track / behind / ahead',
          'Targeturi customizabile manual sau automate',
          'Notificări când atingi sau ratezi targetul lunar',
        ],
      },
      {
        name: 'Comparative Analysis',
        desc: 'Compară orice două perioade pe revenue, comenzi, clienți, AOV.',
        details: [
          'Comparație flexibilă: lună vs lună, an vs an, perioadă customă',
          'Grafice side-by-side cu variații procentuale',
          'Metrici: Revenue, Orders, AOV, Customers, Refund Rate, Margin',
          'Export comparație ca PDF sau CSV',
        ],
      },
    ],
  },
  {
    category: 'Clienți & Segmentare',
    color: '#7c3aed',
    items: [
      {
        name: 'RFM Segmentation',
        desc: '8 segmente automate: Champions, Loyal, At Risk, Lost și altele.',
        details: [
          'Champions, Loyal, Potential Loyalist, Recent, Promising, Need Attention, At Risk, Lost',
          'Scoruri 1-5 pe 3 dimensiuni: Recency, Frequency, Monetary',
          'Recomandări de acțiune specifice per segment',
          'Filtrează și exportă lista de clienți per segment',
        ],
      },
      {
        name: 'Churn Prediction',
        desc: 'Scor de risc 0-100 per client bazat pe recency și frecvență.',
        details: [
          '3 niveluri de risc: Critic (>75), Ridicat (50-75), Mediu (25-50)',
          'Factori de risc vizibili: zile de la ultima comandă, frecvență, trend',
          'Export listă clienți la risc pentru campanii de retenție',
          'Actualizat automat la fiecare sincronizare de date',
        ],
      },
      {
        name: 'Cohort Analysis',
        desc: 'Matrice de retenție pe cohorte lunare de 12 luni.',
        details: [
          'Matrice: câți clienți din cohorta lunii X au mai cumpărat în lunile următoare',
          'Culori automate: verde (retenție >50%) → roșu (<10%)',
          'Identificare automată a cohortelor cu retenție anomalică',
          'Disponibil din planul Starter',
        ],
      },
      {
        name: 'LTV Analytics',
        desc: 'Lifetime Value per client, canal de achiziție și produs.',
        details: [
          'LTV mediu, median și percentile (P25, P50, P75, P90)',
          'Distribuție LTV vizualizată ca histogramă',
          'Breakdown per canal de achiziție și categorie de produs',
          'Repeat rate și intervalul mediu între comenzi',
        ],
      },
      {
        name: 'Repeat Purchase Rate',
        desc: 'Rata de cumpărare repetată și produsele cu cel mai mare loyalty.',
        details: [
          'Rată repeat pe perioade: 30, 60, 90 zile',
          'Interval mediu între comenzi succesive (zile)',
          'Top 10 produse care generează comenzi repetate',
          'Trend repeat rate pe ultimele 12 luni',
        ],
      },
    ],
  },
  {
    category: 'Produse & Stoc',
    color: '#0369a1',
    items: [
      {
        name: 'Smart Alerts (Stoc)',
        desc: 'Monitorizare automată stoc cu 3 niveluri de alertă.',
        details: [
          'Critic (<7 zile stoc), Ridicat (7-14 zile), Mediu (14-30 zile)',
          'Calculat pe velocitatea de vânzare din ultimele 60 zile',
          'Notificări email automate zilnic la 06:00',
          'Recomandări cantitate de reaprovizionare',
        ],
      },
      {
        name: 'BCG Product Matrix',
        desc: 'Clasificare: Stars, Cash Cows, Question Marks, Dogs.',
        details: [
          'Axe: rata de creștere vânzări vs. cotă relativă de piață',
          'Vizualizare bubble chart interactivă',
          'Recomandări strategice per categorie BCG',
          'Filtru pe categorii de produse și perioade',
        ],
      },
      {
        name: 'Basket Analysis',
        desc: 'Produse cumpărate frecvent împreună. Cross-sell și bundle-uri.',
        details: [
          'Metrici: suport, confidence și lift per pereche de produse',
          'Top 10 combinări cele mai frecvente și profitabile',
          'Recomandări automate de bundle-uri și cross-sell',
          'Vizualizare matrice de asocieri',
        ],
      },
      {
        name: 'Stockout Detection',
        desc: 'Produse la stoc 0 cu vânzări recente. Estimare pierderi.',
        details: [
          'Monitorizare real-time produse cu stoc 0 și cerere activă',
          'Estimare pierdere zilnică de venituri per produs',
          'Alertă automată la detectarea stockout-ului',
          'Istoric stockout-uri și impactul financiar total',
        ],
      },
      {
        name: 'Pricing Intelligence',
        desc: 'Relația preț-volum. Produse cu potențial de creștere preț.',
        details: [
          'Analiza elasticității preț-cerere per produs',
          'Comparație marjă vs. volum pe categorii',
          'Identificare produse unde prețul poate crește fără impact pe volum',
          'Trend prețuri medii pe ultimele 12 luni',
        ],
      },
    ],
  },
  {
    category: 'Financiar & Profitabilitate',
    color: '#0F6E56',
    items: [
      {
        name: 'Profit Margin Analysis',
        desc: 'Marjă brută pe produs, categorie și comandă. Import costuri.',
        details: [
          'Marjă brută calculată pe produs, categorie și comandă',
          'Import costuri per unitate din CSV sau intrare manuală',
          'Identificare produse cu marjă negativă sau sub prag',
          'Trend marjă pe ultimele 12 luni cu breakdown pe categorii',
        ],
      },
      {
        name: 'Discount Intelligence',
        desc: 'Impactul discounturilor: rate de utilizare, impact pe marjă.',
        details: [
          'Rata de utilizare coduri de discount per perioadă',
          'Impact pe revenue, marjă brută și AOV',
          'Top 10 coduri de discount și performanța lor',
          'Comparație comenzi cu/fără discount',
        ],
      },
      {
        name: 'Refund Analytics',
        desc: 'Rata de refund per produs, categorie, perioadă.',
        details: [
          'Rată refund: totală, per produs și per categorie',
          'Impact financiar total al refund-urilor pe perioadă',
          'Top produse cu cea mai mare rată de returnare',
          'Trend refund rate pe ultimele 12 luni',
        ],
      },
      {
        name: 'Turnover Analysis',
        desc: 'Viteza de rotație stoc. Zile de stoc per produs.',
        details: [
          'Days of Inventory (DOI) per produs și categorie',
          'Dead stock: produse fără vânzări în 90+ zile',
          'Valoare capital imobilizat în stoc lent',
          'Recomandări de lichidare și reduceri',
        ],
      },
      {
        name: 'Fulfilment Analytics',
        desc: 'Timp procesare și livrare. Performanță per curier.',
        details: [
          'Order-to-ship: timp mediu de procesare comandă',
          'Ship-to-deliver: timp mediu livrare',
          'Rată de livrare la timp per curier',
          'Performanță per regiune geografică (județ)',
        ],
      },
    ],
  },
  {
    category: 'AI & Automatizare',
    color: '#854F0B',
    items: [
      {
        name: 'Ask AI',
        desc: 'Chat GPT-4o antrenat pe datele magazinului tău.',
        details: [
          'Context automat: vânzări 7 zile, stoc critic, RFM, forecast',
          'Exemple: \"Ce produse să promovez?\" \"De ce au scăzut vânzările?\"',
          'Starter: 50 întrebări/lună, Growth+: nelimitat',
          'Răspunsuri în română sau engleză',
        ],
      },
      {
        name: 'AI Narrative Reports',
        desc: 'Raport săptămânal automat: ce s-a întâmplat, ce să faci.',
        details: [
          'Generat automat luni dimineața, livrat pe email',
          'Secțiuni: Rezumat, Anomalii, Recomandări, Oportunități',
          'Export PDF cu branding personalizat',
          'Disponibil în română și engleză — din planul Growth',
        ],
      },
      {
        name: 'Anomaly Detection',
        desc: 'Detecție automată zilnică a anomaliilor. Day-of-Week aware.',
        details: [
          'Nu alertează fals: ține cont de ziua săptămânii și sezonalitate',
          'Sensibilitate configurabilă: 1σ, 2σ, 3σ',
          'Istoric anomalii cu trend pe ultimele 30 de zile',
          'Notificări email la detectarea anomaliei',
        ],
      },
      {
        name: 'Smart Alerts (AI)',
        desc: 'Notificări proactive: scădere conversie, trend negativ.',
        details: [
          'Pattern recognition pe metrici cheie',
          'Categorii: conversie, refunduri, stoc, churn, revenue',
          'Integrare cu email (Slack în curând)',
          'Frecvență configurabilă: zilnic sau săptămânal',
        ],
      },
      {
        name: 'Peak & Seasonality',
        desc: 'Heatmap vânzări pe ore și zile. Cele mai bune momente.',
        details: [
          'Heatmap interactiv: ore x zile din săptămână',
          'Identificare luni și săptămâni de vârf',
          'Corelație cu campaniile de marketing active',
          'Recomandări de programare campanii la orele optime',
        ],
      },
    ],
  },
  {
    category: 'Integrări',
    color: '#5a8a00',
    items: [
      {
        name: 'Shopify',
        desc: 'Conectare via Admin API. Webhooks real-time.',
        details: [
          'Conectare un-click via Shopify OAuth',
          'Import: comenzi, produse, clienți, stoc, categorii',
          'Webhooks pentru sincronizare în timp real',
          'Permisiuni: read_orders, read_products, read_customers',
        ],
      },
      {
        name: 'eMag Marketplace',
        desc: 'Import comenzi și produse eMag. Multi-cont.',
        details: [
          'Import comenzi și produse din contul eMag Marketplace',
          'Suport multi-cont (mai multe magazine eMag)',
          'Sincronizare automată zilnică',
          'Mapare automată categorii eMag → categorii interne',
        ],
      },
      {
        name: 'Google Analytics 4',
        desc: 'Sesiuni, surse trafic, conversii GA4.',
        details: [
          'Conectare via Google OAuth în 2 minute',
          'Import: sesiuni, surse trafic, conversii, bounce rate',
          'Corelație automată: surse trafic ↔ vânzări',
          'Dashboard combinat: marketing spend vs. revenue',
        ],
      },
    ],
  },
];

export default function FunctionalitatiPage() {
  const [expanded, setExpanded] = useState<string | null>(null);

  const toggle = (name: string) => {
    setExpanded((prev) => (prev === name ? null : name));
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-page)', fontFamily: 'Inter, sans-serif' }}>
      <PublicNav />

      {/* Hero */}
      <div style={{ padding: 'clamp(48px, 7vw, 72px) clamp(20px, 5vw, 32px) clamp(40px, 6vw, 56px)', textAlign: 'center', background: 'linear-gradient(180deg, #FFF5F0 0%, var(--bg-page) 100%)' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', background: 'white', border: '0.5px solid rgba(216,90,48,0.3)', borderRadius: 999, fontSize: 11, color: 'var(--kimono-orange)', fontWeight: 600, marginBottom: 20, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Platforma completă
        </div>
        <h1 style={{ fontSize: 'clamp(28px,4vw,42px)', fontWeight: 500, letterSpacing: '-1px', color: 'var(--text-primary)', margin: '0 auto 16px', maxWidth: 680 }}>
          Tot ce ai nevoie pentru a <span style={{ color: 'var(--kimono-orange)' }}>înțelege și crește</span> afacerea ta
        </h1>
        <p style={{ fontSize: 16, color: 'var(--text-secondary)', margin: '0 auto 12px', maxWidth: 560, lineHeight: 1.6 }}>
          29 de module de analiză, AI integrat, alerte automate și rapoarte în română. Dă click pe orice modul pentru detalii.
        </p>
        <Link to="/register" style={{ display: 'inline-block', padding: '11px 24px', background: 'var(--kimono-orange)', color: 'white', borderRadius: 8, fontSize: 14, fontWeight: 500, textDecoration: 'none' }}>
          Încearcă gratuit 14 zile →
        </Link>
      </div>

      {/* Features */}
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '0 clamp(20px, 5vw, 32px) clamp(48px, 8vw, 80px)' }}>
        {FEATURES.map((cat) => (
          <div key={cat.category} style={{ marginBottom: 48 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              <div style={{ width: 3, height: 22, background: cat.color, borderRadius: 2 }} />
              <h2 style={{ fontSize: 17, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>{cat.category}</h2>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
              {cat.items.map((item) => {
                const isOpen = expanded === item.name;
                return (
                  <React.Fragment key={item.name}>
                    <div
                      onClick={() => toggle(item.name)}
                      style={{
                        background: isOpen ? 'var(--bg-page)' : 'white',
                        border: isOpen ? '1.5px solid ' + cat.color : '0.5px solid var(--border-default)',
                        borderRadius: 10,
                        padding: '16px 18px',
                        borderLeft: '3px solid ' + cat.color,
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>{item.name}</div>
                          <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>{item.desc}</p>
                        </div>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                          style={{ flexShrink: 0, marginTop: 2, marginLeft: 8, color: isOpen ? cat.color : 'var(--text-tertiary)', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </div>
                    </div>
                    {isOpen && item.details && (
                      <div style={{
                        gridColumn: '1 / -1',
                        background: 'white',
                        border: '1.5px solid ' + cat.color,
                        borderRadius: 10,
                        padding: '20px 24px',
                        display: 'flex',
                        gap: 24,
                        alignItems: 'flex-start',
                      }}>
                        <div style={{ width: 4, background: cat.color, borderRadius: 2, alignSelf: 'stretch', flexShrink: 0 }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                            <div style={{ fontSize: 15, fontWeight: 600, color: cat.color }}>{item.name}</div>
                            <button onClick={(e) => { e.stopPropagation(); setExpanded(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: 16, padding: '2px 6px' }}>&times;</button>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '8px 32px' }}>
                            {item.details.map((d: string, i: number) => (
                              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, marginTop: 2 }}>
                                  <circle cx="8" cy="8" r="8" fill={cat.color} opacity="0.12" />
                                  <path d="M5 8l2 2 4-4" stroke={cat.color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                                <span style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{d}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        ))}

        <div style={{ textAlign: 'center', padding: '40px 0 0' }}>
          <h2 style={{ fontSize: 22, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 12, letterSpacing: '-0.5px' }}>Pregătit să începi?</h2>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 20 }}>Trial gratuit 14 zile, fără card. Setup în 2 minute.</p>
          <Link to="/register" style={{ display: 'inline-block', padding: '12px 28px', background: 'var(--kimono-orange)', color: 'white', borderRadius: 8, fontSize: 14, fontWeight: 500, textDecoration: 'none' }}>
            Creează cont gratuit →
          </Link>
        </div>
      </div>

      <PublicFooter />
    </div>
  );
}
