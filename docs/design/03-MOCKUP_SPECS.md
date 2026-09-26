# 03 - Mockup Specifications

Specificatii detaliate pentru fiecare pagina din platforma. Aceste descrieri sunt complementare cu screenshot-urile mockup-urilor din folder `mockups/`.

## Structura globala app

```
┌─────────────────────────────────────────────────────┐
│ Sidebar (220px) │ Main content                      │
│                 │                                    │
│ Logo Kimono BI  │ Breadcrumb: Section / Page         │
│ Workspace sw.   │                                    │
│                 │ <h1>Page Title</h1>                │
│ PRINCIPAL:      │ <p>Narrative description</p>       │
│ - Today (◉)     │                                    │
│ - AI Advisor 3  │ [Filters][Date range][Export]      │
│ - Smart Alerts 5│                                    │
│                 │ ┌─ KPI Grid (4 columns) ────────┐  │
│ REPORTS:        │ │ [KPI] [KPI] [KPI] [KPI]       │  │
│ - Revenue       │ └────────────────────────────────┘  │
│ - Customers     │                                    │
│ - Products      │ [Section content per page]         │
│ - Marketing     │                                    │
│                 │                                    │
│ OPERATIONS:     │                                    │
│ INTELLIGENCE:   │                                    │
│ ACCOUNT:        │                                    │
│                 │                                    │
│ [User card]     │                                    │
└─────────────────┴───────────────────────────────────┘
```

---

## 1. Today (Dashboard) - `/{workspace}/dashboard`

**Mockup:** `mockup-dashboard.png`

**Scop:** Vedere de ansamblu zilnica. Primul lucru pe care utilizatorul il vede dupa login.

**Sections:**

1. **Hero header narativ**
   - Date display: "Sambata, 25 aprilie" (uppercase micro-label)
   - Title: "Buna dimineata, {firstName}" sau "Astazi la {storeName}"
   - Description narativa: "In ultimele 24 ore ai generat **12.847 RON** din **91 comenzi**. Asta e cu **+18%** peste media saptamanala."
   - Right side: Live indicator (green dot) + Date range selector + Export button (dark)

2. **AI Insight Banner** (white card cu border subtil)
   - Icon stanga: gradient orange box 32x32 cu lightning bolt
   - Title: "AI Advisor a identificat 3 oportunitati de luat astazi"
   - Subtitle: "Bazat pe vanzari, stoc si comportament clienti din ultimele 30 zile."
   - 3 insight cards categorisite (3 coloane):
     - Urgent (orange dot, bg orange-light, border orange) - "5 produse fara stoc genereaza 23% din venit"
     - Oportunitate (yellow dot, bg neutru) - "142 clienti la risc de churn in saptamana asta"
     - Crestere (green dot, bg neutru) - "Categoria Copii a crescut +47% MoM"
   - Fiecare cu CTA inline ("Realimenteaza →", "Vezi segment →", "Scaleaza ads →")

3. **KPI Grid** (4 coloane equal width):
   - **Venit total** - 24px number + RON unit + trend +23.4% verde + sparkline orange full-width
   - **Comenzi** - 22px number + AOV context + trend +12% verde + sparkline blue
   - **Clienti unici** - 22px number + retention context + trend +8.2% verde + sparkline purple
   - **Health Score** - card SPECIAL verde inchis, score 75/100 + grad B + 5 progress segments (3 verzi filled, 2 muted)

4. **Charts Row** (1.7fr / 1fr):
   - **Evolutie venit** card:
     - Header cu title + segmented control (6L active / 12L / YTD)
     - Stats row: 2026 venit + 2025 venit + Diferenta % (verde)
     - Bar chart YoY: orange bars 2026 + gray bars 2025 (opacity 0.45)
     - X axis: lunile (Oct, Nov, Dec, Ian, Feb, Mar)
     - Y axis: 150k, 300k, 450k, 600k
     - Highlight pe luna pic (Dec 2025) cu tooltip "586.687 RON"
   - **Top produse** card:
     - List 5 produse cu:
       - Numar pozitie (1 in orange box, 2-5 gri)
       - Nume produs
       - Progress bar proportional (95%, 78%, 64%, 51%, 42%)
       - Cantitate vandute (847 buc, 692 buc, etc.)

