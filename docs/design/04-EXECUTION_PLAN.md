# 04 - Plan de Executie

Plan structurat in 14 faze pentru transformarea completa a Kimono BI. Faza 0 e speciala - Discovery & Architecture - in care Claude Code investigheaza codul existent si propune deciziile tehnice ramase.

## Reguli generale

1. **Lucreaza fata cu fata.** Nu sari peste faze.
2. **Commit dupa fiecare faza** cu mesaj descriptiv: `feat(scope): faza N - descriere`
3. **Verifica dupa fiecare faza**: `npm run typecheck && npm run lint && npm run build`
4. **Rulare locala intre faze** ca sa verifici vizual ca totul arata bine
5. **NU folosi m-dash** in cod, comentarii sau text afisat. Doar liniute (-) sau virgule.
6. **Toate textele in romana** cu diacritice consistent (sau fara, dar pe tot proiectul la fel)

---

## Faza 0 - Discovery & Architecture

**Obiectiv:** Investigarea codului existent si stabilirea stack-ului tehnic.

### Tasks pentru Claude Code

1. Citeste tot continutul folder-ului `docs/design/` (cele 5 documente)
2. Investigheaza repo-ul existent:
   - `package.json` - ce dependinte sunt instalate
   - `app/` sau `src/` - structura curenta
   - `prisma/schema.prisma` - schema DB curenta
   - Any deployment configs (railway.toml, vercel.json, dockerfile)
3. Citeste fisiere relevante: `KIMONO-BI-SHOPIFY-APP-MASTER.md` si orice alt master doc
4. Analizeaza si raspunde-mi cu un document `DISCOVERY_REPORT.md` care contine:
   - **Stack curent**: framework, ORM, hosting, ce module sunt implementate
   - **Recomandare framework target**: Next.js / Remix / alta + justificare
   - **Recomandare strategie codebase**: refactor in-place / migrate green-field / hybrid + justificare
   - **Recomandare auth**: Clerk / Auth.js / Better-auth / alta + justificare (cu pro/con-uri)
   - **Recomandare schema DB**: ce trebuie schimbat pentru multi-tenancy
   - **Recomandare hosting**: Railway pentru continuitate / Vercel pentru Next.js / alta
   - **Risc-uri identificate**: probleme potentiale in migration
   - **Estimari de timp** pentru fiecare faza ulterioara

### Acceptance criteria

- `DISCOVERY_REPORT.md` creat in `docs/design/`
- Toate sectiunile de mai sus completate cu decizii justificate
- User aproba planul inainte sa treaca la Faza 1

### Output asteptat

User citeste raportul, da feedback / aproba decizii, apoi instruieste Claude Code sa treaca la Faza 1.

### Commit
```
docs: faza 0 - discovery report si arhitectura propusa
```

---

## Faza 1 - Foundation (project setup, design tokens, multi-tenancy schema)

**Obiectiv:** Setup-ul tehnic complet pentru noua arhitectura.

### Tasks

**A. Project structure** (in functie de decizia din Faza 0):
- Creeaza/refactorizeaza structura folder pentru noua arhitectura
- Setup TypeScript strict mode
- Setup ESLint + Prettier cu reguli stricte (no m-dash detection daca e posibil)
- Setup environment variables (.env.example documentat)

**B. Design tokens**:
- Creeaza `app/styles/design-tokens.css` cu toate variabilele CSS din `02-DESIGN_SYSTEM.md`
- Creeaza `app/styles/globals.css` cu reset, typography base, utility classes
- Importa-le in root layout
- Creeaza `app/lib/design-tokens.ts` cu typescript constants

**C. Database schema (multi-tenancy)**:
- Refactorizeaza/creaza schema Prisma pentru:
  - `User` (separata de Store)
  - `Workspace` (tenant container)
  - `WorkspaceMember` (join cu role)
  - `Invitation` (pentru invite flow)
  - `Store` (link la Workspace, suport platform: 'shopify' | 'woocommerce')
  - `Subscription` (per Workspace)
  - Toate tabelele existente cu FK catre `Workspace`
- Genereaza migrations
- Verifica ca migrations ruleaza pe DB-ul tau de development

**D. Utility functions**:
- `app/lib/utils.ts` cu: `formatCurrency`, `formatNumber`, `formatPercent`, `formatDate`, `cn` (classnames), `slugify`
- `app/lib/auth/` - placeholder pentru auth (implementare in Faza 2)
- `app/lib/db.ts` - Prisma client singleton

