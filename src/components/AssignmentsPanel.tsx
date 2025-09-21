'use client';
import { useEffect, useState } from 'react';

export default function AssignmentsPanel({ bookingId }: { bookingId: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true); setErr(null);
    fetch(`/api/bookings/${bookingId}/assignments`)
      .then(r => r.json())
      .then(j => { if (j?.error) setErr(j.error); else setData(j); })
      .catch(() => setErr('Failed to load assignments'))
      .finally(() => setLoading(false));
  }, [bookingId]);

  if (loading) return <p className="text-sm text-gray-500">Loading assignments…</p>;
  if (err) return <div className="alert alert-error">{err}</div>;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Assignments</h2>
      {data.items.map((item: any) => (
        <div key={item.id} className="rounded-xl border border-black/10 p-3">
          <div className="font-medium">
            {item.programType.name} <span className="text-xs text-gray-500">({item.programType.category})</span>
          </div>
          {item.assignments.length === 0 ? (
            <p className="text-xs text-gray-500 mt-1">No staff assigned.</p>
          ) : (
            <ul className="mt-2 divide-y divide-black/5">
              {item.assignments.map((a: any) => (
                <li key={a.id} className="py-1.5 text-sm flex items-center justify-between">
                  <span>{a.staff.name}</span>
                  <span className="text-xs text-gray-500">[{a.staff.skills.join(', ')}]</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
