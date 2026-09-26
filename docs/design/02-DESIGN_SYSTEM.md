# 02 - Design System v2

Sistemul de design complet pentru platforma Kimono BI si landing page-ul `bi.kimonogroup.ro`. Inspirat din Stripe Dashboard cu identitate Kimono Group.

## Filozofie

Trei principii non-negociabile:

1. **Claritate peste densitate** - whitespace generos, ierarhie tipografica clara
2. **Insights inainte de date** - fiecare numar are context narativ
3. **Disciplina cromatica** - portocaliul Kimono folosit chirurgical

## Design Tokens (CSS Variables)

```css
:root {
  /* Brand Kimono */
  --kimono-orange: #D85A30;
  --kimono-orange-hover: #BA4A26;
  --kimono-orange-active: #993C1D;
  --kimono-orange-bg: #FFF5F0;
  --kimono-orange-bg-strong: #FAECE7;
  --kimono-orange-border: #F5C4B3;
  --kimono-orange-text: #993C1D;
  --kimono-orange-text-dark: #4A1B0C;

  /* Surfaces */
  --bg-page: #FAFAF9;
  --bg-card: #FFFFFF;
  --bg-subtle: #FAFAF9;
  --bg-tertiary: #F1EFE8;
  --bg-dark: #1A1A1A;
  --bg-darkest: #0A0A0A;

  /* Borders */
  --border-default: #EAEAEA;
  --border-strong: #D3D1C7;
  --border-focus: #D85A30;

  /* Text */
  --text-primary: #1A1A1A;
  --text-secondary: #5F5E5A;
  --text-tertiary: #888780;
  --text-muted: #B4B2A9;
  --text-inverse: #FFFFFF;

  /* Success */
  --success-bg: #E1F5EE;
  --success-bg-strong: #1D9E75;
  --success-bg-dark: #0F6E56;
  --success-border: #5DCAA5;
  --success-text: #0F6E56;
  --success-text-dark: #085041;

  /* Warning */
  --warning-bg: #FAEEDA;
  --warning-bg-strong: #EF9F27;
  --warning-text: #854F0B;
  --warning-text-dark: #633806;

  /* Danger */
  --danger-bg: #FCEBEB;
  --danger-bg-strong: #E24B4A;
  --danger-text: #A32D2D;
  --danger-text-dark: #791F1F;

  /* Info */
  --info-bg: #E6F1FB;
  --info-bg-strong: #378ADD;
  --info-text: #185FA5;
  --info-text-dark: #042C53;

  /* Accent secondary (sparklines, charts) */
  --accent-purple: #7F77DD;
  --accent-purple-bg: #EEEDFE;
  --accent-pink: #D4537E;
  --accent-pink-bg: #FBEAF0;

  /* Spacing */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-7: 28px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;
  --space-20: 80px;

  /* Border radius */
  --radius-xs: 4px;
  --radius-sm: 5px;
  --radius-md: 7px;
  --radius-lg: 10px;
  --radius-xl: 12px;
  --radius-2xl: 16px;
  --radius-pill: 999px;

  /* Typography */
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', 'SF Mono', Consolas, monospace;

  /* Shadows */
  --shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.04);
  --shadow-sm: 0 2px 4px rgba(0, 0, 0, 0.04);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.06);
  --shadow-lg: 0 20px 40px rgba(0, 0, 0, 0.04);
  --shadow-focus: 0 0 0 3px rgba(216, 90, 48, 0.15);

  /* Transitions */
  --transition-fast: 120ms ease;
  --transition-default: 200ms ease;
  --transition-slow: 300ms ease;
}
```

## Typography Scale

| Size | Weight | Letter-spacing | Line-height | Use case |
|------|--------|----------------|-------------|----------|
| 48px | 500 | -1.5px | 1.1 | Landing hero |
| 36px | 500 | -1px | 1.15 | Landing section titles |
| 24px | 500 | -0.6px | 1.2 | App page titles |
| 26px | 500 | -0.7px | 1.1 | Big numbers (carduri principale) |
| 22px | 500 | -0.5px | 1.1 | Big numbers (carduri secundare) |
| 18px | 500 | -0.5px | 1.3 | Section headers |
| 17px | 500 | -0.3px | 1.4 | Step titles in landing |
| 15px | 500 | -0.2px | 1.4 | Card titles |
| 14px | 500 | normal | 1.4 | Strong body text |
| 13.5px | 400 | normal | 1.5 | Body text |
| 13px | 400 | normal | 1.5 | Standard text |
| 12px | 400 | normal | 1.5 | Secondary info |
| 11px | 400 | normal | 1.4 | Captions |
| 10px | 500 | 0.5px uppercase | 1.4 | Micro labels |