### Acceptance criteria

- `npm run typecheck && npm run build` trece
- `npx prisma migrate dev` ruleaza fara erori
- `formatCurrency(2381605, 'RON')` returneaza `"2.381.605 RON"`
- Variabilele CSS functioneaza global

### Commit
```
feat(foundation): faza 1 - setup, design tokens, multi-tenancy schema
```

---

## Faza 2 - Auth & Multi-tenancy

**Obiectiv:** Sistem complet de autentificare si workspaces.

### Tasks

**A. Auth implementation** (folosind solutia aleasa in Faza 0):
- Sign up flow cu email + password si "Continue with Google"
- Email verification (cu token, expire 24h)
- Login flow cu remember me
- Password reset flow
- Session management
- Logout

**B. Onboarding flow** (4 steps - vezi `03-MOCKUP_SPECS.md` section 13):
- Step 1: Create workspace (name + auto-slug)
- Step 2: Connect store (Shopify OAuth - placeholder pentru Faza 3)
- Step 3: Invite team (optional)
- Step 4: Notifications preferences

**C. Workspace management**:
- API endpoints pentru CRUD workspaces
- Workspace switcher component
- URL routing namespaced cu workspace slug: `/{workspace-slug}/...`
- Middleware pentru a asigura ca user are acces la workspace-ul din URL
- Redirect la "Choose workspace" daca user are 2+ workspaces dupa login

**D. Team management**:
- Invitation flow: send email cu link de accept
- Accept invitation page
- Members list page
- Role management (Owner / Admin / Analyst / Viewer)
- Permission helpers: `canEditWorkspace()`, `canManageBilling()`, etc.

### Acceptance criteria

- User poate signup, verifica email, login
- User poate crea workspace si fi redirectat la dashboard
- User poate invita team members care primesc email
- Invited user poate accepta invitation si fi adaugat la workspace
- URL-urile sunt namespaced corect cu workspace slug
- Permisiunile functioneaza (viewer nu poate edita)

### Commit
```
feat(auth): faza 2 - autentificare si multi-tenancy complet
```

---

## Faza 3 - Integrari Phase 1 (Shopify, Meta, GA4)

**Obiectiv:** Conectarea integrarilor primary la noua structura multi-tenant.

### Tasks

**A. Shopify integration**:
- OAuth flow standalone (nu embedded)
- Save access_token encrypted per Store
- Sync initial: orders, products, customers, inventory
- Background job pentru sync incremental (la 15 min)
- Webhook receiver pentru order.created, product.update, etc.

**B. Meta Ads integration**:
- Facebook Login OAuth
- Fetch ad accounts si campaigns
- Sync metrics: spend, impressions, clicks, conversions
- Background job pentru daily refresh

**C. Google Analytics 4 integration**:
- Google OAuth
- Fetch GA4 properties
- Sync metrics: sessions, users, conversion rate, traffic sources
- Background job pentru daily refresh

**D. Settings UI**:
- "Connected stores" card in settings (cum e in mockup)
- Connect/Disconnect buttons
- Sync status indicators (Sincronizat / Sync delayed / Error)
- Last sync timestamp

**E. WooCommerce placeholder**:
- Card "Coming soon Q3 2026" in settings si pe landing
- Disabled state, no functionality

### Acceptance criteria

- User poate conecta Shopify si vede produsele dupa primul sync
- User poate conecta Meta Ads si vede campaigns
- User poate conecta GA4 si vede sessions
- Sync-urile background ruleaza periodic fara erori
- Settings UI arata corect statusul fiecarei integrari

### Commit
```
feat(integrations): faza 3 - Shopify, Meta Ads, Google Analytics 4
```

---

## Faza 4 - Atomic UI Components

**Obiectiv:** Crearea bibliotecii de componente atomice reutilizabile.

### Componente in `app/components/ui/`

