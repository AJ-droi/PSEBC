# Release: Epics 1–3 demo (`v0.3.0-epics-1-3`)

The first deployable cut of PSEBC Lifts. It switches on the first three Jira epics and holds the rest back,
so the church can demo and try onboarding, booking and matching before trip-day features go live.

| Epic | Jira | In this release |
| --- | --- | --- |
| 1 Onboarding and approval | PSEBC-1 (stories PSEBC-7 … PSEBC-11, 1.6, 1.7) | ✅ On |
| 2 Requesting a ride | PSEBC-2 (PSEBC-12 … PSEBC-15) | ✅ On |
| 3 Matching | PSEBC-3 (PSEBC-17 … PSEBC-19; 3.4 is a "Could", not built) | ✅ On |
| 4 Driver found and details shared | PSEBC-4 | ⏸ Off |
| 5 Completing and logging the trip | PSEBC-5 | ⏸ Off |
| 6 Sign-off | PSEBC-6 | ⏸ Off |
| 7 Reporting dashboard | PSEBC-30 | ⏸ Off |

## How it works

There is **one codebase**. The API setting `ENABLED_EPICS` decides what a deployment switches on
(`packages/shared/src/release.ts`). This release runs with `ENABLED_EPICS=1-3`. Nothing is deleted, so
releasing the next epic is a settings change, not a merge.

* **API (the real guard).** Endpoints for switched-off epics answer `404 not_in_release`. These are trip
  progress and logs (`/rides/:id/progress`, `/rides/:id/logs/*`), concerns (`/concerns`), sign-off
  (`/safeguarding/*`) and reports (`/reports/*`). The background job that times out trip logs doesn't run.
* **Web app.** `GET /api/release` tells the app what is on. Links to switched-off screens are hidden
  (Reports, Incidents, Sign-off, "Report a concern"). If someone opens one of those addresses directly, they
  see "Coming in a later release". Safeguarding lands on **Driver approvals**. Office screens show an
  "Epics 1–3" badge.

### What people see once a driver accepts (the edge of Epic 3)

Epic 4 is the point where personal details are shared, so this release stops just before it:

| Who | Epics 1–3 release | When Epic 4 is switched on |
| --- | --- | --- |
| Member | "A driver has said yes. The church office will tell you who is driving before the day." | Driver's first name, photo, car and registration (4.1) |
| Driver | "The lift is yours". Pickup **area**, time, destination and needs summary only. Can hand the lift back | Member's name, address, phone, emergency contact, consented health notes (4.2) |
| Office | Full lift, including which driver accepted | Same |

No member name, address, phone or health information reaches a driver in this release. The test
`apps/api/test/release-epics-1-3.test.ts` checks this.

## Deploy on Render (free tier)

1. **Database: Neon.** Create a project in **London (AWS eu-west-2)** and copy the **pooled** connection
   string (it ends `?sslmode=require`). For a demo database, load the demo people from your machine:

   ```bash
   DATABASE_URL="postgresql://…-pooler…/neondb?sslmode=require" \
   JWT_SECRET=any-long-string-for-this-step-only DATA_ENCRYPTION_KEY=<the key from step 2> \
   npm run db:seed
   ```
   Use the **same `DATA_ENCRYPTION_KEY`** here as on Render, or the seeded health notes can't be read.

2. **Push the code** to GitHub (see "Push this version" below).
3. **Render → New → Blueprint** → pick the repository and the `release/epics-1-3` branch. Render reads
   `render.yaml` and creates two services, `psebc-api` and `psebc-web`. Fill in the values it asks for:
   * `DATABASE_URL`: the Neon pooled string
   * `DATA_ENCRYPTION_KEY`: `openssl rand -base64 32` (keep a copy in the church password manager)
   * `WEB_ORIGIN`: `https://psebc-web.onrender.com` (your web service's address)
   * `API_URL`: `https://psebc-api.onrender.com` (your API's address, no trailing slash)

   Phone alerts are off in this release; the keys aren't in `render.yaml`, so Render won't ask for them.
   To switch them on later, see `docs/deployment.md` § 6 and add the two keys in the Render dashboard.

   If Render gives the services different addresses (for example `psebc-api-x1y2.onrender.com`), update
   `WEB_ORIGIN` and `API_URL`, then **redeploy `psebc-web`**. `API_URL` is read when the web app is built.
4. Check `https://<api>/api/health` returns `{"ok":true}` and `https://<api>/api/release` shows `"epics":[1,2,3]`.
5. Optional: to keep the free API awake and run background checks, add the repository secrets
   `API_BASE_URL` and `JOBS_SECRET` (copy it from the API's environment on Render). The
   `scheduled-jobs.yml` workflow then calls the API every 10 minutes.

Free Render services sleep after 15 minutes idle. The first visit after a sleep takes about a minute, so
open the app a few minutes before the demo.

## Or: one Render service for both (fewer free hours)

Instead of the Blueprint, create a single **New → Web Service** that runs the API and the web app together.
It uses half the free hours, but both apps share the free instance's 512 MB of memory.

| Field | Value |
| --- | --- |
| Branch / Root Directory | `release/epics-1-3` / *(empty)* |
| Build Command | `npm ci --include=dev && npm run build` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |

Environment: `NODE_ENV=production`, `NODE_VERSION=22`, `ENABLED_EPICS=1-3`, `API_URL=http://localhost:4100`,
`WEB_ORIGIN` (the service's own address), `DATABASE_URL`, `JWT_SECRET`, `DATA_ENCRYPTION_KEY` and `JOBS_SECRET`.
**Don't set `PORT`**: Render assigns it to the web app. The API takes its port from `API_URL`.

`npm start` runs `scripts/start-all.mjs`. If either app stops, it stops the other, so Render restarts the
whole service. If `PORT` and `API_URL` would clash, it refuses to start and says why.



```bash
git remote add origin https://github.com/<you>/psebc-transport.git   # once
git push -u origin release/epics-1-3
git push origin v0.3.0-epics-1-3
```

## Demo script (about 10 minutes)

Password for every demo account: `ChangeMe-2026!`. Admin and safeguarding set up an authenticator app at
first sign-in.

1. **Epic 1, onboarding.** Sign in as admin (`admin@psebc.example`). Go to Members › Add a member and run the
   five-screen registration. Show that a member can't be booked until consent is recorded. Then Drivers ›
   Add a driver, with the DBS number and uploads. The driver starts as **Pending**.
2. **Epic 1, approval.** Sign in as safeguarding (`mathias@psebc.example`). It opens on Driver approvals.
   Approve the new driver. Helen (`helen@`) stays pending and never gets an invite.
3. **Epic 2, booking.** Sign in as Margaret (`margaret@`) on a phone. Book a lift in three screens. Her
   needs come from her profile. Then, as Grace (`grace@`, the church office), book for Edna. The
   lift is recorded as booked by the office.
4. **Epic 3, matching.** As David (`david@`), open the invite. It shows the area and needs only. Tick the
   lone-working guidance and accept. Peter's invite is withdrawn. Margaret's screen changes to "A driver
   has said yes". Cancel and rebook to show 2.3 and 2.4. Decline as Peter to show the required reason.

## Releasing the next epic

Set `ENABLED_EPICS=1-4` (then `1-5`, `1-6`, or `all`) on `psebc-api` and redeploy it. The web app picks
the change up by itself. Epics switch on in order: 5 needs 4, and 6 needs 5. A bad value stops the API
at start-up with a clear message, rather than half-working.
