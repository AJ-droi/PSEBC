# Acceptance-criteria check — PSEBC Jira project vs this build

**Source of criteria:** PSEBC PRD v2.0 §6, which lists each story with its Jira key (PSEBC-7 … PSEBC-29).
The Jira connector could not be reached when this check was made, so the criteria were taken from the PRD
rather than read live from Jira. Re-check any story whose Jira text has changed since PRD v2.0.

**Evidence:** "Test" names the case in `apps/api/test/journey.test.ts` (runs against real Postgres) or
`packages/shared/src/matching.test.ts`. "E2E" means it was also clicked through in a browser (member →
driver → office → safeguarding journey).

Legend: ✅ met · 🟡 met with a note · ⬜ not built (not a Must)

## Epic 1 — Onboarding and approval

| ID | Jira | Priority | Acceptance criteria | Status | Where / evidence |
| --- | --- | --- | --- | --- | --- |
| 1.1 | PSEBC-7 | Must | Registration over five screens: about you, contact and bookings, emergency contact, travel needs, health and consent | ✅ | `components/member-registration.tsx` (Office › Members › Add a member). E2E |
| | | | Profile holds name, address, phone, emergency contact, mobility needs (set list), vehicle requirement, short notes for driver | ✅ | `members` table; set lists in `shared/domain.ts` |
| | | | Profile can't be used until consent to share needs with the assigned driver is recorded | ✅ | API refuses bookings (`no_consent`). Test "PSEBC-7 (1.1)" |
| 1.2 | PSEBC-8 | Must | DBS certificate number and issue date | ✅ | F02 form; 12-digit validation |
| | | | Licence and insurance evidence (upload) | ✅ | PDF/JPG/PNG ≤5 MB; opening is audited |
| | | | Vehicle details, seats, wheelchair or walking-aid capacity | ✅ | "The car can take" + seats |
| | | | Status starts as Pending | ✅ | Test "PSEBC-8 (1.2)"; "Save as draft" also available |
| 1.3 | PSEBC-9 | Must | Only the safeguarding role can set Approved or Rejected | ✅ | Admin and coordinator get 403. Test "PSEBC-9 (1.3)" |
| | | | Decision, date and approver are logged | ✅ | `decided_by_name`, `decided_at` + audit entry |
| | | | A Pending, Rejected or Expired driver never receives an invite | ✅ | Matching rule 1 + re-check at acceptance. Unit tests + Test "PSEBC-12…" (Helen) |
| 1.4 | PSEBC-10 | Should | Reminder 30 days before DBS or insurance expiry | ✅ | Job `checkDriverExpiry`; reminds once per expiry date. Test "PSEBC-10" |
| | | | On expiry the driver's status changes to Expired automatically | ✅ | Same job; open invites withdrawn |
| 1.5 | PSEBC-11 | To decide | Login stops immediately | ✅ | `token_version` bump; existing session gets 401. Test "PSEBC-11" |
| | | | Future lifts are cancelled (member) or reassigned (driver) | ✅ | `admin/accounts.ts` |
| | | | Personal-data deletion date set (12 months; DPO to confirm) | 🟡 | Set and enforced by the retention job; **12 months awaits Anna's (DPO) confirmation** |
| 1.6 | — | To decide (recommended) | Driver records which needs they can help with | ✅ | F02 section 4; used by matching rule 3 |
| 1.7 | — | To decide | Update member needs with fresh consent for new health information | ✅ | F12 `PUT /members/:id/needs` rejects health changes without consent. Test "PSEBC-7 / 1.7" |

## Epic 2 — Requesting a ride