1. **Button.tsx** - 4 variants (primary, secondary, dark, ghost) + 2 sizes (default, lg)
2. **Badge.tsx** - status pills cu variants
3. **CategoryBadge.tsx** - cu dot colorat (urgent, warning, success, info)
4. **Avatar.tsx** - circular cu initiale, hash-based color
5. **Trend.tsx** - pill cu sageata si procentaj (up/down)
6. **Icon.tsx** - wrapper peste Lucide React cu marimi standard
7. **Input.tsx** - text input cu focus ring
8. **Select.tsx** - dropdown stilizat
9. **SearchInput.tsx** - input cu icon search
10. **Toggle.tsx** - switch on/off
11. **ProgressBar.tsx** - cu label, fill, valoare
12. **Skeleton.tsx** - loader cu shimmer
13. **Spinner.tsx** - loading spinner
14. **Tabs.tsx** - filter tabs (orange active)
15. **Segmented.tsx** - segmented control (white active cu shadow)
16. **Tooltip.tsx** - hover tooltip
17. **Dropdown.tsx** - menu dropdown
18. **Modal.tsx** - modal cu backdrop blur

### Acceptance criteria

- Fiecare componenta are TypeScript props strict tipate
- Default values pentru props optionale
- JSDoc cu exemple de utilizare
- Storybook story (DACA Storybook e configurat)
- Componentele sunt accessible (ARIA labels, keyboard navigation)

### Commit
```
feat(ui): faza 4 - componente atomice reutilizabile
```

---

## Faza 5 - Layout Components

**Obiectiv:** Layout-ul aplicatiei.

### Componente

1. **AppLayout.tsx** - root layout cu sidebar + main
2. **Sidebar.tsx** - alb cu sectiuni grupate
3. **SidebarItem.tsx** - cu icon, label, optional badge
4. **SidebarSection.tsx** - wrapper cu label
5. **WorkspaceSwitcher.tsx** - dropdown workspace activ + "Creeaza nou"
6. **UserMenu.tsx** - footer sidebar cu user + settings
7. **Breadcrumb.tsx** - cu separators
8. **PageHeader.tsx** - title + description + actions
9. **PageWrapper.tsx** - container standard pentru pagini

### Acceptance criteria

- Sidebar cu toate sectiunile (PRINCIPAL / REPORTS / OPERATIONS / INTELLIGENCE / ACCOUNT)
- Active state functioneaza pe baza route-ului curent
- Badge-uri afiseaza count real din DB (numar AI insights, alerts)
- Workspace switcher functioneaza si schimba routing-ul
- Mobile: sidebar devine drawer cu hamburger menu

### Commit
```
feat(layout): faza 5 - layout, sidebar, navigation
```

---

## Faza 6 - Data Display Components

**Obiectiv:** Componente pentru afisarea datelor.

### Componente

1. **KpiCard.tsx** - cu sparkline optional
2. **HealthScoreCard.tsx** - special verde inchis cu segments
3. **Sparkline.tsx** - SVG configurabil
4. **BarChart.tsx** - cu suport YoY comparison
5. **LineChart.tsx** - cu suport multiple series si forecast
6. **DonutChart.tsx** - pentru breakdown by category
7. **HeatmapRFM.tsx** - grid 5x5 RFM
8. **HeatmapCohort.tsx** - cohort retention
9. **ProgressBarStat.tsx** - row cu label + bar + valoare
10. **DataTable.tsx** - cu sortare, filtrare, paginare
11. **MetricRow.tsx** - 3 metrics in row
12. **AlertRow.tsx** - cu icon, title, severity, action
13. **InsightCard.tsx** - card complet pentru AI Advisor
14. **InsightCardCompact.tsx** - varianta pentru banner Dashboard

### Acceptance criteria

- Toate accepta data ca props si se redeseneaza
- DataTable suporta sortare pe orice coloana
- Charts au tooltip-uri pe hover
- Toate au skeleton loader variant
- Toate au empty state variant

### Commit
```
feat(data): faza 6 - data display si charts components
```

---

## Faza 7 - Dashboard (Today) Page

**Obiectiv:** Pagina principala "Today" complet implementata.

### Tasks

Refactorizeaza `app/routes/{workspace}/dashboard.tsx` (sau echivalent) cu:

1. **Server-side data fetching**:
   - Revenue 24h, 30d, YoY
   - Orders count, AOV
   - Customer count, retention rate
   - Health Score (calcul algoritmic)
   - AI insights (top 3 din DB)
   - Top products (top 5 din ultimele 30 zile)
   - RFM segments distribution
   - Stock alerts (top 5 critice)

2. **UI implementation** (vezi `03-MOCKUP_SPECS.md` section 1):
   - Hero header narativ cu salut personalizat
   - AI Insight Banner cu 3 carduri categorisite
   - KPI Grid cu sparklines
   - Charts row cu Evolutie venit YoY si Top produse
   - Bottom row cu RFM si Stock alerts

