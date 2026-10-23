# PSEBC Lifts — guide for the church office and admin

This guide is for the volunteers who run the lift scheme day to day. No technical knowledge is needed.

## Who does what

| Person | Signs in as | Main jobs |
| --- | --- | --- |
| Church office (e.g. Grace) | Coordinator | Book lifts for members, follow up lifts with no driver, fill in trip logs after a phone call |
| Church administrator | Admin | Add members and drivers, upload checks, create logins, monthly report |
| Mathias or delegate | Safeguarding | Approve drivers, review concerns, sign off every trip |
| Members | Member | Book lifts, see who is coming, say how the trip went |
| Volunteer drivers | Driver | Accept or decline requests, record the trip, report concerns |

Admin and safeguarding need an authenticator app (for example Microsoft Authenticator) on their phone.
The first time they sign in, they scan a code; after that they type the 6-digit number each time.

## Adding a member

1. **Members → Add a member.** Go through the five screens with the member (or their family).
2. On the last screen, tick **"They agree to share this with their driver"** only if they have said yes.
   Without it, lifts can't be booked for them.
3. If they will use the app themselves, open their profile and **Create login**.

To change needs later: open the member → **Update needs**. If health information changes, tick consent again.

**Phone numbers** must be UK numbers (mobiles like 07700 900123 or landlines like 01446 700000). You can
type them with or without spaces, or starting +44; the app stores them in one standard form and shows them
the usual UK way. Numbers from other countries are refused, because texts and the "Call" buttons only work
with UK numbers.

## Adding a volunteer driver

1. **Drivers → Add a volunteer driver.** Fill in the four sections with the driver and upload their licence and insurance.
2. Press **Save and send for approval**. Mathias is told straight away.
3. After approval, open the driver and **Create login** so they can use the app.

If a driver's DBS or insurance is renewed, update the dates — they go back to Mathias for re-approval.

## Booking a lift for someone

Lifts page → **Book a lift for a member** → type their name → **Start booking**. Fill in the three screens.
The member is told by text, or a "please call" task appears for you if they prefer a phone call.

## The Lifts page

**Needs attention** shows:

* **No driver yet** — nobody could take the lift. Call the member, or press **Re-send invites**.
* **Not at pickup** — the driver is waiting and nobody answered. Call the member and their emergency contact.
* **Trip log by phone** — call the member, ask how it went, then **Fill in log**.
* **Please call…** — a member asked for a call, or prefers calls to texts. Press **Done** afterwards.

## When someone leaves

Open the member or driver → **Close account**. Their login stops at once. A member's future lifts are
cancelled; a driver's accepted lifts are offered to other drivers. Personal details are deleted
automatically 12 months later.

## For safeguarding

* **Sign-off** lists trips ready to close. Trips with a concern show a red **Concern** label.
  Read the concern, tick **I have reviewed this concern**, choose an outcome, then **Sign off this trip**.
  Signing off ends the driver's access to the member's details.
* **Driver approvals** lists new drivers and checks expiring in the next 30 days.
* **Audit trail** shows who looked at or changed member needs, driver approvals and incidents.

The app records concerns; it does not replace the church's safeguarding procedure.

## Monthly report

**Reports** → pick the month → **Download as spreadsheet** if you need it in Excel. The report never
shows health information.

## Incidents

When a driver or member reports a concern, or a driver answers "Anything to report?" with Yes, or a member
says they didn't feel safe, the lift shows a red **Incident reported** label everywhere — on the Lifts page,
on the lift itself and on the member's own screen — until safeguarding signs the trip off. Only the
safeguarding lead can read what was reported.

When the safeguarding lead signs in, the first page is **Incidents**, with open incidents at the top and a
**Review now** button for each.

## Message alerts

Every screen plays a short sound when a new message arrives. Under **Messages** each person can test the
sound, switch it off on that device, or **Turn on alerts** so their phone rings even when the app is closed.
On iPhone, add PSEBC Lifts to the Home Screen first. Signing out turns alerts off on that device.

## Changing settings

Settings such as "hours before a lift with no driver is flagged" and the church office phone number are
stored in the database `settings` table. Ask whoever set up the app to change them.
