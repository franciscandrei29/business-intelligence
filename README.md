# Business Intelligence Platform

Aplicatie de analytics pentru magazine online. Conectezi magazinul tau Shopify, WooCommerce sau eMAG si ea sincronizeaza comenzi, produse si clienti in fiecare ora. De acolo calculeaza marje, segmente RFM, cohorte de retentie, previziuni vanzari, alerte stoc si multe altele. Are billing prin Stripe, invite-uri de echipa si un tracker de costuri curierat care reconciliaza facturile SameDay cu fiecare AWB in parte.

## Stack

Remix 2 + Vite + TypeScript pe frontend si server. PostgreSQL cu Prisma (17 modele, migratii). Stripe pentru billing. Brevo pentru email tranzactional. Ruleaza pe un VPS Linux cu PM2 in cluster mode (4 instante) in spatele Apache cu SSL. 12 cron jobs se ocupa de procesarile din background.

## Ce face

### Conectori

Shopify (OAuth cu token refresh, sync incremental, webhooks), WooCommerce (REST API), eMAG (API marketplace), SameDay Courier (tracking AWB-uri si reconciliere facturi), Google Analytics (OAuth), Meta Ads (date de cheltuieli pe reclame).

### Analytics

Aplicatia are 13 module de analytics, fiecare cu ruta si logica de business proprie:

- Dashboard cu comparatie KPI pe perioade (azi, 7z, 30z, 90z, YTD)
- Segmentare RFM care scoreaza clientii si sincronizeaza tag-urile de segment inapoi in Shopify
- Cohorte lunare de retentie cu tracking pe venituri
- Previziuni venituri la 30/60/90 zile
- Calcule zilnice de marje (COGS, procent marja, profitabilitate per produs)
- Customer lifetime value
- Detectie churn pentru clienti in risc
- Alerte stoc bazate pe viteza de vanzare (prezice cand ramai fara stoc)
- Matrice BCG pentru portofoliu produse (stars, cash cows, dogs, question marks)
- Analiza cos cumparaturi pentru oportunitati de cross-sell
- Defalcare turnover cu export CSV
- Analiza pricing (impact discount-uri)
- Tracking cost curierat per AWB, detectie overcost, matching cu facturi

### Functii AI

Un advisor AI care ruleaza analiza cauzala pe datele magazinului si da recomandari. Un chat "Ask AI" unde pui intrebari despre business in limbaj natural. Rapoarte narative saptamanale generate automat cu export PDF. Detectie anomalii care semnaleaza pattern-uri neobisnuite.

### Platforma

Suport multi-magazin (conectezi mai multe shop-uri, comuti intre ele). Invite-uri echipa cu roluri Admin/Viewer. Patru planuri de pret (Free/Starter/Growth/Scale) cu trial. Panou super-admin cu management utilizatori si impersonare. Link-uri publice pentru rapoarte. Digest-uri email programate.

## Arhitectura

```
app/
├── routes/           # 60+ rute Remix (pagini + endpoint-uri API)
├── lib/
│   ├── auth/         # Sesiuni, hashing parole, rate limiting
│   ├── connectors/   # Adaptoare Shopify, WooCommerce, eMAG
│   ├── rfm/          # Motor segmentare RFM
│   ├── cohorts/      # Calcule cohorte retentie
│   ├── forecast/     # Previziuni venituri
│   ├── margin/       # Analiza marje profit
│   ├── churn/        # Predictie churn
│   ├── stock/        # Alerte inventar
│   ├── sameday/      # Reconciliere facturi curierat
│   ├── stripe/       # Handler webhook billing
│   ├── pdf/          # Generare PDF rapoarte
│   └── digest/       # Builder digest email
├── components/       # Componente UI comune
└── styles/           # Design tokens + CSS global

scripts/              # 30+ cron jobs si scripturi backfill
prisma/               # Schema + migratii
```

## Cron jobs

12 job-uri programate ruleaza in background:

- `cron-sync` ruleaza la fiecare ora, trage comenzi/produse/clienti noi din magazinele conectate
- `cron-rfm`, `cron-cohorts`, `cron-margin-daily`, `cron-forecast`, `cron-stock-alerts`, `cron-anomalies` ruleaza zilnic
- `cron-digest`, `cron-ltv-weekly`, `cron-narrative`, `cron-advisor-insights` ruleaza saptamanal
- `cron-sameday` sincronizeaza AWB-uri curierat si le matchuieste cu facturile zilnic

## Baza de date

PostgreSQL cu Prisma. 17 modele: `User`, `UserSession`, `TeamMembership` pentru autentificare. `StoreConnection` si `StoreSettings` pentru layerul de conectori multi-platforma. `Order`, `Customer`, `Product` pentru datele de baza. `RfmSegment`, `Cohort`, `DailyMargin`, `DailyForecast` pentru analytics calculat. `CourierTracking` si `SamedayInvoice` pentru logistica. `Subscription` pentru starea Stripe. `AiInsight` si `AiReport` pentru continut generat.

## Setup

```bash
npm install
cp .env.example .env    # completezi DB URL, chei Stripe, etc.
npx prisma migrate deploy
npm run build
npm start
```

## Deploy

PM2 cluster mode cu 4 workeri, Apache reverse proxy, SSL Let's Encrypt. Cron jobs sunt simple intrari in crontab-ul sistemului care apeleaza scripturile din `scripts/`.