3. **Empty states** pentru:
   - Magazin neconectat (CTA "Conecteaza Shopify")
   - Date insuficiente pentru AI insights
   - Fara stoc alerts (varianta pozitiva)

4. **Loading states** cu skeleton pentru fiecare sectiune

### Acceptance criteria

- Pagina arata identic cu `mockup-dashboard.png`
- Date sunt reale din DB (nu hardcodate)
- Functioneaza pentru workspace-uri cu 0 date (empty states)
- Functioneaza pentru workspace-uri cu zeci de mii de comenzi (performance OK)
- Mobile responsive

### Commit
```
feat(dashboard): faza 7 - pagina Today completa
```

---

## Faza 8 - AI Advisor + Smart Alerts

**Obiectiv:** Cele 2 pagini cheie de AI/automatizare.

### Tasks

**A. AI Advisor page** (vezi `03-MOCKUP_SPECS.md` section 2):
- Conectare la Claude API (via `@anthropic-ai/sdk`)
- Function/job care genereaza insights periodic (zilnic la 6 AM ora workspace-ului)
- Insights stocate in DB cu campurile: category, title, description, metrics, actions, confidence, time, status
- UI pentru lista insights cu filtre (Toate / Urgent / Oportunitati / Crestere)
- Actions inline functionale (cel putin "Marcheaza rezolvat")
- Reanalizeaza button trigger background job

**B. Smart Alerts page** (vezi `03-MOCKUP_SPECS.md` section 3):
- Engine de detectie: stocouts, drop-uri vanzari, anomalii CPC, churn risk, growth pozitiv
- Alerts stocate in DB cu category, severity, title, description, source, action
- UI pentru lista alerts cu filtre (Critic / Atentie / Info / Pozitiv / Rezolvate)
- Actions inline (Rezolva, Investigheaza, Vezi campanie)
- Notificari (email + Slack daca Slack e conectat) pentru alerts critice

### Acceptance criteria

- AI Advisor genereaza insights reale bazate pe date din workspace
- Insights sunt formulate narrative cu numere specifice
- Smart Alerts detecteaza stocouts in 24h de la aparitie
- Email digest saptamanal contine top 3 insights + 5 alerts
- Userii pot marca insights/alerts ca rezolvate

### Commit
```
feat(ai): faza 8 - AI Advisor si Smart Alerts complete
```

---

## Faza 9 - Customer Pages (RFM, Cohorts, LTV, Churn)

**Obiectiv:** Toate paginile din sectiunea Customers.

### Pagini

1. **Customers Overview** - landing page sectiune
2. **RFM Segments** (vezi `03-MOCKUP_SPECS.md` section 4)
3. **Cohorts** (vezi section 5)
4. **LTV Analytics** - distributie LTV + segmente + predictii
5. **Churn Prediction** - clienti la risc + scoruri + actiuni

### Tasks specifice

- Algoritm RFM cu scoring 1-5 pe fiecare dimensiune
- Algoritm Cohort cu calcul retention M0-M11
- Algoritm LTV cu predictii ML (linear regression sau mai sofisticat)
- Algoritm Churn cu probabilities

### Acceptance criteria

- RFM heatmap clickable (filtreaza tabelul de jos)
- Cohort heatmap cu shade verde gradat
- Top customers exportabil in CSV
- Recomandari per segment cu border-left colorat

### Commit
```
feat(customers): faza 9 - toate paginile Customers
```

---

## Faza 10 - Restul paginilor (Revenue, Products, Marketing, Inventory, Intelligence)

**Obiectiv:** Aplicarea design system-ului pe toate celelalte pagini.

### Pagini

- Revenue (section 6)
- Products + Product Matrix + Cross-sell (section 7)
- Marketing + Discount Impact + Refund Analytics (section 8)
- Inventory Intelligence (section 9)
- Time to Fulfilment
- Peak Hours
- Revenue Forecast (section 10)
- Anomaly Detection (section 11)
- Period Compare
- Goal Tracker

Pentru fiecare:
- Pastreaza logica de business existenta (refactor doar UI)
- Aplica design system v2
- Adauga skeleton loaders
- Adauga empty states
- Adauga narratie in header cu numere

### Acceptance criteria

- Toate paginile arata consistent cu design system
- Toate au header narativ
- Toate functioneaza cu date reale

### Commit
```
feat(reports): faza 10 - refactor toate paginile reports/operations/intelligence
```

---

## Faza 11 - Account & Settings