5. **Bottom Row** (1fr / 1fr):
   - **Segmente RFM** card:
     - List 5 segmente cu progress bars colorate:
       - Champions (green, 22%)
       - Loyal (light green, 18%)
       - Promising (blue, 28%)
       - At Risk (yellow, 17%)
       - Lost (red, 15%)
     - Insight text la final: "Champions+Loyal genereaza **62% din venit** cu doar **40% din clienti**."
   - **Alerte stoc** card:
     - Header cu title + count badge "5"
     - List 4 alerte cu:
       - Border-left 3px (red sau yellow)
       - Nume produs + Stoc info ("142 vanzari/luna · 0 stoc")
       - Severity badge (Critic rosu, Atentie galben)
     - Footer link "Vezi toate alertele (5) →"

---

## 2. AI Advisor - `/{workspace}/ai-advisor`

**Mockup:** `mockup-ai-advisor.png`

**Scop:** Pagina dedicata pentru toate insights AI generate.

**Sections:**

1. **Breadcrumb:** Today / AI Advisor

2. **Hero header**:
   - Icon AI: gradient orange 32x32 cu lightning bolt
   - Title: "AI Advisor"
   - Description: "Insights generate automat din datele magazinului tau. Analizez vanzari, stoc, trafic si comportament clienti pentru a-ti spune **ce sa faci, nu doar ce s-a intamplat.**"
   - Right: Filter category dropdown + "Reanalizeaza" button cu refresh icon (dark)

3. **Meta KPIs** (4 coloane):
   - **Insights active**: 11 + "3 noi astazi"
   - **Impact estimat**: +47.230 RON (verde) + "In urmatoarele 30 zile"
   - **Implementate**: 7 / 18 + "Luna aceasta"
   - **Acuratete predictii**: 87% + "Ultimele 90 zile"

4. **Filter tabs**:
   - Toate (11) - active orange
   - Urgent (3)
   - Oportunitati (5)
   - Crestere (3)

