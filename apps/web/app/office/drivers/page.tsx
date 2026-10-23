'use client';
import Link from 'next/link';
import useSWR from 'swr';
import { HELP_CAPS, VEHICLE_CAPS, labelList, type DriverStatus, type PageMeta } from '@psebc/shared';
import { DesktopShell } from '@/components/shells';
import { DriverChip, Loading } from '@/components/ui';
import { fetcher } from '@/lib/api';
import { Pager, usePage } from '@/components/pager';
import { date } from '@/lib/format';

interface Row {
  id: string;
  fullName: string;
  phone: string;
  status: DriverStatus;
  approvedUntil: string | null;
  vehicle: string;
  vehicleCaps: string[];
  helpCaps: string[];
  expiresOn: string;
  expiringSoon: boolean;
}

export default function Drivers() {
  return (
    <DesktopShell roles={['coordinator', 'admin']}>
      {(me) => <Inner admin={me.user.role === 'admin'} />}
    </DesktopShell>
  );
}

function Inner({ admin }: { admin: boolean }) {
  const { key, setPage } = usePage('/drivers');
  const { data } = useSWR<{ drivers: Row[]; pagination: PageMeta }>(key, fetcher, { keepPreviousData: true });
  return (
    <>
      <div className="d-head">
        <h1 className="d-title">Volunteer drivers</h1>
        {admin ? (
          <Link className="btn btn-primary" href="/office/drivers/new">
            Add a volunteer driver
          </Link>
        ) : null}
      </div>
      <section className="section">
        {!data ? (
          <Loading />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Car</th>
                  <th>Can take</th>
                  <th>Can help with</th>
                  <th>Checks valid to</th>
                </tr>
              </thead>
              <tbody>
                {data.drivers.map((d) => (
                  <tr key={d.id}>
                    <td>{admin ? <Link href={`/office/drivers/${d.id}`}>{d.fullName}</Link> : d.fullName}</td>
                    <td>
                      <DriverChip status={d.status} />
                    </td>
                    <td>{d.vehicle}</td>
                    <td className="small">{labelList(VEHICLE_CAPS, d.vehicleCaps).join(', ') || '—'}</td>
                    <td className="small">{labelList(HELP_CAPS, d.helpCaps).join(', ') || '—'}</td>
                    <td>
                      {date(d.expiresOn)} {d.expiringSoon ? <span className="chip chip-pending">Expiring soon</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager pagination={data?.pagination} onPage={setPage} noun="drivers" />
      </section>
    </>
  );
}
