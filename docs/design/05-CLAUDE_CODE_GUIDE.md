# 05 - Cum rulezi tot in Claude Code

Ghid practic pas cu pas pentru a executa intreg redesign-ul Kimono BI in Claude Code pe VPS-ul tau.

## Pasul 1: Pregateste fisierele pe VPS

SSH pe VPS:

```bash
ssh -p 2112 user@server.kimonogroup.ro
```

Navigheaza in repo-ul Kimono BI:

```bash
cd /path/to/kimono-bi
```

Creeaza folder-ul de documentatie design:

```bash
mkdir -p docs/design/mockups
```

Copiaza cele 6 fisiere markdown si cele 7 mockup screenshots in `docs/design/`:

```
docs/design/
├── README.md
├── 01-ARCHITECTURE.md
├── 02-DESIGN_SYSTEM.md
├── 03-MOCKUP_SPECS.md
├── 04-EXECUTION_PLAN.md
├── 05-CLAUDE_CODE_GUIDE.md (acest fisier)
└── mockups/
    ├── mockup-dashboard.png
    ├── mockup-ai-advisor.png
    ├── mockup-smart-alerts.png
    ├── mockup-rfm.png
    ├── mockup-inventory.png
    ├── mockup-settings.png
    └── mockup-landing.png
```

## Pasul 2: Fa branch nou de lucru

```bash
git checkout -b redesign/standalone-saas-v2
git add docs/design/
git commit -m "docs: design system si execution plan pentru redesign standalone"
git push origin redesign/standalone-saas-v2
```

Aceasta protejeaza branch-ul main de modificari accidentale si iti permite sa testezi local inainte sa merge-uiesti.

## Pasul 3: Porneste Claude Code

```bash
cd /path/to/kimono-bi
claude
```

## Pasul 4: Comanda initiala (Faza 0 - Discovery)

Copiaza si lipeste exact aceasta comanda:

```
Citeste in ordine documentele din docs/design/:

1. README.md - overview si decizii business
2. 01-ARCHITECTURE.md - arhitectura multi-tenant
3. 02-DESIGN_SYSTEM.md - tokens si componente
4. 03-MOCKUP_SPECS.md - specificatii pagini
5. 04-EXECUTION_PLAN.md - plan executie 14 faze
6. 05-CLAUDE_CODE_GUIDE.md - ghidul de utilizare

Apoi investigheaza repo-ul existent:
- package.json - dependinte
- Structura folder app/ sau src/
- prisma/schema.prisma - schema DB
- Orice deployment configs (railway.toml, vercel.json, dockerfile)
- KIMONO-BI-SHOPIFY-APP-MASTER.md sau alte master docs

Scopul: vreau sa generezi un DISCOVERY_REPORT.md in docs/design/ cu:
- Stack curent identificat
- Recomandare framework target (Next.js / Remix / alta) cu justificare
- Recomandare strategie codebase (refactor vs migrate vs hybrid)
- Recomandare auth solution (Clerk / Auth.js / Better-auth / alta) cu pro/con
- Recomandare schema DB pentru multi-tenancy
- Recomandare hosting
- Risc-uri identificate
- Estimari de timp pentru fiecare faza ulterioara

NU scrie inca cod. Doar planifica si raporteaza. Astept sa aprob inainte sa incepi Faza 1.
```

Claude Code va investiga, apoi va raspunde cu raportul. Citeste-l atent.

## Pasul 5: Aproba Faza 0 si trece la Faza 1

Daca raportul iti pare OK:

```
OK, planul arata bine. Incepe Faza 1 (Foundation).

Inainte sa incepi:
1. Verifica ca esti pe branch redesign/standalone-saas-v2
2. Citeste din nou 04-EXECUTION_PLAN.md sectiunea Faza 1

Cand termini:
1. Ruleaza npm run typecheck && npm run lint && npm run build
2. Ruleaza npx prisma migrate dev (daca ai modificat schema)
3. Commit cu mesaj: "feat(foundation): faza 1 - setup, design tokens, multi-tenancy schema"
4. Raporteaza-mi ce ai facut si astept aprobare pentru Faza 2.
```

Daca vrei sa schimbi ceva din raport (de ex. preferi alt framework sau alta solutie de auth):

```
Vreau sa modificam recomandarile:
- Folosim Next.js 14 in loc de Remix
- Folosim Clerk pentru auth in loc de Auth.js
- Pastrarea Prisma e OK

Updateaza DISCOVERY_REPORT.md cu aceste decizii si apoi incepe Faza 1.
```

## Pasul 6: Workflow per faza

Pentru fiecare faza ulterioara, urmeaza acelasi pattern:

### A. Verificare locala dupa fiecare faza

Inainte sa autorizez urmatoarea faza, verifica vizual rezultatul:

```bash
# Pe local sau pe VPS, ruleaza app-ul
npm run dev

# Deschide in browser si verifica
# http://localhost:3000 (sau ce port foloseste)
```

### B. Daca arata bine

```
Arata bine. Continua cu Faza N.

Inainte sa incepi:
- Citeste din 04-EXECUTION_PLAN.md sectiunea Faza N
- Asigura-te ca ai citit si Design System (02) pentru consistenta vizuala

Cand termini:
- Verificari standard (typecheck, lint, build)
- Commit cu mesaj prefix feat(scope): faza N
- Raporteaza si astept aprobare
```

### C. Daca ceva nu arata cum trebuie

Fii foarte specific in feedback:

```
La componenta KpiCard, sparkline-ul nu iese pana la marginile cardului.
Verifica ca margin-ul negativ sa fie -18px stanga si dreapta.
Vezi specificatia in 02-DESIGN_SYSTEM.md sectiunea "KPI Card".
```

Sau:

```
Sidebar-ul nu are workspace switcher. Re-citeste 02-DESIGN_SYSTEM.md sectiunea "Workspace Switcher" si 03-MOCKUP_SPECS.md.
```

### D. Daca Claude Code se blocheaza

Daca raspunde cu cod care nu se compileaza sau face cerc:

```
Stop. Resetam contextul.

Recapituleaza:
1. La ce faza esti?
2. Ce fisiere ai modificat in faza curenta?
3. Care e eroarea exacta pe care nu o poti rezolva?

Apoi astept sa imi propui o solutie inainte sa scrii cod.
```

## Pasul 7: Intre faze, foloseste /clear

Dupa ce o faza e merged si confirmata, ruleaza `/clear` in Claude Code ca sa resetezi contextul si sa nu se umple cu istoria fazelor anterioare:

```
/clear
```

Apoi continua:

```
Continuam redesign-ul Kimono BI. Citeste docs/design/04-EXECUTION_PLAN.md si spune-mi unde am ramas (verifica git log pentru ultimele commit-uri cu prefix feat(...)). Apoi incepe urmatoarea faza.
```

## Pasul 8: Verificari intermediare

### Dupa fiecare 2-3 faze, verifica:

```bash
# Bundle size
npm run build
ls -lh .next/static/chunks/*.js  # sau echivalent

# Database migrations
npx prisma migrate status

# Type errors
npm run typecheck

# Tests (daca ai)
npm test
```

### Verificari vizuale recomandate:

- Deschide app-ul local in 2 browsere (Chrome + Firefox)
- Testeaza pe mobile (DevTools Responsive Mode la 375px si 768px)
- Verifica dark mode (daca implementat)
- Click pe toate butoanele principale

## Pasul 9: Deploy intermediar

Dupa Faza 7 (Dashboard) sau Faza 11 (Settings), poti face deploy de testare:

```bash
# Daca esti pe Railway
railway up

# Daca esti pe Vercel
vercel --prod
```

Asa poti vedea cum arata pe productie (cu DB-ul real) inainte sa termini totul.

## Pasul 10: Cand ai terminat toate fazele

```bash
# Merge in main
git checkout main
git merge redesign/standalone-saas-v2

# Tag release
git tag -a v2.0.0 -m "Release: Kimono BI standalone SaaS platform"
git push origin main --tags

# Deploy productie
railway up  # sau vercel --prod
```

## Sfaturi importante

### A. Fa sesiuni de 4-8 ore, nu mai mult

Claude Code consuma context tokens. Dupa 8+ ore, raspunsurile devin mai vagi sau face greseli. Mai bine 6 sesiuni de 4 ore decat 2 sesiuni de 12 ore.

### B. Salveaza chat-uri importante

In Claude Code, daca primesti un raspuns important (ex: arhitectura recomandata), copy-paste in `docs/design/decisions/` ca arhiva.

### C. Foloseste git diff inainte de commit

```bash
git diff HEAD~1
```

Verifici exact ce a modificat. Daca e ceva surpriza, intoarce sau corecteaza.

### D. Ruleaza prettier dupa fiecare commit

```bash
npx prettier --write app/
git add -A
git commit -m "style: format code with prettier"
```

Asa pastrezi codul curat si consistent.

### E. Fa backup database inainte de migrations risk-y

```bash
pg_dump $DATABASE_URL > backup-pre-migration-$(date +%Y%m%d).sql
```

Mai ales inainte de Faza 1 cand ai schema noua de multi-tenancy.

### F. Intre faze, testeaza pe device-uri reale

- Telefonul tau (iOS si Android daca ai)
- Tableta
- Laptop cu rezolutie diferita

Mockup-urile arata bine in DevTools, dar pe device real e o experienta diferita.

### G. Comunica clar in feedback

In loc de "nu arata bine", spune:

- "Cardurile au padding 24px in loc de 18px asa cum e in design system"
- "Sparkline-ul ar trebui sa fie portocaliu (#D85A30), e albastru acum"
- "Sidebar-ul nu se inchide pe mobile cand click pe link"

Cu cat e mai specific feedback-ul, cu atat Claude Code raspunde mai precis.

## Daca vrei sa incepi mai mic

Daca nu vrei sa faci toate 14 fazele dintr-o singura miscare, prioritatea recomandata e:

**Phase A - Get UI right** (40-50 ore Claude Code):
- Faza 0 - Discovery
- Faza 1 - Foundation
- Faza 4 - Atomic UI
- Faza 5 - Layout
- Faza 6 - Data Display
- Faza 7 - Dashboard

Asta iti da un dashboard frumos cu noul design pe codul existent. Poti decide dupa daca continui.

**Phase B - Multi-tenancy & landing** (30-40 ore):
- Faza 2 - Auth & Multi-tenancy
- Faza 12 - Landing page

Asta deschide platforma catre clienti noi via bi.kimonogroup.ro.

**Phase C - Restul** (40-50 ore):
- Fazele 3, 8, 9, 10, 11
- Faze 13, 14 (polish)

Asta finalizeaza tot.

## Estimare cost Claude Code

Daca lucrezi cu Claude Code in mod intensiv:
- 4 ore session = ~1-2M tokens consumati
- 100 ore total = ~25-50M tokens
- La pretul curent Claude Code (verifica claude.com pentru update), asta e in zona $X-Y total

Plan smart: ruleaza pe Pro plan ($20/luna) si fa sesiuni esalonate, nu marathon-uri.

## Daca ai blocaje sau probleme

Vino inapoi in chat-ul cu mine si descrie:
1. La ce faza esti
2. Ce eroare ai primit (paste din terminal/chat)
3. Ce ai incercat deja

Te ajut sa debuggam si sa continui.