**Reguli stricte tipografie:**

- Numere mari: intotdeauna `font-weight: 500`, `letter-spacing: -0.5px` sau mai mic
- NU folosi 600 sau 700, doar 400 si 500
- Sentence case peste tot. ALL CAPS doar pentru micro-labels (uppercase 10px cu letter-spacing 0.5px)
- NU folosi m-dash (em dash). Doar liniute normale (-) sau virgule.

## Componente UI

### Buttons

4 variants: `primary`, `secondary`, `dark`, `ghost`. Plus 2 sizes: `default` si `lg`.

```css
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: var(--radius-md);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
  border: none;
}
.btn--primary {
  background: var(--kimono-orange);
  color: white;
}
.btn--primary:hover { background: var(--kimono-orange-hover); }

.btn--secondary {
  background: white;
  color: var(--text-primary);
  border: 0.5px solid var(--border-default);
}
.btn--secondary:hover { background: var(--bg-subtle); }

.btn--dark {
  background: var(--bg-dark);
  color: white;
}
.btn--dark:hover { background: #2C2C2A; }

.btn--ghost {
  background: transparent;
  color: var(--text-secondary);
}
.btn--ghost:hover { color: var(--text-primary); }

.btn--lg {
  padding: 12px 22px;
  font-size: 14px;
  border-radius: var(--radius-lg);
}
```

### KPI Card

Card cu label, numar mare, trend pill, context narativ, sparkline optional.

```css
.kpi-card {
  background: var(--bg-card);
  border: 0.5px solid var(--border-default);
  border-radius: var(--radius-xl);
  padding: 18px 18px 0;
  overflow: hidden;
}
.kpi-card__number {
  font-size: 24px;
  font-weight: 500;
  letter-spacing: -0.7px;
  color: var(--text-primary);
}
.kpi-card .sparkline {
  margin: 12px -18px 0;
  display: block;
  width: calc(100% + 36px);
}
```

### Health Score Card (special)

Variant special pentru Health Score - background verde inchis cu progress segments.

```css
.health-card {
  background: var(--success-bg-dark);
  color: white;
  border-radius: var(--radius-xl);
  padding: 18px;
}
.health-card__segments {
  display: flex;
  gap: 3px;
  margin-top: 10px;
}
.health-card__segment {
  flex: 1;
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.2);
}
.health-card__segment--filled {
  background: var(--success-border);
}
```

### Trend Pill

Pill verde/rosu cu sageata si procentaj.

```css
.trend {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 12px;
  font-weight: 500;
}
.trend--up { color: var(--success-text); }
.trend--down { color: var(--danger-text); }
```

### Category Badge

Pentru AI insights si alerts.

```css
.category-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.category-badge--urgent { background: var(--kimono-orange-bg); color: var(--kimono-orange-text); }
.category-badge--warning { background: var(--warning-bg); color: var(--warning-text); }
.category-badge--success { background: var(--success-bg); color: var(--success-text); }
.category-badge--info { background: var(--info-bg); color: var(--info-text); }

.category-badge__dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
}
.category-badge--urgent .category-badge__dot { background: var(--kimono-orange); }
.category-badge--warning .category-badge__dot { background: var(--warning-bg-strong); }
.category-badge--success .category-badge__dot { background: var(--success-bg-strong); }
.category-badge--info .category-badge__dot { background: var(--info-bg-strong); }
```

### Insight Card (pentru AI Advisor)

Card complet cu border-left semantic, header, descriere, metrics, actions.

```
Structura:
- Border-left 3px (culoare semantica)
- Header row: category badge + timestamp + confidence + more menu
- Title (15+ cuvinte narrativa)
- Description cu numere bold inline
- Metrics box (gray bg, 3 metrics)
- Actions row: primary CTA + secondary + ghost
```

### Sidebar (App)

Sidebar alb cu sectiuni grupate.

```css
.sidebar {
  background: white;
  border-right: 0.5px solid var(--border-default);
  padding: 16px 12px;
  display: flex;
  flex-direction: column;
  width: 220px;
}
.sidebar__item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 10px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--text-primary);
  cursor: pointer;
  transition: background var(--transition-fast);
}
.sidebar__item:hover { background: var(--bg-subtle); }
.sidebar__item--active {
  background: var(--kimono-orange-bg);
  color: var(--kimono-orange);
  font-weight: 500;
}
.sidebar__item-badge {
  margin-left: auto;
  background: var(--kimono-orange);
  color: white;
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 8px;
  font-weight: 500;
  min-width: 14px;
  text-align: center;
}
.sidebar__section-label {
  font-size: 10px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 1px;
  margin: 18px 10px 6px;
  font-weight: 500;
}
```