5. **Insight Cards Stack** (vertical, 12px gap):
   
   Fiecare card are border-left 3px in culoarea categoriei:
   - Urgent → orange (#D85A30)
   - Warning → yellow (#EF9F27)
   - Success → green (#1D9E75)

   Structura card:
   - **Header row**: Category badge + timestamp + confidence ("Confidence 94%") + more menu (⋯)
   - **Title**: 15+ cuvinte narrative (ex: "5 produse fara stoc genereaza 23% din venitul lunar")
   - **Description**: Paragraph cu numere bold inline (ex: "Produsele... au generat **547.768 RON** in ultimele 30 zile. La rata actuala de cerere, pierzi aproximativ **18.250 RON/saptamana**...")
   - **Metrics row** (gray bg `--bg-subtle`, 3 coloane):
     - "Pierdere estimata" / "18.250 RON/sapt"
     - "Cerere lunara" / "847 buc total"
     - "Furnizor recomandat" / "Bohemia (5 zile)"
   - **Actions row**:
     - Primary CTA (orange): "Genereaza comanda furnizor"
     - Secondary (white border): "Vezi produse"
     - Ghost (no border, right-aligned): "Marcheaza ca rezolvat"

---

## 3. Smart Alerts - `/{workspace}/alerts`

**Mockup:** `mockup-smart-alerts.png`

**Scop:** Lista alerte detectate automat.

**Sections:**

1. **Breadcrumb:** Today / Smart Alerts

2. **Hero header**:
   - Title: "Smart Alerts"
   - Description: "Detectez automat anomalii si schimbari semnificative in magazinul tau. **5 alerte critice** necesita actiune azi."
   - Right: "Configureaza" button cu settings icon

3. **Stat Cards** (5 coloane):
   - Critic (border-left rosu): 5 + "Necesita actiune"
   - Atentie (border-left galben): 8 + "In urmatoarele zile"
   - Info (border-left albastru): 12 + "Pentru analiza"
   - Pozitiv (border-left verde): 3 + "Performanta peste medie"
   - Rezolvate (no border-left, gray text): 42 + "Ultimele 30 zile"

4. **Lista alerte** (white card cu inner padding 0):
   - **Header sticky**: Title "Toate alertele active" + count + Search input + Filter dropdowns (Tip, Severitate)
   - **Rows** (border-bottom intre fiecare):
     - Icon stanga (in cerc colorat 32x32 cu bg semantic light) - inventory, ads, users, etc.
     - Mid: Title + Severity badge + Description (small gray)
     - Right: Timestamp + Action button (primary dark, ex: "Rezolva", "Investigheaza", "Vezi campanie")

---

## 4. RFM Segments - `/{workspace}/customers/rfm`

**Mockup:** `mockup-rfm.png`

**Scop:** Segmentarea clientilor in matrice 5x5.

**Sections:**

1. **Breadcrumb:** Reports / Customers / RFM Segments

2. **Hero header**:
   - Title: "RFM Segments"
   - Description: "Segmentarea clientilor dupa **Recency** (cat de recent au cumparat), **Frequency** (cat de des) si **Monetary** (cat au cheltuit). Concentreaza-te pe segmentele cu valoare ridicata."
   - Right: Date range "Last 90 days" + "Export segmente" (dark button)

3. **KPIs** (4 coloane):
   - Total clienti: 9.731 + "Cu cel putin 1 comanda"
   - Customer LTV mediu: 244,68 RON + "+12% vs trim. anterior"
   - Repeat rate: 34% + "Cumpara de 2+ ori"
   - Champions venit: 42% (verde) + "Din venit total"

4. **Main grid** (1.4fr / 1fr):
   - **Matricea segmentelor** card (RFM Heatmap 5x5):
     - X-axis: Recency (1-5)
     - Y-axis: Frequency (1-5)
     - Fiecare celula: count + label segment (ex: "187 / Champions")
     - Culori conform Design System (Champions verde inchis -> Lost rosu)
     - Border alb 2px intre celule
     - Legend dedesubt cu 6 categorii
   - **Recomandari per segment** card:
     - 5 segmente cu border-left colorat semantic
     - Fiecare: Nume + count + % venit + tactica recomandata

5. **Top customers table** (Champions 5,5,5):
   - Coloane: Client (avatar + nume), LTV, Comenzi, AOV, Ultima comanda, Categorie
   - 4-5 row-uri vizibile + "Exporta lista →" link

---

## 5. Cohorts - `/{workspace}/customers/cohorts`

**Scop:** Analiza retentie pe cohorte de clienti.

**Pattern bazat pe:** RFM (similar layout cu heatmap diferit)

**Sections:**

1. **Breadcrumb:** Reports / Customers / Cohort Analysis

2. **Hero header**:
   - Title: "Cohort Analysis"
   - Description: "Cum se comporta clientii in timp dupa prima cumparare. Cohortele cu retentie buna iti spun **ce campanii functioneaza pe termen lung**."

3. **KPIs** (4 coloane):
   - Best cohort: "Dec 2025" + 28% M3 retention
   - 30-day retention: % medie
   - 90-day retention: % medie
   - 180-day retention: % medie

4. **Cohort Heatmap** (full width card):
   - Y-axis: Cohort months (Jan 2025, Feb 2025, ..., Apr 2026)
   - X-axis: Months since first purchase (M0, M1, M2, ..., M11)
   - Celulele: % retentie cu shade verde (interpolat de la `--bg-tertiary` la `--success-bg-dark`)
   - Diagonala cu zile mai recente are shade special (current period)
   - Hover effect: tooltip cu N customers + % retention

5. **Insights cards** (3 coloane):
   - "Cohorta din Decembrie 2025 are cel mai bun M3 retention (28%)"
   - "Drop-off mediu intre M1 si M2 e de X%"
   - "Clientii din Black Friday au LTV cu 2.3x mai mare"

---

## 6. Revenue - `/{workspace}/revenue`

**Scop:** Vedere detaliata venit, evolutie, breakdown.

**Sections:**

1. **Breadcrumb:** Reports / Revenue

2. **Hero header**:
   - Title: "Revenue"
   - Description: "Venit total ultimele 30 zile: **X RON** (+Y% vs perioada anterioara). **Z%** vine din **N produse top**."

3. **KPIs** (4 coloane):
   - Venit total + trend
   - AOV + trend
   - Numar comenzi + trend
   - Conversion rate + trend

4. **Main chart** (full width):
   - Line chart cu venit zilnic
   - Comparator anul anterior (linia gri opacity 0.45)
   - Optional: layer cu bugete/forecast
   - Time range selector: 7D / 30D / 90D / 12M / Custom

5. **Breakdown grid** (2 coloane):
   - **Revenue by category** - Donut chart cu top 5 categorii + Other
   - **Revenue by traffic source** - Bar chart orizontal: Direct, Organic, Paid Social, Email, Referral

6. **Daily breakdown table**:
   - Coloane: Data, Comenzi, Venit, AOV, Conversion rate
   - Last 30 days, paginated

---

## 7. Products - `/{workspace}/products`

**Scop:** Performanta produse + Product Matrix + Cross-sell.

**Sections:**

1. **Breadcrumb:** Reports / Products

2. **Hero header**:
   - Description: "**X produse active**. Top 5 genereaza **Y% din venit**. **Z produse** sunt dead stock."

3. **KPIs** (4 coloane): Total produse, Active, Dead stock count, Best seller

4. **Product Matrix** card (BCG-style scatter chart):
   - 4 quadrants: Stars / Cash Cows / Question Marks / Dogs
   - X-axis: Market share (sau % din venit)
   - Y-axis: Growth rate
   - Bubbles = produse, marime = revenue
   - Hover: tooltip cu nume produs + metrici

5. **Top performers table**:
   - Image, nume, SKU, vanzari, venit, profit margin, trend (sparkline)

6. **Cross-sell card** (full width):
   - Insight: "Produsele **X** si **Y** sunt cumparate impreuna in **34%** din comenzi"
   - Recomandari de bundles cu impact estimat

---

## 8. Marketing - `/{workspace}/marketing`

**Scop:** Performance ads, campanii, ROAS.

**Sections:**

1. **Breadcrumb:** Reports / Marketing

2. **Hero header**:
   - Description: "ROAS mediu: **X.Yx** | Spend total ultimele 30 zile: **Z RON**"

3. **KPIs** (4 coloane): ROAS general, Total ad spend, Cost per acquisition, Total revenue from ads

4. **Channels overview** (3 cards):
   - **Meta Ads**: logo Facebook+Instagram, spend, ROAS, CPC, top campania
   - **Google Ads**: logo, spend, ROAS, CPC, top campania
   - **Email**: engagement rate, conversion rate, top template

5. **Campaign performance table**:
   - Coloane: Campaign name, channel (logo), spend, revenue, ROAS, status (badge active/paused)
   - Sortabil pe oricare coloana

6. **Discount Impact** card:
   - "Discounturile au generat **X RON** extra venit, dar **Y RON** margine pierduta"
   - Recommendation: "Optimizeaza promotiile pentru produsele cu margine peste 40%"

---

## 9. Inventory - `/{workspace}/inventory`

**Mockup:** `mockup-inventory.png`

**Scop:** Stocouts, dead stock, recomandari comenzi.

**Sections:**

1. **Breadcrumb:** Operations / Inventory Intelligence

2. **Hero header**:
   - Title: "Inventory Intelligence"
   - Description: "Pierzi **~24.700 RON/saptamana** din stocouts si **156.430 RON** sunt blocati in dead stock."
   - Right: Date range + "Genereaza comanda" (dark button)

3. **KPIs** (4 coloane cu border-left):
   - Stocout activ (rosu): 5 + "Pierdere ~24.700 RON/sapt"
   - La risc <7 zile (galben): 12 + "Necesita comanda urgent"
   - Dead stock (no border): 87 + "156.430 RON imobilizati"
   - Inventory turnover: 4.2x + "+0.4 vs trim. anterior" (verde)

4. **Filter tabs**:
   - Stocout & risc (17) - active orange
   - Dead stock (87)
   - Slow movers (143)
   - Star products (28)

5. **Products table** (white card):
   - Header cu title + Search + Categorie filter
   - Coloane: Produs (image + nume + SKU), Stoc, Velocity, Days left, Pierdere/sapt, Status, Actiune
   - Stoc colorat in functie de severitate (rosu = 0)
   - Days left colorat (rosu / galben)
   - Action button: "Comanda" (orange pentru critic, dark pentru atentie)
   - Footer: "* Pierdere proiectata daca nu se realimenteaza in 7 zile"
   - Pagination: "Showing 5 of 17 · Vezi toate"

---

## 10. Revenue Forecast - `/{workspace}/intelligence/forecast`

**Scop:** Predictii ML pentru venit viitor.

**Sections:**

1. **Breadcrumb:** Intelligence / Revenue Forecast

2. **Hero header**:
   - Description: "Prognoza pentru luna urmatoare: **X RON ± Y%**. Forecast accuracy ultimele 90 zile: **Z%**."

3. **KPIs** (4 coloane):
   - Forecast urmatoarea luna
   - Confidence interval
   - Forecast Q1
   - Forecast accuracy (model performance)

4. **Forecast chart** (full width):
   - Line chart cu actual data (ultimele 12 luni in solid line orange)
   - Projection in dotted line orange pentru urmatoarele 3 luni
   - Confidence band (zona shaded orange opacity 0.1)

5. **Drivers card**:
   - "Principalii factori care influenteaza forecast-ul:"
   - Lista cu progress bars: Seasonality 45%, Marketing spend 28%, Customer acquisition 18%, Other 9%

6. **Scenarios** (3 cards):
   - Optimistic (+20% spend) → forecast +X%
   - Realistic (current trajectory) → forecast Y%
   - Pessimistic (no growth) → forecast Z%

---

## 11. Anomaly Detection - `/{workspace}/intelligence/anomalies`

**Scop:** Detectie automata anomalii in data.

**Sections:**

1. **Breadcrumb:** Intelligence / Anomaly Detection

2. **Hero header**:
   - Description: "Detect automat anomalii in **8 metrici cheie**. **3 anomalii** detectate ultimele 7 zile."

3. **Anomalies timeline chart** (full width):
   - Line chart cu spike-uri detectate marcate cu puncte rosii
   - Range bands (verde subtil) pentru "normal range"
   - Click pe spike → detalii in drawer

4. **Anomalies list table**:
   - Data, Metric, Valoare normala vs detectata, Deviation %, Severitate (badge), Cauza probabila (AI-suggested)

---

## 12. Settings - `/{workspace}/settings`

**Mockup:** `mockup-settings.png`

**Scop:** Configurare cont si preferinte.

**Layout: 2-column** (200px sidebar + content):

1. **Breadcrumb:** Account / Setari

2. **Hero header simplu**: Title + description

3. **Sub-sidebar** (200px stanga):
   - General (active orange bg)
   - Magazine conectate
   - Echipa
   - Notificari
   - Automatizari
   - Abonament
   - Data Health
   - API & Webhooks
   - Securitate

4. **Content section** (right):

   Tab "General" contine 3 cards stacked vertical:

   **a. Profile card**:
   - Avatar 56px (cu initiale FA bg dark) + "Schimba poza" button + "Sterge" link
   - Form 2x2 grid: Nume, Email, Companie, Rol

   **b. Preferences card** (5 setari, fiecare row cu border-bottom 0.5px):
   - Limba interfata: segmented control [Romana / English]
   - Moneda: select dropdown (RON, EUR, USD)
   - Fuse orar: select dropdown (Europe/Bucharest, etc.)
   - Dark mode: segmented control [Auto / Light / Dark]
   - Format numeric european: toggle switch (verde = ON)

   **c. Connected stores card**:
   - Header cu title + "+ Conecteaza magazin" (orange button)
   - List 3 row-uri cu integration cards:
     - Shopify (logo verde, status "Sincronizat" verde, descriere) + "Configureaza" button
     - Meta Ads (logo albastru, status "Conectat", descriere) + "Configureaza"
     - Google Analytics 4 (logo galben, status "Sync delayed" warning, descriere) + "Configureaza"

5. **Footer actions** (right-aligned): Anuleaza + Salveaza modificari (orange primary)

---

## 13. Onboarding flow - `/onboarding`

**Scop:** Flow primul-time user pentru setup workspace + connect store + invite team.

**4 steps**, fiecare ca o pagina simpla cu progress bar sus si form centrat:

1. **Step 1 - Create Workspace**:
   - Progress bar: ●○○○ (1 of 4)
   - Title: "Cum se numeste businessul tau?"
   - Description: "Vom folosi acest nume pentru workspace-ul tau Kimono BI."
   - Form: Workspace name input + URL slug auto-generated (editable)
   - Button: "Continua" (orange)

2. **Step 2 - Connect Store**:
   - Progress: ●●○○
   - Title: "Conecteaza primul tau magazin"
   - Description: "Avem nevoie de acces la datele tale pentru a genera insights."
   - 2 cards mari clickable:
     - Shopify (verde, recommended badge) - click -> OAuth flow
     - WooCommerce (gri, "Coming soon Q3 2026" badge) - disabled
   - Skip link: "Conectez mai tarziu"

3. **Step 3 - Invite team**:
   - Progress: ●●●○
   - Title: "Invita echipa ta?"
   - Description: "Adauga colegi care sa colaboreze in workspace."
   - Email input (multi-add) cu role selector (admin/analyst/viewer)
   - Button: "Trimite invitatii" + Skip link

4. **Step 4 - Notifications**:
   - Progress: ●●●●
   - Title: "Cum vrei sa primesti alerte?"
   - 3 toggles: Email digest saptamanal, Slack notifications, Push notifications (Pro)
   - Button: "Termina setup" → redirect la `/{workspace}/dashboard`

---

## 14. Auth pages - `/login` si `/signup`

**Layout simplu, centrat**, fara sidebar. Background `--bg-page`.

### `/signup`

- Logo Kimono BI sus
- Card centrat (max-width 400px):
  - Title: "Creeaza cont gratuit"
  - Subtitle: "Try free 14 zile, fara card."
  - "Continue with Google" button (white, with Google logo)
  - "or" separator
  - Email input + Password input
  - Button: "Sign up" (orange primary, full-width)
  - Link footer: "Ai deja cont? **Login**"
- Footer: "Prin signup accepti Termenii si Privacy Policy"

### `/login`

- Logo Kimono BI sus
- Card centrat:
  - Title: "Login"
  - "Continue with Google"
  - Email + Password
  - "Forgot password?" link
  - Button: "Login"
  - Link: "Nu ai cont? **Sign up**"

---

## Pattern reguli pentru fiecare pagina

1. **Breadcrumb** sus daca pagina e nested
2. **Page title** + descriere narativa cu numere bold inline
3. **Actions in dreapta** (filters, date range, export)
4. **KPIs** 4 coloane (sau 5 daca e logic, ca pe Smart Alerts)
5. **Loading states** prin skeleton pentru fiecare sectiune
6. **Empty states** definite pentru cazul lipsa date
7. **Responsive**: 4 coloane → 2 coloane → 1 coloana pe mobile
8. **Toate culorile semantice** consistente: rosu = critic, galben = atentie, verde = ok/pozitiv, albastru = info
9. **Borders 0.5px**, radius 12px pentru carduri principale, 8px pentru row-uri secundare
10. **Niciodata m-dash**, doar liniute normale sau virgule
