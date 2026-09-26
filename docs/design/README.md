# Kimono BI - Pachet Redesign Complet

Pachet de documentatie pentru transformarea Kimono BI din app Shopify embedded intr-o platforma SaaS standalone multi-tenant cu design premium inspirat din Stripe.

## Citeste in ordinea asta

1. **[01-ARCHITECTURE.md](./docs/01-ARCHITECTURE.md)** - Decizia de multi-tenancy si arhitectura generala. Aici sunt clarificate cerintele de business (workspaces, team members, integrari).

2. **[02-DESIGN_SYSTEM.md](./docs/02-DESIGN_SYSTEM.md)** - Tokens, componente, layout patterns. Tot UI-ul se bazeaza pe acest document.

3. **[03-MOCKUP_SPECS.md](./docs/03-MOCKUP_SPECS.md)** - Specificatii detaliate pentru fiecare pagina din platforma. Complementeaza screenshot-urile.

4. **[04-EXECUTION_PLAN.md](./docs/04-EXECUTION_PLAN.md)** - Planul de executie pe 14 faze cu acceptance criteria.

5. **[05-CLAUDE_CODE_GUIDE.md](./docs/05-CLAUDE_CODE_GUIDE.md)** - Ghid practic cum rulezi tot in Claude Code pe VPS-ul tau.

## Mockup-uri vizuale

Salveaza screenshot-urile vizibile in chat-ul tau cu Claude in folder `mockups/`:
- `mockup-dashboard.png` - Today / Dashboard page
- `mockup-ai-advisor.png` - AI Advisor full page
- `mockup-smart-alerts.png` - Smart Alerts page
- `mockup-rfm.png` - RFM Segments page
- `mockup-inventory.png` - Inventory Intelligence page
- `mockup-settings.png` - Settings page
- `mockup-landing.png` - Landing page bi.kimonogroup.ro

## Decizii de business luate

- **Platforma SaaS standalone**, nu Shopify App embedded
- **Domeniu**: bi.kimonogroup.ro
- **Self-serve** model cu free trial 14 zile
- **Bilingv RO/EN** cu toggle, default RO
- **Multi-tenant** cu workspaces si team members
- **Integrari Phase 1**: Shopify (primary), Meta Ads, Google Analytics 4
- **Integrare WooCommerce**: marcata "Coming soon Q3 2026"

## Decizii lasate pentru Claude Code

- Framework (Next.js vs Remix vs alta)
- Cum sa abordeze codul existent (refactor vs migrare)
- Solutia de autentificare (Clerk, Auth.js, Better-auth, etc.)
- Database ORM (Prisma deja folosit, dar poate sugera alternative)
- Hosting (Railway deja folosit, dar poate sugera Vercel pentru Next.js)

Aceste decizii vor fi luate in Faza 0 (Discovery), pe baza investigatiei codului existent si a cerintelor de business.

## Structura recomandata folder docs/design pe VPS

```
kimono-bi/
├── docs/
│   └── design/
│       ├── 01-ARCHITECTURE.md
│       ├── 02-DESIGN_SYSTEM.md
│       ├── 03-MOCKUP_SPECS.md
│       ├── 04-EXECUTION_PLAN.md
│       ├── 05-CLAUDE_CODE_GUIDE.md
│       └── mockups/
│           ├── mockup-dashboard.png
│           ├── mockup-ai-advisor.png
│           ├── mockup-smart-alerts.png
│           ├── mockup-rfm.png
│           ├── mockup-inventory.png
│           ├── mockup-settings.png
│           └── mockup-landing.png
```
