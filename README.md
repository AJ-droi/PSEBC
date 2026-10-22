# PSEBC Lifts — volunteer transport PWA

Release 1 of the Princes Street Church (PSEBC) transport app, built from **PSEBC PRD v2.0** and the
*PSEBC Transport App* design canvas. Members (or the church office on their behalf) book a lift; the app
invites only safeguarding-approved drivers whose car and skills fit the member's recorded needs; the first
driver to accept gets the lift; both sides log the trip; and the safeguarding lead signs every trip off.

| Layer | Tech |
| --- | --- |
| Web app (PWA) | Next.js 15 (App Router), React 19, TypeScript, SWR, hand-written service worker |
| API | Node 22, Express 4, TypeScript, Zod validation, pino logging |
| Database | PostgreSQL on **Neon** (plain SQL migrations, `pg` driver) |
| Shared | `@psebc/shared` — domain vocabulary, matching rules, ride status machine, request schemas |

```
apps/
  api/          Express API  (src/modules/* = one folder per bounded area)
  web/          Next.js PWA  (app/member, app/driver, app/office, app/safeguarding)
packages/
  shared/       Types, Zod schemas, matching + status rules used by both apps
docs/           Architecture, acceptance-criteria check, deployment, admin guide
```

## Run it locally

Prerequisites: Node 22+, a Postgres database (a free Neon project, or local Postgres 15+).

```bash
npm install

# 1. API settings
cp apps/api/.env.example apps/api/.env
#    set DATABASE_URL (Neon "pooled" connection string), JWT_SECRET and
#    DATA_ENCRYPTION_KEY (openssl rand -base64 32)

# 2. Create tables and demo data (personas from the PRD)
npm run db:seed

# 3. Start API (:4000) and web app (:3000)
npm run dev
```

Open http://localhost:3000 and sign in with any demo account (password `ChangeMe-2026!`):

| Email | Role | Persona |
| --- | --- | --- |
| margaret@psebc.example | Member | Margaret, 82, walking frame |
| david@psebc.example | Driver (approved) | David, estate car, folding wheelchair |
| peter@psebc.example | Driver (approved) | |
| helen@psebc.example | Driver (pending approval) | |
| grace@psebc.example | Booking coordinator | Grace, church office |
| admin@psebc.example | Admin | sets up a security code on first sign-in |
| mathias@psebc.example | Safeguarding lead | sets up a security code on first sign-in |

Admin and safeguarding use multi-factor sign-in (PRD §10): scan the QR code with any authenticator app.

## Tests

```bash
npm test -w @psebc/shared   # 17 unit tests: matching rules + ride status machine
TEST_DATABASE_URL=postgresql://... npm test -w @psebc/api   # 26 journey tests on a real database
npm run typecheck && npm run build
```

The API journey test walks the whole PRD flow and names the Jira key of every acceptance criterion it
checks. **Use a throwaway database for `TEST_DATABASE_URL` — the test drops and recreates the schema.**
CI runs everything on each push (`.github/workflows/ci.yml`).

## Key documents

- [docs/architecture.md](docs/architecture.md) — system design, data model, security, scaling
- [docs/acceptance-criteria.md](docs/acceptance-criteria.md) — every PRD story / Jira key checked against the build
- [docs/deployment.md](docs/deployment.md) — Neon + Render + Vercel on free tiers, UK/EU hosting
- [docs/admin-guide.md](docs/admin-guide.md) — short guide for the volunteer who runs it (PRD §10 maintainability)
