import Link from 'next/link';
import { Brand } from '@/components/ui';

export const metadata = { title: 'Lone-working and conduct guidance' };

/**
 * PRD §9 Lone working. The church's own guidance text belongs here —
 * replace the placeholder section with the approved wording from the safeguarding policy.
 */
export default function Guidance() {
  return (
    <div className="mobile">
      <header className="m-top">
        <Brand />
      </header>
      <main className="screen" id="main">
        <h1 className="title">Lone-working and conduct guidance</h1>
        <div className="notice">
          <p>
            <strong>[Church to add the approved guidance text from its safeguarding policy here.]</strong>
          </p>
        </div>
        <ul className="stack-sm" style={{ paddingLeft: 20, margin: 0 }}>
          <li>Carry your phone, charged, on every lift.</li>
          <li>Only collect the person named on the lift, from the address shown.</li>
          <li>Don’t go into someone’s home unless they ask for help to the door.</li>
          <li>If someone is in danger, call 999 first, then report it in the app.</li>
          <li>Report any concern the same day using “Report a concern”.</li>
        </ul>
        <Link className="btn btn-primary block" href="/driver">
          Back to my trips
        </Link>
      </main>
    </div>
  );
}
