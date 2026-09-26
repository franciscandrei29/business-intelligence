# 01 - Architecture & Business Requirements

## Context business

Kimono BI evolueaza dintr-un **Shopify App embedded** intr-o **platforma SaaS standalone**. Aceasta tranzitie schimba fundamental:

1. Cum se autentifica utilizatorii (login propriu, nu Shopify session)
2. Cum se conecteaza magazinele (OAuth integration, nu embedded)
3. Cum se factureaza (billing propriu, nu Shopify Billing API)
4. Cum se acceseaza (URL propriu bi.kimonogroup.ro, nu shop.shopify.com/admin/apps/...)

## Decizia de multi-tenancy

Platforma functioneaza pe model **multi-tenant cu workspaces si team members**.

### Modelul de date

```
User (authenticated identity)
  ├─ workspaces (many-to-many via WorkspaceMember)
  └─ created_workspaces (one-to-many)

Workspace (tenant)
  ├─ owner: User
  ├─ members: WorkspaceMember[]
  ├─ stores: Store[]
  ├─ subscription: Subscription
  └─ settings: WorkspaceSettings

WorkspaceMember
  ├─ user: User
  ├─ workspace: Workspace
  ├─ role: 'owner' | 'admin' | 'analyst' | 'viewer'
  └─ joined_at: timestamp

Store (Shopify/WooCommerce store conectat)
  ├─ workspace: Workspace
  ├─ platform: 'shopify' | 'woocommerce'
  ├─ shop_url: string
  ├─ access_token: encrypted
  └─ sync_status: 'syncing' | 'synced' | 'error'
```

### Roluri si permisiuni

- **Owner** - full access, billing control, poate sterge workspace
- **Admin** - full access, dar nu billing si nu poate sterge workspace
- **Analyst** - poate vedea toate datele, executa actiuni (campanii, comenzi furnizori)
- **Viewer** - read-only, doar vizualizare rapoarte

### Use cases acoperite

1. **Solo founder** - 1 user, 1 workspace, 1 magazin (cazul cel mai simplu)
2. **Brand cu echipa** - 1 user owner, 3-5 team members in 1 workspace cu 1 magazin
3. **Agentie** (Kimono Group e exact asta) - 1 user owner, multiple workspaces, fiecare cu propriul brand client
4. **Multi-brand** - 1 user, 1 workspace, multiple stores (ex: vivimall.ro + vivimall.com)

### Switching workspace

UI: dropdown in colt stanga sus (langa logo) care arata workspace activ + lista workspace-uri disponibile + buton "+ Creeaza workspace nou".

URL pattern: `bi.kimonogroup.ro/{workspace-slug}/dashboard`

Asta inseamna ca toate route-urile sunt namespaced cu workspace slug. Exemplu:
- `bi.kimonogroup.ro/vivimall/dashboard`
- `bi.kimonogroup.ro/rama-textil/ai-advisor`
- `bi.kimonogroup.ro/kimono-group/customers/rfm`

## Domeniu si infrastructure

### Subdomeniu

`bi.kimonogroup.ro` - DNS pointat catre hosting-ul aplicatiei (Railway sau Vercel).

### Auth domain considerations

Daca foloseste cookies pentru session, atentie ca subdomeniul `bi.` poate avea cookies separate de `kimonogroup.ro`. Foloseste `Domain=.kimonogroup.ro` daca doriti single sign-on intre platforme.

### Email domain

Pentru emailuri tranzactionale (signup verification, password reset, weekly digest), foloseste:
- From: `noreply@bi.kimonogroup.ro` sau `team@kimonogroup.ro`
- Servicii recomandate: Resend (modern, dev-friendly), Postmark (reliability) sau AWS SES (cost)

## Integrari

### Phase 1 (lansare)

1. **Shopify** (primary)
   - OAuth flow: user instaleaza Kimono BI app in Shopify Admin -> redirectionare la bi.kimonogroup.ro -> save store + access_token
   - Sau user adauga store manual din settings -> click "Conecteaza Shopify" -> redirectionare la Shopify OAuth -> redirect back
   - Scopes necesare: `read_orders, read_products, read_customers, read_inventory, read_analytics, read_marketing_events`

2. **Meta Ads (Facebook + Instagram)**
   - OAuth via Facebook Login + Marketing API
   - Scopes: `ads_read, business_management`

3. **Google Analytics 4**
   - OAuth via Google + Analytics Data API v1
   - Scopes: `analytics.readonly`

