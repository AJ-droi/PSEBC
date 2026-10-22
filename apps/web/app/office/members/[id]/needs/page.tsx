'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import { DesktopShell } from '@/components/shells';
import { NeedsEditor } from '@/components/member-registration';
import { Loading } from '@/components/ui';
import { fetcher } from '@/lib/api';
import type { MemberProfile } from '@/lib/types';

/** F12 Update member needs. */
export default function Needs() {
  const { id } = useParams<{ id: string }>();
  const { data } = useSWR<{ member: MemberProfile }>(`/members/${id}`, fetcher);
  const router = useRouter();
  return (
    <DesktopShell roles={['coordinator', 'admin']}>
      {() =>
        !data ? (
          <Loading />
        ) : (
          <div className="section" style={{ maxWidth: 640 }}>
            <p className="muted">
              <Link href={`/office/members/${id}`}>{data.member.fullName}</Link> / Update needs
            </p>
            <h1 className="d-title">Update {data.member.preferredName}’s needs</h1>
            <NeedsEditor member={data.member} onDone={() => router.replace(`/office/members/${id}?updated=1`)} />
          </div>
        )
      }
    </DesktopShell>
  );
}
