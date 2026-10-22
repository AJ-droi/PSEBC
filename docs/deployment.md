# Deployment (zero budget, UK/EU hosting)

| Piece | Free option | Region |
| --- | --- | --- |
| Database | **Neon** free plan | AWS London (`eu-west-2`) |
| API (Express) | **Render** free web service (`render.yaml`) — or Railway / Fly / any Docker host (`apps/api/Dockerfile`) | Frankfurt |
| Web app (Next.js PWA) | **Vercel** Hobby (non-commercial charity use) — or Netlify / Render | choose `lhr1` / `fra1` function region |
| Scheduled checks | GitHub Actions (`.github/workflows/scheduled-jobs.yml`) | — |

## 1. Neon

1. Create a project at neon.tech → region **London (AWS eu-west-2)** → database `psebc`.
2. Copy the **pooled** connection string (host contains `-pooler`), with `?sslmode=require`.
3. Run the migrations and (only for a demo) the seed from your machine:

   ```bash
   DATABASE_URL="postgresql://…-pooler…/psebc?sslmode=require" \
   JWT_SECRET=x DATA_ENCRYPTION_KEY=$(openssl rand -base64 32) \
   npm run db:migrate
   ```
   Migrations also run automatically every time the API starts.

4. Create a second Neon *branch* for testing (`TEST_DATABASE_URL`) — the journey test wipes its database.

## 2. API on Render

1. New → Blueprint → point at this repository (uses `render.yaml`).
2. Fill the secret values:
   * `DATABASE_URL` — the Neon pooled string
   * `DATA_ENCRYPTION_KEY` — `openssl rand -base64 32` (**keep a copy in the church password manager — losing it makes health notes unreadable**)
   * `WEB_ORIGIN` — the web app URL, e.g. `https://lifts.princesstreet.org`
3. Check `https://<api>/api/health` returns `{"ok":true}`.

Render's free plan sleeps after 15 minutes idle. The GitHub Actions cron (step 4) wakes it every 10 minutes,
so lifts stay responsive around services. For a guaranteed always-on API, use any small paid plan later.

## 3. Web app on Vercel

1. Import the repository → **Root directory** `apps/web` → framework Next.js.
2. Environment variable `API_URL=https://<your-api-host>` (no trailing slash).
3. Optional: add the church's domain. The app is installable from the browser ("Add to Home Screen").

## 4. Scheduled checks

In GitHub → Settings → Secrets → Actions add `API_BASE_URL` (the API URL) and `JOBS_SECRET`
(copy it from the Render environment). The workflow then calls `POST /api/jobs/run` every 10 minutes:
unmatched alerts (24 h / 2 h), 72-hour log timeout, DBS/insurance reminders and expiry, day-before
reminders, data retention and the notification outbox.

## 5. Text messages and email

By default messages are written to the app and logged (`NOTIFY_*_DRIVER=console`). To send real texts
and emails without paying for extra software, set both drivers to `webhook` and `NOTIFY_WEBHOOK_URL` to a
flow that accepts JSON `{ channel, to, subject, body }` — for example a **Power Automate** flow on the
church's Microsoft 365 (dependency in PRD §11) or GOV.UK Notify / Twilio. Only the webhook adapter in
`apps/api/src/services/notify.ts` needs changing if a provider needs a different format.

## 6. First real users

1. Sign in as the seeded admin **only on a demo database**. On the live database, create the first admin
   directly:

   ```sql
   -- password hash from: node -e "console.log(require('bcryptjs').hashSync('a long password', 12))"
   INSERT INTO users (email, full_name, role, password_hash) VALUES ('office@…', 'Church Admin', 'admin', '<hash>');
   ```
2. Admin → Logins: add Mathias (safeguarding) and coordinators. Both admin and safeguarding set up an
   authenticator app on first sign-in.
3. Settings such as the church office phone number live in the `settings` table.

## 7. Backups

Neon keeps point-in-time history (free plan: 24 h). Add a weekly `pg_dump` (e.g. a GitHub Action writing to
the church's OneDrive) if longer retention is required by the safeguarding policy (trip logs: 6 years).