### Phase 2 (Q3 2026)

- **WooCommerce** - REST API + WordPress OAuth (mai complicat decat Shopify)
- **Klaviyo** - email marketing analytics
- **TikTok Ads** - daca clientii cer

### Phase 3 (Q4 2026+)

- **Stripe** - pentru clienti SaaS (nu doar eCommerce)
- **HubSpot** - CRM integration
- **Custom integrations** via API + webhooks

## Auth flow recomandat

(Decizia finala ramane Claude Code)

### Flow signup

1. Landing page `/` -> click "Try free"
2. Signup form: email + password (sau "Continue with Google")
3. Verificare email (link cu token)
4. Onboarding wizard:
   - Step 1: "Cum se numeste businessul tau?" -> creeaza primul workspace
   - Step 2: "Conecteaza primul magazin" -> Shopify OAuth
   - Step 3: "Invita team members?" -> optional, skip
   - Step 4: "Setari notificari" -> default ON pentru alerts critice
5. Redirectionare la `/{workspace-slug}/dashboard`

### Flow login

1. Landing -> click "Login"
2. Email + password (sau "Continue with Google")
3. Daca user are 1 workspace -> redirect direct la dashboard
4. Daca user are 2+ workspaces -> screen "Choose workspace"
5. Daca user e invitat dar nu a confirmat -> screen "Accept invitation"

## Database considerations

Prisma e deja folosit, deci pastram. Schema noua va contine:

- Tabela `User` (separata de `Store`)
- Tabela `Workspace` (tenant container)
- Tabela `WorkspaceMember` (join table cu role)
- Tabela `Store` (link la Workspace)
- Tabela `Subscription` (per Workspace)
- Tabela `Invitation` (pentru invite flow)
- Toate tabelele existente (`AIInsight`, `Alert`, `Cohort`, etc.) au foreign key catre `Workspace`, nu catre `Store` direct (asta permite analize cross-store in viitor)

## Migration path de la app embedded la standalone

Daca exista users existenti pe app-ul Shopify, planul de migratie:

1. **Lansare paralela** - app embedded ramane functional inca 30 zile
2. **Email catre useri existenti** - "Migram la platforma standalone, click sa-ti creezi cont"
3. **Auto-migration** - cand user logheaza prima oara, creezi workspace + Store din session-ul Shopify
4. **Sunset app embedded** - dupa 30 zile, redirect din app embedded catre bi.kimonogroup.ro

Daca nu exista users, ignora aceasta sectiune.

## Performance & scale considerations

- **Caching**: Redis pentru session + rate limiting + cache pentru dashboard data (refresh la 5 min)
- **Background jobs**: pentru sync Shopify, generare AI insights (BullMQ + Redis sau Trigger.dev)
- **Database**: PostgreSQL (Neon e ok pentru inceput, scaleaza la AWS RDS daca e nevoie)
- **CDN**: pentru landing page si assets statice (Cloudflare sau Vercel Edge)

## Security & compliance

- **Encryption at rest** pentru access tokens (Shopify, Meta, Google)
- **HTTPS only**, no HTTP fallback
- **Rate limiting** pe API endpoints
- **GDPR compliance**:
  - Privacy policy pe landing
  - Cookie consent banner
  - Data export endpoint per workspace
  - Data deletion endpoint per workspace
- **SOC 2** considerations pentru clientii enterprise (Phase 3)

## Pricing si billing

(Decizia ramane sa o iei tu, dar recomandam structura asta pentru consistent cu mockup-ul)

| Plan | Pret | Comenzi/luna | Workspaces | Team members |
|------|------|--------------|------------|--------------|
| Free | 0 | <100 | 1 | 1 |
| Starter | $49 | <1000 | 1 | 3 |
| Pro | $99 | <5000 | 3 | 10 |
| Enterprise | $199+ | 5000+ | unlimited | unlimited |

Billing per workspace (nu per user). User-ul cu rol Owner gestioneaza billing.

Solutie billing recomandata: **Stripe Subscriptions** (Stripe e standard pentru SaaS, integration trivial).

## Cerinte tehnice non-functionale

- **Page load time**: <2s pe LTE 4G
- **Time to interactive**: <3s pe desktop
- **Lighthouse**: 90+ pe toate paginile critice
- **Uptime**: 99.5% target
- **Backup**: PostgreSQL daily snapshots, retention 30 zile
- **Monitoring**: Sentry pentru erori + Plausible/PostHog pentru analytics