**Obiectiv:** Sectiunea Account complet implementata.

### Pagini (toate sub `/{workspace}/settings/...`):

1. **Settings > General** (vezi section 12 in mockup specs)
2. **Settings > Magazine conectate** - lista stores + add store flow
3. **Settings > Echipa** - members list + invitations + role management
4. **Settings > Notificari** - email/Slack/push toggles per category
5. **Settings > Automatizari** - Smart Actions config + Email Digest schedule
6. **Settings > Abonament** - plan curent, billing history, upgrade/downgrade, Stripe portal
7. **Settings > Data Health** - status sync per integrare + ultimul sync + erori
8. **Settings > API & Webhooks** - generare API keys + webhook config (Pro+)
9. **Settings > Securitate** - 2FA, sessions active, audit log

### Acceptance criteria

- Toate setarile salveaza in DB
- Schimbarea workspace name updateaza si slug-ul (cu redirect)
- Invitation flow trimite email functional
- Plan upgrade redirect la Stripe Checkout
- Toate au validare server-side

### Commit
```
feat(settings): faza 11 - sectiunea Account/Settings completa
```

---

## Faza 12 - Landing Page

**Obiectiv:** Landing page-ul `bi.kimonogroup.ro` ca proiect Next.js separat (sau aceeasi codebase, in functie de decizia din Faza 0).

### Setup

Daca proiect separat:
- Creeaza `apps/landing/` cu Next.js 14 (App Router) + Tailwind + TypeScript
- Configureaza design tokens shared cu app-ul
- Setup i18n cu `next-intl` pentru toggle RO/EN

### Sections (vezi mockup `mockup-landing.png`):

1. **Navbar** - logo, links (Platforma/Integrari/Cum functioneaza/Pricing/Resurse), language toggle, login, "Try free" CTA
2. **Hero** - badge "Platforma BI standalone", headline cu accent orange, subheadline, 2 CTA (Try free 14 zile + Vezi demo), hero device frame cu screenshot dashboard
3. **Integrari** - 4 cards: Shopify (Disponibil), Meta Ads (Disponibil), Google Analytics (Disponibil), WooCommerce (Coming soon Q3 2026)
4. **Logos strip** - "Folosit de magazine eCommerce in Romania si UE" + 6 logos clienti
5. **Platforma (Features)** - 9 feature cards (3x3) pentru cele 9 module
6. **Cum functioneaza** - 3 pasi (Cont + magazin / AI analizeaza / Recomandari)
7. **Testimonial** - quote mare + avatar + nume + functie
8. **Pricing** - 4 tiers (Free, Starter $49, Pro $99 featured, Enterprise $199+)
9. **FAQ** - 6 intrebari frecvente cu accordion (Cum se conecteaza Shopify?, Cat dureaza setup-ul?, etc.)
10. **Dark CTA** - "Magazinul tau merita decizii bazate pe date" + 1 CTA (Try free now)
11. **Footer** - 5 coloane (Brand, Produs, Companie, Resurse, Legal) + copyright

### Continut tradus RO/EN

Pentru fiecare section, foloseste fisiere `messages/ro.json` si `messages/en.json` cu chei structurate.

### SEO

- Meta tags complete (title, description, og:image)
- Structured data (Organization, SoftwareApplication, Product, FAQPage)
- Sitemap.xml
- robots.txt
- Open Graph image custom (1200x630px)
- Performance optimization: image lazy loading, font preload

### Tracking

- Analytics: Plausible sau PostHog (privacy-friendly)
- Conversion tracking pentru "Try free" clicks
- Heatmaps optional (Hotjar sau alternative)

### Acceptance criteria

- Toate sectiunile arata identic cu `mockup-landing.png`
- Bilingv RO/EN cu toggle functional, default RO
- Lighthouse score 90+ pe Performance, Accessibility, Best Practices, SEO
- Mobile responsive perfect
- "Try free" CTA functional (redirect la signup)
- Deploy pe `bi.kimonogroup.ro` (DNS configurat corect)

### Commit
```
feat(landing): faza 12 - landing page bi.kimonogroup.ro complet
```

---

## Faza 13 - Mobile Responsive & Accessibility

**Obiectiv:** Asigurarea ca toata platforma functioneaza perfect pe mobile si e accessible.

### Tasks

1. **Mobile responsive audit** pe fiecare pagina:
   - 375px (iPhone SE)
   - 414px (iPhone Pro Max)
   - 768px (iPad portrait)
   - 1024px (iPad landscape)
   - 1440px (desktop standard)
   - 1920px (desktop large)