| ID | Jira | Priority | Acceptance criteria | Status | Where / evidence |
| --- | --- | --- | --- | --- | --- |
| 2.1 | PSEBC-12 | Must | Three screens: where and when, getting home, check and book | ✅ | `components/booking-wizard.tsx`. E2E |
| | | | Needs come from the profile and are not re-entered | ✅ | Step 3 shows profile needs; optional "different this time" note only |
| | | | Confirmation shown on screen | ✅ | "Lift booked — We're finding you a driver" |
| 2.2 | PSEBC-13 | Must | Coordinator selects the member, then completes the same form | ✅ | Office › Book a lift (same wizard). E2E |
| | | | The request records who booked it | ✅ | `booked_by_user_id`, `booked_by_role`; shown as "Booked by" |
| | | | The member gets a text or phone call confirmation | 🟡 | Text queued via SMS adapter, or a "please call" task for the office if they prefer calls. **Real SMS needs a provider connected** (see deployment.md) |
| 2.3 | PSEBC-14 | Should | Cancel up to pickup time | ✅ | `isCancellable` + API check. Unit + journey test |
| | | | The driver is notified | ✅ | In-app + SMS to the driver; open invites withdrawn |
| | | | The reason is captured | ✅ | Required reason list (F05) |
| 2.4 | PSEBC-15 | Should | Details from the cancelled ride are copied into a new request | ✅ | `POST /rides/:id/rebook`; `rebooked_from_id` kept |

## Epic 3 — Matching

| ID | Jira | Priority | Acceptance criteria | Status | Where / evidence |
| --- | --- | --- | --- | --- | --- |
| 3.1 | PSEBC-17 | Must | Only drivers who are Approved, whose vehicle meets the requirement, who can give the help needed and who are free at that time are eligible (full rules §8) | ✅ | `shared/matching.ts` — 5 rules, 13 unit tests |
| 3.2 | PSEBC-18 | Must | Invite shows date, time, pickup area, destination and needs summary only | ✅ | Invite view has no name/address/health. Test "PSEBC-18 (3.2)" |
| | | | First acceptance confirms the ride; other invites are withdrawn | ✅ | Row lock + unique index; concurrent accept test returns one 200 and one 409 |
| | | | Decline asks for a reason | ✅ | Reason list from the design; required |
| 3.3 | PSEBC-19 | Should | If no driver accepts within a set time (default 24 h, or 2 h before pickup) the request is flagged to the coordinator | ✅ | Job `flagUnmatched`; thresholds in `settings`. Also flagged at once when nobody is eligible or all decline |
| 3.4 | PSEBC-20 | Could | Driver can book out days on a calendar when unavailable | ⬜ | Not in release 1 (Could; not designed). Rule 4 already avoids double-booking |

## Epic 4 — Driver found and details shared

| ID | Jira | Priority | Acceptance criteria | Status | Where / evidence |
| --- | --- | --- | --- | --- | --- |
| 4.1 | PSEBC-21 | Must | After acceptance the member sees driver first name, photo, vehicle make, colour and registration, and a contact route | ✅ | "Your driver is booked" screen; contact route = call the church office. Test "PSEBC-21" + E2E |
| 4.2 | PSEBC-22 | Must | After acceptance the driver sees member name, pickup address, phone, emergency contact and trip-relevant needs, incl. consented health notes | ✅ | Driver trip screen; view is audited. Test "PSEBC-22" + E2E |
| 4.3 | PSEBC-23 | Must | Access to member details ends at sign-off; driver keeps only the trip record | ✅ | `driver_record` view after sign-off. Test "PSEBC-23" + E2E |

## Epic 5 — Completing and logging the trip

| ID | Jira | Priority | Acceptance criteria | Status | Where / evidence |
| --- | --- | --- | --- | --- | --- |
| 5.1 | PSEBC-24 | Must | Records pickup and drop-off with timestamps | ✅ | F07 buttons. Test "PSEBC-24" |
| | | | "Member not at pickup" alerts the church office | ✅ | In-app + SMS + email to coordinators; shows under "Needs attention" |
| 5.2 | PSEBC-25 | Must | Log asks "Anything to report?" yes/no; Yes opens the concern report (what, when, where, who, action taken) | ✅ | F08 → F10. Test "PSEBC-25" + E2E |
| 5.3 | PSEBC-26 | Must | Simple questions: on time, felt safe, anything to tell us, call-back request | ✅ | F09 |
| | | | "No" to feeling safe opens the concern report | ✅ | Safeguarding is also told the same day. Test "PSEBC-26 (5.3)" |
| | | | The coordinator can complete it after a phone check-in | ✅ | Office › lift › "Fill in member's trip log"; members without a login appear under "Needs attention" |