### Workspace Switcher (in sidebar top)

```css
.workspace-switcher {
  background: var(--bg-subtle);
  border: 0.5px solid var(--border-default);
  border-radius: var(--radius-lg);
  padding: 8px 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}
.workspace-switcher__icon {
  width: 22px;
  height: 22px;
  background: var(--kimono-orange);
  border-radius: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 500;
  font-size: 10px;
  color: white;
}
```

### Tabs (filter tabs)

Pattern pentru filtrare in liste (Toate / Urgent / Oportunitati / etc.)

```css
.tabs {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px;
  background: white;
  border: 0.5px solid var(--border-default);
  border-radius: var(--radius-lg);
}
.tab {
  padding: 5px 12px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
}
.tab--active {
  background: var(--kimono-orange-bg);
  color: var(--kimono-orange);
  font-weight: 500;
}
```

### Segmented Control (pentru time ranges)

```css
.segmented {
  display: flex;
  gap: 4px;
  padding: 3px;
  background: var(--bg-subtle);
  border-radius: var(--radius-md);
}
.segmented__option {
  padding: 4px 10px;
  border-radius: var(--radius-sm);
  font-size: 11px;
  color: var(--text-tertiary);
  cursor: pointer;
}
.segmented__option--active {
  background: white;
  color: var(--text-primary);
  font-weight: 500;
  box-shadow: var(--shadow-xs);
}
```

### Data Table

```css
.data-table {
  width: 100%;
  font-size: 12px;
  border-collapse: collapse;
}
.data-table th {
  text-align: left;
  padding: 10px 0;
  color: var(--text-tertiary);
  font-weight: 500;
  font-size: 11px;
  border-bottom: 0.5px solid var(--border-default);
}
.data-table td {
  padding: 10px 0;
  border-bottom: 0.5px solid var(--bg-tertiary);
}
.data-table tr:last-child td {
  border-bottom: none;
}
```

### Avatar

```css
.avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 500;
}
.avatar--orange { background: var(--kimono-orange-bg); color: var(--kimono-orange-text); }
.avatar--green { background: var(--success-bg); color: var(--success-text); }
.avatar--blue { background: var(--info-bg); color: var(--info-text); }
.avatar--purple { background: var(--accent-purple-bg); color: #534AB7; }
.avatar--pink { background: var(--accent-pink-bg); color: var(--accent-pink); }
.avatar--gray { background: var(--bg-tertiary); color: var(--text-secondary); }
```

Distributia avatar colors trebuie sa fie consistenta per user (hash din user ID determina culoarea).

### Forms

```css
.input {
  padding: 8px 12px;
  border: 0.5px solid var(--border-default);
  border-radius: var(--radius-md);
  font-size: 13px;
  font-family: var(--font-sans);
  width: 100%;
  background: white;
  transition: all var(--transition-fast);
  box-sizing: border-box;
}
.input:focus {
  outline: none;
  border-color: var(--kimono-orange);
  box-shadow: var(--shadow-focus);
}

.label {
  display: block;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 5px;
}
```

### Toggle Switch

```css
.toggle {
  width: 36px;
  height: 20px;
  border-radius: 10px;
  padding: 2px;
  background: var(--border-strong);
  transition: background var(--transition-default);
  cursor: pointer;
}
.toggle--on { background: var(--success-bg-strong); }
.toggle__handle {
  width: 16px;
  height: 16px;
  background: white;
  border-radius: 50%;
  transition: margin var(--transition-default);
}
.toggle--on .toggle__handle { margin-left: auto; }
```

### Modal

```css
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(26, 26, 26, 0.4);
  backdrop-filter: blur(2px);
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
}
.modal {
  background: white;
  border-radius: var(--radius-2xl);
  box-shadow: var(--shadow-lg);
  max-width: 540px;
  width: 90%;
  padding: 28px;
}
```

### Empty State

```css
.empty-state {
  text-align: center;
  padding: 48px 24px;
}
.empty-state__icon {
  width: 56px;
  height: 56px;
  background: var(--bg-subtle);
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 16px;
  color: var(--text-tertiary);
}
.empty-state__title {
  font-size: 15px;
  font-weight: 500;
  margin: 0 0 6px;
}
.empty-state__description {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0 0 20px;
}
```

### Skeleton Loader