2. **Sidebar mobile**:
   - Hamburger menu in header
   - Drawer cu animation slide-in
   - Backdrop pentru close

3. **KPI grids responsive**:
   - 4 cols → 2 cols la <1024px
   - 2 cols → 1 col la <640px
   - Charts row → stack vertical la <1024px

4. **Tables responsive**:
   - Horizontal scroll cu sticky first column la <768px
   - Sau card layout pentru mobile (transform table → cards)

5. **Accessibility**:
   - Focus rings vizibile pe inputs/buttons (orange)
   - Keyboard navigation (Tab order)
   - Skip links pentru screen readers
   - ARIA labels pe iconite si buttons
   - Contrast ratio AA minim peste tot
   - Alt text pe imagini

6. **Performance**:
   - Lazy loading pentru charts heavy
   - Code splitting per route
   - Image optimization
   - Bundle size analysis

### Acceptance criteria

- Lighthouse 90+ accessibility pe toate paginile
- Pagini load <2s pe LTE 4G
- Sidebar drawer functioneaza pe mobile
- Tables sunt scrollabile sau carduri pe mobile

### Commit
```
feat(polish): faza 13 - mobile responsive si accessibility
```

---

## Faza 14 - Polish, Testing, Launch Prep

**Obiectiv:** Final touches inainte de lansare publica.

### Tasks

1. **Empty states** cu ilustratii subtile pentru fiecare pagina fara date
2. **Error boundaries** cu design consistent + retry button
3. **Toast notifications** pentru actions (success, error, info)
4. **Loading transitions** intre pagini
5. **Unit tests** pentru utility functions (formatCurrency, etc.)
6. **Integration tests** pentru auth flow si workspace switching
7. **E2E tests** pentru flow-urile critice (signup, connect store, view dashboard)
8. **Sentry** pentru error tracking
9. **Analytics** (PostHog/Plausible) pentru product analytics
10. **Email templates** transactional (welcome, verification, invite, weekly digest)
11. **Documentation** pentru API public (daca exista)
12. **Privacy Policy + Terms** pages
13. **Cookie consent banner** (GDPR)
14. **Status page** (status.kimonogroup.ro sau similar)

### Acceptance criteria

- Zero erori in consola browser pe nicio pagina
- Toate flow-urile critice acoperite de teste
- Sentry primeste evenimente test
- Analytics captureaza pageviews si conversions
- GDPR compliant (data export + deletion endpoints)

### Commit
```
feat(launch): faza 14 - polish final, testing, GDPR, launch prep
```

---

## Verificare finala

Inainte sa consideri proiectul "complete":

- [ ] Toate paginile din MOCKUP_SPECS sunt implementate
- [ ] Design system v2 e aplicat consistent peste tot
- [ ] Multi-tenancy functioneaza (workspaces + team members + roles)
- [ ] 3 integrari Phase 1 conectate (Shopify, Meta, GA4)
- [ ] WooCommerce marcat "Coming soon"
- [ ] Landing page deployment pe bi.kimonogroup.ro
- [ ] Bilingv RO/EN cu toggle
- [ ] Mobile responsive perfect
- [ ] Accessibility AA
- [ ] Performance Lighthouse 90+
- [ ] GDPR compliant
- [ ] Niciun m-dash in cod sau text afisat
- [ ] Toate textele in romana cu diacritice consistent

## Estimari de timp totale

| Faza | Estimare |
|------|----------|
| 0. Discovery | 1-2 ore |
| 1. Foundation | 2-3 ore |
| 2. Auth & Multi-tenancy | 6-8 ore |
| 3. Integrari | 8-10 ore |
| 4. Atomic UI | 4-5 ore |
| 5. Layout | 3-4 ore |
| 6. Data Display | 6-8 ore |
| 7. Dashboard | 4-5 ore |
| 8. AI Advisor + Alerts | 8-10 ore |
| 9. Customer pages | 6-8 ore |
| 10. Reports | 8-12 ore |
| 11. Account/Settings | 6-8 ore |
| 12. Landing | 6-10 ore |
| 13. Mobile/A11y | 4-6 ore |
| 14. Polish | 4-6 ore |
| **TOTAL** | **76-105 ore Claude Code** |

Esalonate pe 3-6 saptamani de lucru, cu sesiuni de 4-8 ore per zi.
