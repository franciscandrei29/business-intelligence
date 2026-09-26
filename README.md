# Business Intelligence Platform

Analytics app for e-commerce stores. You connect your Shopify, WooCommerce, or eMAG store and it syncs orders, products, and customers every hour. From there it calculates margins, RFM segments, cohorts, forecasts, stock alerts, and a bunch more. There's a Stripe-based billing system, team invites, and a courier cost tracker that reconciles SameDay invoices against individual AWBs.

I built this with Claude Code. The whole thing, from schema design to production deploy.

## Stack

Remix 2 + Vite + TypeScript on the frontend and server. PostgreSQL with Prisma (17 models, proper migrations). Stripe handles billing. Brevo handles transactional email. Runs on a Linux VPS with PM2 in cluster mode (4 instances) behind Apache with SSL. 12 cron jobs handle the background work.

## What it does

### Connectors

Shopify (OAuth with token refresh, incremental sync, webhooks), WooCommerce (REST API), eMAG (marketplace API), SameDay Courier (AWB tracking and invoice reconciliation), Google Analytics (OAuth), Meta Ads (ad spend data).

### Analytics

The app has 13 analytics modules, each with its own route and business logic:

- Dashboard with KPI comparison across periods (today, 7d, 30d, 90d, YTD)
- RFM segmentation that scores customers and syncs segment tags back to Shopify
- Monthly retention cohorts with revenue tracking
- 30/60/90 day revenue forecasts
- Daily margin calculations (COGS, margin %, per-product profitability)
- Customer lifetime value
- Churn detection for at-risk customers
- Stock alerts based on sales velocity (predicts when you'll run out)
- BCG matrix for product portfolio (stars, cash cows, dogs, question marks)
- Basket analysis for cross-sell opportunities
- Turnover breakdown with CSV export
- Pricing analysis (discount impact)
- Courier cost tracking per AWB, overcost detection, invoice matching

### AI features

An AI advisor that runs causal analysis on store data and gives recommendations. An "Ask AI" chat where you ask questions about your business in plain language. Weekly auto-generated narrative reports with PDF export. Anomaly detection that flags unusual patterns.

### Platform stuff

Multi-store support (connect several shops, switch between them). Team invites with Admin/Viewer roles. Four pricing tiers (Free/Starter/Growth/Scale) with trial. A super-admin panel with user management and impersonation. Shareable report links. Email digests on a schedule.

## Architecture

```
app/
├── routes/           # 60+ Remix routes (pages + API endpoints)
├── lib/
│   ├── auth/         # Session, password hashing, rate limiting
│   ├── connectors/   # Shopify, WooCommerce, eMAG adapters
│   ├── rfm/          # RFM segmentation engine
│   ├── cohorts/      # Retention cohort calculations
│   ├── forecast/     # Revenue forecasting
│   ├── margin/       # Profit margin analysis
│   ├── churn/        # Churn prediction
│   ├── stock/        # Inventory alerts
│   ├── sameday/      # Courier invoice reconciliation
│   ├── stripe/       # Billing webhook handler
│   ├── pdf/          # Report PDF generation
│   └── digest/       # Email digest builder
├── components/       # Shared UI components
└── styles/           # Design tokens + global CSS

scripts/              # 30+ cron jobs and backfill scripts
prisma/               # Schema + migrations
```

## Cron jobs

12 scheduled jobs run in the background:

- `cron-sync` runs hourly, pulls new orders/products/customers from connected stores
- `cron-rfm`, `cron-cohorts`, `cron-margin-daily`, `cron-forecast`, `cron-stock-alerts`, `cron-anomalies` all run daily
- `cron-digest`, `cron-ltv-weekly`, `cron-narrative`, `cron-advisor-insights` run weekly
- `cron-sameday` syncs courier AWBs and matches them against invoices daily

## Database

PostgreSQL with Prisma. 17 models: `User`, `UserSession`, `TeamMembership` for auth. `StoreConnection` and `StoreSettings` for the multi-platform connector layer. `Order`, `Customer`, `Product` for the core data. `RfmSegment`, `Cohort`, `DailyMargin`, `DailyForecast` for computed analytics. `CourierTracking` and `SamedayInvoice` for logistics. `Subscription` for Stripe state. `AiInsight` and `AiReport` for generated content.

## Setup

```bash
npm install
cp .env.example .env    # fill in DB URL, Stripe keys, etc.
npx prisma migrate deploy
npm run build
npm start
```

## Deploy

PM2 cluster mode with 4 workers, Apache reverse proxy, Let's Encrypt SSL. Cron jobs are plain system crontab entries calling the scripts in `scripts/`.

## How Claude Code was used

I used Claude Code for basically everything here. Schema design, route structure, each analytics module (the RFM scoring, cohort calculations, forecast math, margin logic), all the API integrations (Shopify OAuth, Stripe webhooks, SameDay courier API, Brevo email), and the 12 cron jobs.

Where I had to correct it: Claude Code sometimes over-engineered things with unnecessary abstractions that I flattened. It wrote Shopify GraphQL calls with fields that had been deprecated in the 2025-04 API version. It didn't know Romanian courier invoice formats (SameDay CSV structure, what fields to match on), so I had to guide it through that. It also needed explicit instructions on RON decimal handling for financial calculations.

Production debugging was done in Claude Code sessions too. PM2 was hitting the 1GB memory limit because of connection pool leaks, Prisma needed `connection_limit` tuning, and the Shopify OAuth token refresh had a race condition where two cron runs would try to refresh the same token simultaneously.