```css
.skeleton {
  background: linear-gradient(90deg, var(--bg-tertiary) 0%, var(--bg-subtle) 50%, var(--bg-tertiary) 100%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: var(--radius-sm);
}
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

## Charts si Vizualizari

### Sparkline

SVG cu gradient subtil sub linie. Culori standard:
- Revenue: `--kimono-orange`
- Orders: `--info-bg-strong`
- Customers: `--accent-purple`
- Health/positive: `--success-bg-strong`

```tsx
<svg viewBox="0 0 240 36" className="sparkline">
  <defs>
    <linearGradient id={`grad-${id}`} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={color} stopOpacity="0.18"/>
      <stop offset="100%" stopColor={color} stopOpacity="0"/>
    </linearGradient>
  </defs>
  <path d={areaPath} fill={`url(#grad-${id})`}/>
  <path d={linePath} fill="none" stroke={color} strokeWidth="1.5"/>
</svg>
```

### Bar Chart YoY Comparison

Spec: doua bare per perioada, oranj cu gri (anul anterior). Gri are `opacity: 0.45`. Width per bara: 22px. Gap intre bare in aceeasi perioada: 4px. Gap intre perioade: 48px.

### RFM Heatmap

Grid 5x5 cu culori semantice mapate pe valoare:
- Champions (5,5): `--success-bg-dark`
- Champions zone: `--success-bg-strong`, `--success-border`
- Loyal: `--success-bg-strong`
- Potential: `--success-bg`
- New: `--info-bg`
- At Risk: `--warning-bg`
- Lost: `--danger-bg`

Spec celula: 80x48px, border alb 2px intre celule.

### Cohort Heatmap

Diferit de RFM. Grid cu shade verde:
- 0% retention: `--bg-tertiary`
- 100% retention: `--success-bg-dark`
- Linear interpolation pentru valori intermediare

## Layout Patterns

### App Layout

```css
.app {
  display: grid;
  grid-template-columns: 220px 1fr;
  min-height: 100vh;
}
```

### Page Wrapper

```css
.page {
  padding: 28px 32px;
  background: var(--bg-page);
}
.page__breadcrumb {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-bottom: 8px;
}
.page__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 24px;
}
```

### Grid-uri standard

```css
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 24px;
}
.charts-row {
  display: grid;
  grid-template-columns: 1.7fr 1fr;
  gap: 12px;
  margin-bottom: 24px;
}
.bottom-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
```

## Sidebar grupare (recomandat)

```
PRINCIPAL:
  - Today (Dashboard)
  - AI Advisor
  - Smart Alerts

REPORTS:
  - Revenue
  - Customers (subsections: RFM, Cohorts, LTV, Churn)
  - Products (subsections: Matrix, Cross-sell, Performance)
  - Marketing (subsections: Campaigns, Discounts, Refunds)

OPERATIONS:
  - Inventory
  - Time to Fulfilment
  - Peak Hours

INTELLIGENCE:
  - Revenue Forecast
  - Anomaly Detection
  - Period Compare
  - Goal Tracker

ACCOUNT:
  - Magazine (stores)
  - Echipa (team)
  - Setari
  - Abonament (billing)
  - Data Health
```

## Iconite

Toate iconitele din Lucide React. Setari standard:
- Stroke width: 1.8 in app, 2 pentru iconite mai mici (12px si sub)
- Sizes: 11px, 12px, 14px, 16px, 18px, 24px
- Niciodata emoji ca decoratie

Mapare iconite:

```
Today/Dashboard:    LayoutGrid
AI Advisor:         Zap (custom polygon)
Smart Alerts:       AlertTriangle
Revenue:            BarChart3
Customers:          Users
  RFM:              Grid3x3
  Cohorts:          CalendarDays
  LTV:              TrendingUp
  Churn:            UserMinus
Products:           Package
  Matrix:           LayoutGrid
  Cross-sell:       GitMerge
Marketing:          Megaphone
  Discounts:        Percent
  Refunds:          Undo2