## Epic 6 — Sign-off

| ID | Jira | Priority | Acceptance criteria | Status | Where / evidence |
| --- | --- | --- | --- | --- | --- |
| 6.1 | PSEBC-27 | Must | Ready for sign-off when both logs are in, or 72 hours after completion if one is missing (missing log noted) | ✅ | Job `applyLogTimeout`. Test "PSEBC-27 (6.1)" |
| | | | Sign-off records name and date | ✅ | `signed_off_by_name`, `signed_off_at` |
| 6.2 | PSEBC-28 | Must | Any concern notifies the safeguarding lead immediately | ✅ | In-app + email + SMS in the same transaction as the report |
| | | | The trip can't be signed off until the concern is marked reviewed | ✅ | 409 until reviewed. Test "PSEBC-27 / PSEBC-28" + E2E |
| 6.3 | PSEBC-29 | Could | Optional 1–5 rating in the member trip log; feeds the satisfaction measure | ✅ | F09 rating; report "Average rating" |

## Epic 7 — Reporting dashboard (CR-01)

| ID | Jira | Priority | Acceptance criteria | Status | Where / evidence |
| --- | --- | --- | --- | --- | --- |
| 7.1 | Not yet | To decide | Month's trips completed, lifts requested, cancelled, no driver found, concerns reported, average rating; month picker | ✅ | Office › Reports |
| | | | Trips by week, driver workload, trips per member, reasons no driver was found | 🟡 | Per-member **names** hidden by default (`REPORTS_SHOW_MEMBER_NAMES=false`) until DPIA task 8.12; counts shown. Workload shown as workload, not a ranking |
| | | | Downloads as a spreadsheet | ✅ | CSV (opens in Excel) |
| | | | Admin and safeguarding only; never shows health information | ✅ | Test "7.1 reports" |

**Jira:** story 7.1 has no Jira key yet — please add it (PRD says "Not yet").

## Cross-cutting Must haves and non-functional requirements

| Requirement | Status | Notes |
| --- | --- | --- |
| Role-based access + audit trail of who saw and changed what | ✅ | Append-only `audit_log`; viewer at Safeguarding › Audit trail |
| WCAG 2.2 AA, text ≥16 px, large buttons, works with phone text size | 🟡 | Built to the design (rem units, 44–58 px targets, labels, focus rings, no colour-only state). Needs a manual screen-reader and contrast audit before the pilot |
| A member can request a ride in 3 screens or fewer | ✅ | 3 |
| Works on iOS/Android phones and desktop | ✅ | Installable PWA (manifest, icons, offline page) + desktop office layouts |
| Individual logins; MFA for admin and safeguarding | ✅ | TOTP |
| Data encrypted in transit and at rest | ✅ | TLS; Neon encryption; health fields additionally AES-256-GCM |
| Invite and confirmation within 5 minutes | 🟡 | In-app is instant; SMS/email leave within a minute once a provider is connected |
| UK or EU hosting; no personal data on phones beyond the session | ✅ | Neon London + Render Frankfurt; service worker never caches API data and is cleared at sign-out |
| Lone-working reminder with a tick before the first trip | ✅ | Required before a driver can accept. **Church to paste its approved guidance text** into `/guidance/lone-working` |
| Zero budget | ✅ | Free tiers only (see deployment.md) |

## Not in release 1 (as agreed in the PRD)

Live GPS, payments/mileage, member ratings of drivers, external transport integrations (Won't);
recurring bookings 2.5 and availability calendar 3.4 (Could).

## Open items for the sponsor

1. Connect an SMS/email provider (decides 2.2 "text confirmation" and the 5-minute notification NFR).
2. DPO to confirm the 12-month deletion period and the per-member report figures (DPIA 8.12).
3. Paste the church's lone-working and conduct guidance.
4. Representatives (family/carers) currently book through the church office; a representative login is a possible next step.
5. Accessibility audit with 3–5 members (Sprint 5 user testing).
