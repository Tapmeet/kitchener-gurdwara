// src/app/admin/staff/page.tsx
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import Link from 'next/link';

function isPriv(role?: string | null) {
  return role === 'ADMIN' || role === 'SECRETARY';
}

export default async function Page() {
  const session = await auth();
  const role = (session?.user as any)?.role ?? null;
  if (!session?.user || !isPriv(role)) {
    return <div className='p-6'>Unauthorized (admin/secretary only).</div>;
  }

  const staff = await prisma.staff.findMany({
    where: { isActive: true },
    orderBy: [{ jatha: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      jatha: true,
      email: true,
      phone: true,
      skills: true,
    },
  });

  return (
    <div className='p-6 space-y-4'>
      <div className='flex items-center justify-between'>
        <h1 className='text-xl font-semibold'>Staff Overview</h1>
        <Link
          href='/admin/schedule'
          className='text-sm underline hover:no-underline'
        >
          Weekly Schedule →
        </Link>
      </div>
      <table className='w-full text-sm border rounded-xl overflow-hidden'>
        <thead className='bg-gray-50'>
          <tr>
            <th className='text-left p-2'>Name</th>
            <th className='text-left p-2'>Jatha</th>
            <th className='text-left p-2'>Skills</th>
            <th className='text-left p-2'>Email</th>
            <th className='text-left p-2'>Phone</th>
            <th className='text-left p-2'>ICS</th>
          </tr>
        </thead>
        <tbody>
          {staff.map((s) => (
            <tr key={s.id} className='border-t'>
              <td className='p-2'>{s.name}</td>
              <td className='p-2'>{s.jatha ?? '-'}</td>
              <td className='p-2'>{s.skills.join(', ')}</td>
              <td className='p-2'>{s.email ?? '-'}</td>
              <td className='p-2'>{s.phone ?? '-'}</td>
              <td className='p-2'>
                <a
                  className='underline'
                  href={`/api/staff/${s.id}/assignments.ics`}
                >
                  ICS
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