Inventory:          Archive
Time to Fulfilment: Clock
Peak Hours:         Activity
Forecast:           TrendingUp
Anomalies:          AlertCircle
Period Compare:     SplitSquareHorizontal
Goal Tracker:       Target
Magazine:           Store
Echipa:             Users
Setari:             Settings
Abonament:          CreditCard
Data Health:        ShieldCheck
```

## Landing Page specific

### Hero gradient background

```css
.hero {
  padding: 80px 32px 60px;
  text-align: center;
  background: linear-gradient(180deg, var(--kimono-orange-bg) 0%, white 100%);
}
.hero__title {
  font-size: 48px;
  font-weight: 500;
  letter-spacing: -1.5px;
  line-height: 1.1;
  max-width: 720px;
  margin: 0 auto 16px;
}
.hero__title-accent {
  color: var(--kimono-orange);
}
```

### Section pattern

```css
.section { padding: 80px 32px; }
.section--alt { background: var(--bg-page); }
.section__container {
  max-width: 1040px;
  margin: 0 auto;
}
.section__intro {
  text-align: center;
  max-width: 620px;
  margin: 0 auto 56px;
}
.section__eyebrow {
  display: inline-block;
  padding: 4px 10px;
  background: var(--kimono-orange-bg);
  color: var(--kimono-orange);
  border-radius: var(--radius-pill);
  font-size: 11px;
  font-weight: 500;
  margin-bottom: 14px;
}
```

### Pricing card featured

```css
.pricing-card--featured {
  border: 2px solid var(--kimono-orange);
  position: relative;
}
.pricing-card--featured::before {
  content: 'Cel mai popular';
  position: absolute;
  top: -10px;
  left: 50%;
  transform: translateX(-50%);
  padding: 3px 10px;
  background: var(--kimono-orange);
  color: white;
  border-radius: var(--radius-pill);
  font-size: 10px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
```

### Integration card

Pentru sectiunea Integrari pe landing:

```css
.integration-card {
  background: white;
  border: 0.5px solid var(--border-default);
  border-radius: var(--radius-lg);
  padding: 18px;
  text-align: center;
}
.integration-card--coming-soon {
  background: var(--bg-page);
  border: 0.5px dashed var(--border-strong);
  opacity: 0.85;
}
.integration-status-badge--available {
  background: var(--success-bg);
  color: var(--success-text);
}
.integration-status-badge--coming-soon {
  background: var(--warning-bg);
  color: var(--warning-text);
}
```

## Responsive Breakpoints

```css
/* Mobile first */
.kpi-grid { grid-template-columns: 1fr; gap: 10px; }

@media (min-width: 640px) {
  .kpi-grid { grid-template-columns: repeat(2, 1fr); }
}

@media (min-width: 1024px) {
  .kpi-grid { grid-template-columns: repeat(4, 1fr); gap: 12px; }
  .charts-row { grid-template-columns: 1.7fr 1fr; }
  .bottom-row { grid-template-columns: 1fr 1fr; }
}

@media (max-width: 767px) {
  .sidebar {
    position: fixed;
    transform: translateX(-100%);
    transition: transform var(--transition-default);
  }
  .sidebar--open { transform: translateX(0); }
  .charts-row, .bottom-row {
    grid-template-columns: 1fr;
  }
}
```

## Reguli imperative

1. **Toate border-urile sunt 0.5px** in app, exceptie 2px pentru featured pricing card
2. **Niciodata box-shadow puternic** pe carduri. Doar pe hero device frame si pe dark CTA
3. **Letter-spacing negativ doar pe numere mari** (24px+) si titluri (24px+)
4. **Sentence case peste tot**. Singurele exceptii: micro-labels uppercase de 10px cu letter-spacing 0.5px
5. **Portocaliul Kimono doar pentru**: branding, sidebar activ, AI insights, CTA primare, alerte critice. Nu pentru chart-uri generale, nu pentru text obisnuit.
6. **Iconite Lucide** la 14-16px in app, 18px pe landing, stroke-width 1.8. Niciodata emoji ca decoratie.
7. **Numerele formatate cu separator de mii** (`.toLocaleString('ro-RO')`), niciodata raw
8. **NU folosi m-dash niciodata.** Doar liniute normale (-) sau virgule.
9. **Nu folosi gradients in app**, doar in hero landing si pe iconitele AI Advisor (linear-gradient subtil)
10. **TVA Romania 21%**, nu 19%

## Quality checklist per pagina

- [ ] Toate cardurile au border 0.5px solid var(--border-default)
- [ ] Toate numerele mari au letter-spacing -0.5px sau mai mic
- [ ] Toate label-urile sunt in sentence case
- [ ] Whitespace-ul intre sectiuni e minim 24px
- [ ] Fiecare KPI card are un trend si context narativ
- [ ] Fiecare lista lunga are un "Toate →" sau echivalent
- [ ] Culorile semantice sunt folosite consistent
- [ ] Nu exista emoji ca decoratie
- [ ] Toate iconitele sunt din Lucide React
- [ ] Nu folosesti m-dash, doar liniute normale sau virgule
- [ ] Skeleton loaders sunt implementate
- [ ] Empty states sunt definite
- [ ] Mobile responsive verificat la 375px, 768px, 1024px, 1440px
- [ ] Focus states vizibile pe inputs si butoane
- [ ] Accessibility: contrast AA minim, ARIA labels pe iconite
