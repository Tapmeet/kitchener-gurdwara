// src/app/program-types/page.tsx
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function ProgramTypesPage() {
  const pts = await prisma.programType.findMany({
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  });

  return (
    <div className='p-6 space-y-4'>
      <h1 className='text-lg font-semibold'>Program Types</h1>
      {pts.length === 0 ? (
        <div className='text-sm text-gray-600'>No program types found.</div>
      ) : (
        <div className='overflow-x-auto rounded-xl border bg-white'>
          <table className='min-w-[640px] w-full text-sm'>
            <thead className='bg-gray-50'>
              <tr>
                <th className='text-left p-3'>Name</th>
                <th className='text-left p-3'>Category</th>
                <th className='text-left p-3'>Duration (min)</th>
              </tr>
            </thead>
            <tbody>
              {pts.map((pt) => (
                <tr key={pt.id} className='border-t'>
                  <td className='p-3'>{pt.name}</td>
                  <td className='p-3'>{pt.category}</td>
                  <td className='p-3'>{pt.durationMinutes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
