// src/app/admin/staff/page.tsx
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { StaffSaveButton } from './StaffSaveButton';

function isPriv(role?: string | null) {
  return role === 'ADMIN';
}

// ---- server action: update staff contact info ----
async function updateStaff(formData: FormData) {
  'use server';

  const session = await auth();
  const role = (session?.user as any)?.role ?? null;
  if (!session?.user || !isPriv(role)) {
    return;
  }

  const id = String(formData.get('id') || '');
  if (!id) return;

  const name = (formData.get('name') as string | null)?.trim() ?? '';
  const email = (formData.get('email') as string | null)?.trim() ?? '';
  const phone = (formData.get('phone') as string | null)?.trim() ?? '';

  await prisma.staff.update({
    where: { id },
    data: {
      ...(name ? { name } : {}),
      email: email || null,
      phone: phone || null,
    },
  });

  revalidatePath('/admin/staff');
}

export default async function Page() {
  const session = await auth();
  const role = (session?.user as any)?.role ?? null;
  if (!session?.user || !isPriv(role)) {
    return (
      <div className='mx-auto mt-8 max-w-xl rounded-xl bg-red-50 p-6 text-sm text-red-700'>
        Unauthorized (admin/secretary only).
      </div>
    );
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
    <div className='mx-auto space-y-6'>
      {/* Header row on one line */}
      <div className='flex items-center justify-between gap-3'>
        <div>
          <h1 className='text-xl font-semibold tracking-tight'>
            Staff Overview
          </h1>
          <p className='mt-1 text-sm text-gray-600'>
            Edit names, emails, and phone numbers used for seva notifications.
            Phone numbers should be in +E.164 format (e.g. +1437…, +91…).
          </p>
        </div>
        <Link
          href='/admin/schedule'
          className='inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50'
        >
          Monthly Schedule
          <span aria-hidden='true' className='ml-1'>
            →
          </span>
        </Link>
      </div>

      {/* Table */}
      <div className='overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm'>
        <table className='w-full text-sm'>
          <thead className='bg-gray-50'>
            <tr>
              <th className='p-3 text-left font-medium text-gray-700'>Name</th>
              <th className='p-3 text-left font-medium text-gray-700'>Jatha</th>
              <th className='p-3 text-left font-medium text-gray-700'>
                Skills
              </th>
              <th className='p-3 text-left font-medium text-gray-700'>Email</th>
              <th className='p-3 text-left font-medium text-gray-700'>Phone</th>
              <th className='p-3 text-right font-medium text-gray-700'>
                Actions
              </th>
            </tr>
          </thead>
          <tbody className='divide-y divide-gray-100'>
            {staff.map((s) => {
              const formId = `staff-${s.id}`;
              return (
                <tr key={s.id} className='hover:bg-gray-50/60'>
                  <td className='p-3 align-top'>
                    <input
                      type='text'
                      name='name'
                      form={formId}
                      defaultValue={s.name ?? ''}
                      className='w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500'
                      placeholder='Name'
                    />
                  </td>
                  <td className='p-3 align-top'>
                    {s.jatha ? (
                      <span className='inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700'>
                        {s.jatha}
                      </span>
                    ) : (
                      <span className='text-xs text-gray-400'>–</span>
                    )}
                  </td>
                  <td className='p-3 align-top'>
                    {s.skills?.length ? (
                      <div className='flex flex-wrap gap-1'>
                        {s.skills.map((skill) => (
                          <span
                            key={skill}
                            className='inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700'
                          >
                            {skill}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className='text-xs text-gray-400'>
                        No skills set
                      </span>
                    )}
                  </td>
                  <td className='p-3 align-top'>
                    <input
                      type='email'
                      name='email'
                      form={formId}
                      defaultValue={s.email ?? ''}
                      className='w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500'
                      placeholder='Email'
                    />
                  </td>
                  <td className='p-3 align-top'>
                    <input
                      type='tel'
                      name='phone'
                      form={formId}
                      defaultValue={s.phone ?? ''}
                      className='w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500'
                      placeholder='+1… or +91…'
                    />
                  </td>
                  <td className='p-3 align-top text-right'>
                    <form
                      id={formId}
                      action={updateStaff}
                      className='inline-flex items-center gap-2'
                    >
                      <input type='hidden' name='id' value={s.id} />
                      <a
                        className='text-xs text-blue-600 underline hover:text-blue-700'
                        href={`/api/staff/${s.id}/assignments.ics`}
                      >
                        ICS
                      </a>
                      <StaffSaveButton />
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className='text-xs text-gray-500'>
        Tip: ensure phone numbers are valid WhatsApp/SMS numbers in
        international format so assignment notifications reach sevadars
        reliably.
      </p>
    </div>
  );
}
