'use client';
import { formatUkPhone } from '@psebc/shared';
import useSWR from 'swr';
import { CONTACT_METHODS, HEALTH_FLAGS, HELP_NEEDED, MOBILITY_AIDS, VEHICLE_REQUIREMENTS, labelList } from '@psebc/shared';
import { RoleGate } from '@/components/shells';
import { BackBar, KV, Loading, Tags } from '@/components/ui';
import { fetcher } from '@/lib/api';
import { signOut } from '@/lib/session';
import { useOfficePhone } from '@/lib/useSettings';
import type { MemberProfile } from '@/lib/types';

export default function Profile() {
  return (
    <div className="mobile">
      <RoleGate roles={['member']}>{(me) => <Inner id={me.user.memberId!} />}</RoleGate>
    </div>
  );
}

function Inner({ id }: { id: string }) {
  const { data } = useSWR<{ member: MemberProfile }>(`/members/${id}`, fetcher);
  const phone = useOfficePhone();
  if (!data) return <Loading />;
  const m = data.member;
  return (
    <>
      <BackBar href="/member" crumb="My details" />
      <main className="screen" id="main">
        <h1 className="title">My details</h1>
        <div className="panel">
          <KV
            items={[
              ['Name', m.fullName],
              ['Called', m.preferredName],
              ['Address', `${m.addressLine}, ${m.town} ${m.postcode}`],
              ['Phone', formatUkPhone(m.phone)],
              ['We contact you by', CONTACT_METHODS[m.contactMethod as keyof typeof CONTACT_METHODS] ?? m.contactMethod],
              ['Emergency contact', `${m.emergencyName} (${m.emergencyRelationship}) ${formatUkPhone(m.emergencyPhone)}`],
            ]}
          />
        </div>
        <div className="stack-sm">
          <h2 className="h3">Travel needs</h2>
          <Tags items={[...labelList(MOBILITY_AIDS, m.mobilityAids), ...labelList(HELP_NEEDED, m.helpNeeded), VEHICLE_REQUIREMENTS[m.vehicleRequirement as keyof typeof VEHICLE_REQUIREMENTS]]} />
        </div>
        <div className="stack-sm">
          <h2 className="h3">Health notes shared with your driver</h2>
          <Tags tone="amber" items={labelList(HEALTH_FLAGS, m.healthFlags ?? [])} />
          {m.unwellInstructions ? <p className="muted">If unwell: {m.unwellInstructions}</p> : null}
          <p className="small muted">{m.consentGiven ? 'You agreed to share these with your driver for each lift.' : 'Consent has not been recorded, so lifts can’t be booked yet.'}</p>
        </div>
        <p className="muted">To change anything, or to stop sharing your health notes, please phone the church office{phone ? ` on ${formatUkPhone(phone)}` : ''}.</p>
        <button type="button" className="btn btn-secondary block" onClick={signOut}>
          Sign out
        </button>
      </main>
    </>
  );
}
